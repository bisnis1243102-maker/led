#!/usr/bin/env bash
# End-to-end build: compile shared dylib for non-JB target, patch IPA, output signed IPA.
# Requires: theos (for arm64e clang), ldid, zip/unzip, an unzipped Roblox.ipa.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IPA_IN="${1:-Roblox.ipa}"
IPA_OUT="${2:-Roblox-Mod.ipa}"
ENTS="$ROOT/entitlements.plist"

SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
CLANG="$(xcrun --sdk iphoneos --find clang++)"

OUT="$ROOT/build"
mkdir -p "$OUT"

"$CLANG" -arch arm64e -arch arm64 \
    -isysroot "$SDK" \
    -miphoneos-version-min=15.0 \
    -fobjc-arc -std=c++17 \
    -dynamiclib \
    -framework UIKit -framework Foundation -framework QuartzCore \
    -install_name "@executable_path/RobloxMod.dylib" \
    "$ROOT/shared/hooks.mm" \
    -o "$OUT/RobloxMod.dylib"

ldid "-S$ENTS" "$OUT/RobloxMod.dylib"

python3 "$ROOT/patcher/patch_ipa.py" "$IPA_IN" "$OUT/RobloxMod.dylib" "$ENTS" "$IPA_OUT"
echo "done: $IPA_OUT"
