#!/usr/bin/env bash
# Fetch and build the Luau compiler as a fat arm64/arm64e static lib for iOS.
# Output: third_party/libluau_compiler.a — linked into RobloxMod.dylib.
#
# Runs once during initial repo setup and on Luau version bumps.
# Version pinned to a known-good release; bump LUAU_TAG when Roblox rebases.
set -euo pipefail

LUAU_TAG="${LUAU_TAG:-0.640}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/luau"
OUT="$ROOT/libluau_compiler.a"

if [ ! -d "$SRC" ]; then
    echo "[+] cloning Luau @$LUAU_TAG"
    git clone --depth 1 --branch "$LUAU_TAG" https://github.com/luau-lang/luau.git "$SRC"
fi

SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
CXX="$(xcrun --sdk iphoneos --find clang++)"
LIB="$(xcrun --sdk iphoneos --find libtool)"

BUILD="$ROOT/build"
mkdir -p "$BUILD"

CXX_COMMON=(
    -arch arm64 -arch arm64e
    -isysroot "$SDK"
    -miphoneos-version-min=15.0
    -O2 -fno-exceptions -fno-rtti
    -std=c++17
    -I"$SRC/Compiler/include"
    -I"$SRC/Ast/include"
    -I"$SRC/Common/include"
    -DLUAU_API=
    -DLUACODE_API=
)

OBJS=()
for src in \
    "$SRC"/Compiler/src/*.cpp \
    "$SRC"/Ast/src/*.cpp
do
    obj="$BUILD/$(basename "$src" .cpp).o"
    echo "[+] cc $(basename "$src")"
    "$CXX" "${CXX_COMMON[@]}" -c "$src" -o "$obj"
    OBJS+=("$obj")
done

echo "[+] libtool -> $OUT"
"$LIB" -static -o "$OUT" "${OBJS[@]}"
echo "[+] done. link with: -L$ROOT -lluau_compiler"
