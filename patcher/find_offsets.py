#!/usr/bin/env python3
"""
Roblox iOS Mach-O offset auto-recovery.

Extracts the arm64e slice from an IPA, scans it against the AOB signatures
in offsets.py, and writes the recovered offsets back into offsets.py.

Run this after each Roblox release. If a sig rots (Roblox refactored the
target function), the scanner reports which sig missed — that's the one you
re-derive in IDA/Ghidra, update SIGS, and re-run.

Usage:
  python3 find_offsets.py Roblox.ipa
"""

import sys, os, re, struct, zipfile, tempfile, shutil
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import offsets as OFF

def parse_pattern(pat):
    """'FF 43 ?? A9' → (bytes, mask) where mask 0xFF means match, 0 means wild."""
    b = bytearray()
    m = bytearray()
    for tok in pat.split():
        if tok == "??":
            b.append(0); m.append(0)
        else:
            b.append(int(tok, 16)); m.append(0xFF)
    return bytes(b), bytes(m)

def scan(data: bytes, pat, mask):
    n = len(pat)
    end = len(data) - n
    hits = []
    # first non-wild byte accelerates the scan
    anchor = next((i for i, m in enumerate(mask) if m), 0)
    anchor_byte = pat[anchor]
    i = 0
    while i <= end:
        j = data.find(bytes([anchor_byte]), i + anchor, end + anchor + 1)
        if j < 0: break
        s = j - anchor
        ok = True
        for k in range(n):
            if mask[k] and data[s+k] != pat[k]:
                ok = False; break
        if ok:
            hits.append(s)
        i = s + 1
    return hits

def find_thin_arm64e(macho: bytes):
    magic = struct.unpack_from("<I", macho, 0)[0]
    if magic in (0xCAFEBABE, 0xBEBAFECA):
        nfat = struct.unpack(">I", macho[4:8])[0]
        for i in range(nfat):
            e = 8 + i * 20
            cputype = struct.unpack(">I", macho[e:e+4])[0]
            cpusub  = struct.unpack(">I", macho[e+4:e+8])[0]
            off     = struct.unpack(">I", macho[e+8:e+12])[0]
            size    = struct.unpack(">I", macho[e+12:e+16])[0]
            if cputype == 0x0100000C and (cpusub & 0xFF) == 2:
                return macho[off:off+size]
    return macho

def extract_binary(ipa_path: Path) -> bytes:
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        with zipfile.ZipFile(ipa_path) as z:
            z.extractall(td)
        app = next((td / "Payload").glob("*.app"))
        exe = app / app.stem
        return exe.read_bytes()

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    ipa = Path(sys.argv[1])
    print(f"[+] extracting {ipa}")
    raw = extract_binary(ipa)
    slc = find_thin_arm64e(raw)
    print(f"[+] arm64e slice: {len(slc):#x} bytes")

    found = {}
    misses = []
    for name, sig in OFF.SIGS.items():
        pat, mask = parse_pattern(sig)
        hits = scan(slc, pat, mask)
        if not hits:
            misses.append(name)
            print(f"[-] {name:24s} NO MATCH — re-derive sig in IDA")
            continue
        if len(hits) > 1:
            print(f"[!] {name:24s} {len(hits)} matches, using first ({hits[0]:#x})")
        found[name] = hits[0]
        print(f"[+] {name:24s} {hits[0]:#x}")

    # write back into offsets.py
    src = Path(__file__).parent / "offsets.py"
    txt = src.read_text()
    for name, off in found.items():
        txt = re.sub(
            rf'("{name}":\s*)0x[0-9A-Fa-f]+',
            rf'\g<1>{off:#010x}',
            txt, count=1)
    src.write_text(txt)
    print(f"[+] wrote {len(found)} offsets to {src}")
    if misses:
        print(f"[!] {len(misses)} misses — sigs need re-derivation:", ", ".join(misses))
        sys.exit(2)

if __name__ == "__main__":
    main()
