#!/usr/bin/env bash
# Fetch and build the Luau compiler as a fat arm64/arm64e static lib for iOS.
# Builds each arch into a thin .a, then lipo -creates the fat lib.
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

build_arch() {
    local arch="$1"
    local build="$ROOT/build-$arch"
    local thin="$ROOT/libluau_compiler-$arch.a"
    mkdir -p "$build"

    local objs=()
    for src in "$SRC"/Compiler/src/*.cpp "$SRC"/Ast/src/*.cpp; do
        local obj="$build/$(basename "$src" .cpp).o"
        echo "[+] [$arch] cc $(basename "$src")"
        "$CXX" \
            -arch "$arch" \
            -isysroot "$SDK" \
            -miphoneos-version-min=15.0 \
            -O2 -fno-rtti -std=c++17 \
            -I"$SRC/Compiler/include" \
            -I"$SRC/Ast/include" \
            -I"$SRC/Common/include" \
            -DLUAU_API= -DLUACODE_API= \
            -c "$src" -o "$obj"
        objs+=("$obj")
    done

    echo "[+] [$arch] libtool -> $thin"
    "$LIB" -static -o "$thin" "${objs[@]}"
}

build_arch arm64
build_arch arm64e

echo "[+] lipo -> $OUT"
lipo -create \
    "$ROOT/libluau_compiler-arm64.a" \
    "$ROOT/libluau_compiler-arm64e.a" \
    -output "$OUT"

lipo -info "$OUT"
echo "[+] done"
