# KSign install path (no JB, no Mac needed)

## What you need on your phone
- **KSign** (already installed)
- A **p12 certificate + mobileprovision** loaded in KSign (Apple developer cert or a shared cert)
- A **decrypted Roblox IPA** — see "Sourcing the IPA" below
- **RobloxMod.dylib** — built by GitHub Actions (see "Getting the dylib")

## Getting the dylib

Every push to the branch triggers `.github/workflows/build-dylib.yml`, which
compiles the fat arm64/arm64e dylib on a macOS runner and uploads it as an
artifact. To grab it:

1. Open the repo on GitHub in Safari.
2. Actions tab → latest "Build RobloxMod.dylib" run → Artifacts →
   `RobloxMod-dylib`.
3. Download → unzip → `RobloxMod.dylib`.
4. Save to Files → "On My iPhone" → KSign.

To force a build without a code change, click "Run workflow" on the Actions
tab (workflow_dispatch is enabled).

## Sourcing the IPA

You need the decrypted Roblox IPA — a straight App Store copy is
FairPlay-encrypted and will crash immediately with an injected dylib. Options:

- **Decrypted IPA dump sites** (community mirrors): search
  `roblox decrypted ipa <version>` — the executor scene mirrors these
  within hours of each Roblox release. Match the version to whatever
  Roblox is currently pushing.
- **iOS Ninja / ArmConverter** archives.
- **Have someone with TrollStore dump it for you** (TrollStore's
  "Export IPA" produces a decrypted copy from an installed App Store app).

## KSign flow

1. Open KSign.
2. Import Roblox IPA.
3. In the import options, add `RobloxMod.dylib` as an **injected dylib**.
   (KSign handles the `LC_LOAD_DYLIB` patch itself — you don't need the
   repo's `patcher/patch_ipa.py`.)
4. Pick your cert.
5. Sign & install.
6. Launch Roblox. Overlay appears ~2 seconds after main menu loads.

## Updating for a new Roblox release

Roblox ships weekly. Each release rots the offsets in `patcher/offsets.py`:

1. Get the new decrypted IPA.
2. On a Mac (or a rented cloud Mac like MacinCloud, or a friend's), run:
   `python3 patcher/find_offsets.py Roblox.ipa`
   This AOB-scans and rewrites `offsets.py`. Commit and push.
3. GitHub Actions rebuilds the dylib automatically.
4. Download the new dylib artifact, re-sign in KSign with the new Roblox
   IPA, install.

If any sig reports NO MATCH, that function was refactored — someone needs
to re-derive the sig in IDA/Ghidra once. Then step 2 works again on future
releases.
