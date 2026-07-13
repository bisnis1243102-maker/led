# RobloxMod (iOS) — dual-target

Modified Roblox iOS client. Two build targets share one hook core (`shared/hooks.mm`):

- **Jailbroken devices** — Theos tweak (`tweak/`) packaged as a `.deb`, loaded by
  substitute / ellekit / substrate into `com.roblox.robloxmobile`.
- **Stock iOS** — patched IPA (`patcher/`) with `RobloxMod.dylib` injected via
  `LC_LOAD_DYLIB`, re-signed with `ldid`, sideloadable via TrollStore / AltStore /
  Sideloadly.

## Features

- In-process Lua executor (bridge into the running `lua_State`)
- Draggable overlay: script editor, Execute, Fly / Noclip switches, WalkSpeed slider
- Movement patches: WalkSpeed / JumpPower / Fly / Noclip via `Humanoid::SetStateEnabled` hook
- Identity-level bypass for protected globals

## Build — jailbroken (.deb)

```
cd tweak
export THEOS=~/theos
make package FINALPACKAGE=1
# tweak/packages/com.byte.robloxmod_1.0.0_iphoneos-arm.deb
```

Install with Sileo/Zebra or `dpkg -i` over SSH.

## Build — stock iOS (patched IPA)

```
./patcher/sign_pack.sh Roblox.ipa Roblox-Mod.ipa
```

Requires macOS + Xcode CLT + Theos + `ldid` on `$PATH`. Feed the resulting IPA
to TrollStore (permanent, no cert rot) or AltStore/Sideloadly (7-day cert).

## Offsets

`patcher/offsets.py` holds the version-tied offset table. Roblox ships weekly —
after each update, re-derive offsets by AOB-scanning with the sigs in that file
(IDA/Ghidra/Binja). The identity-check patch and the `Humanoid::SetStateEnabled`
hook rely on those offsets being current.
