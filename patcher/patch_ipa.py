#!/usr/bin/env python3
"""
Roblox IPA patcher — non-JB target (TrollStore / AltStore / Sideloadly).

Pipeline:
  1. Unzip IPA
  2. Locate Payload/Roblox.app/Roblox (main Mach-O, thinned to arm64e)
  3. Inject LC_LOAD_DYLIB pointing at @executable_path/RobloxMod.dylib
  4. Copy compiled RobloxMod.dylib next to the main binary
  5. Strip existing code signature
  6. Re-sign with ldid using entitlements.plist
  7. Repack IPA

Usage:
  python3 patch_ipa.py Roblox.ipa RobloxMod.dylib entitlements.plist out.ipa
"""

import sys, os, shutil, subprocess, struct, tempfile, zipfile
from pathlib import Path

LC_LOAD_DYLIB = 0x0C

def read_u32(b, o): return struct.unpack_from("<I", b, o)[0]

def find_thin_arm64e(macho_bytes):
    magic = read_u32(macho_bytes, 0)
    if magic in (0xCAFEBABE, 0xBEBAFECA):  # fat
        nfat = struct.unpack(">I", macho_bytes[4:8])[0]
        for i in range(nfat):
            e = 8 + i * 20
            cputype  = struct.unpack(">I", macho_bytes[e:e+4])[0]
            cpusub   = struct.unpack(">I", macho_bytes[e+4:e+8])[0]
            off      = struct.unpack(">I", macho_bytes[e+8:e+12])[0]
            size     = struct.unpack(">I", macho_bytes[e+12:e+16])[0]
            if cputype == 0x0100000C and (cpusub & 0xFF) == 2:  # arm64e
                return macho_bytes[off:off+size], off, size
        raise SystemExit("arm64e slice not found in fat binary")
    return macho_bytes, 0, len(macho_bytes)

def inject_load_dylib(macho: bytearray, dylib_path: str) -> bytearray:
    ncmds     = read_u32(macho, 0x10)
    sizeofcmds = read_u32(macho, 0x14)
    header_sz = 0x20  # mach_header_64

    name = dylib_path.encode() + b"\x00"
    cmd_size = (24 + len(name) + 7) & ~7
    cmd = bytearray(cmd_size)
    struct.pack_into("<I", cmd, 0, LC_LOAD_DYLIB)
    struct.pack_into("<I", cmd, 4, cmd_size)
    struct.pack_into("<I", cmd, 8, 24)            # name offset
    struct.pack_into("<I", cmd, 12, 2)            # timestamp
    struct.pack_into("<I", cmd, 16, 0x00010000)   # current_version
    struct.pack_into("<I", cmd, 20, 0x00010000)   # compat_version
    cmd[24:24+len(name)] = name

    insert_off = header_sz + sizeofcmds
    # need free zero-space in __PAGEZERO/__TEXT header pad
    if any(macho[insert_off:insert_off+cmd_size]):
        raise SystemExit("no header slack for LC_LOAD_DYLIB; use larger --pad")
    macho[insert_off:insert_off+cmd_size] = cmd
    struct.pack_into("<I", macho, 0x10, ncmds + 1)
    struct.pack_into("<I", macho, 0x14, sizeofcmds + cmd_size)
    return macho

def run(cmd, **kw):
    print("+", " ".join(cmd))
    subprocess.check_call(cmd, **kw)

def main():
    if len(sys.argv) != 5:
        print(__doc__); sys.exit(1)
    ipa, dylib, ents, out = map(Path, sys.argv[1:5])

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        run(["unzip", "-q", str(ipa), "-d", str(td)])
        app_dir = next((td / "Payload").glob("*.app"))
        exe = app_dir / app_dir.stem  # Roblox.app/Roblox

        raw = bytearray(exe.read_bytes())
        slice_bytes, off, size = find_thin_arm64e(raw)
        slice_bytes = bytearray(slice_bytes)
        slice_bytes = inject_load_dylib(slice_bytes, "@executable_path/RobloxMod.dylib")
        raw[off:off+size] = slice_bytes
        exe.write_bytes(bytes(raw))

        shutil.copy(dylib, app_dir / "RobloxMod.dylib")

        # Strip existing signature, re-sign with ldid
        run(["codesign", "--remove-signature", str(exe)], stderr=subprocess.DEVNULL) \
            if shutil.which("codesign") else None
        run(["ldid", f"-S{ents}", str(app_dir / "RobloxMod.dylib")])
        run(["ldid", f"-S{ents}", str(exe)])

        # Repack
        if out.exists(): out.unlink()
        run(["zip", "-qr", str(out.resolve()), "Payload"], cwd=str(td))
        print("wrote", out)

if __name__ == "__main__":
    main()
