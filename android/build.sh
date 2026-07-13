#!/usr/bin/env bash
# Standalone NDK build. Runs in the GitHub Actions workflow.
# Produces build/arm64-v8a/libRobloxMod.so ready to inject into a repacked APK.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LUAU_TAG="${LUAU_TAG:-0.640}"

# Fetch Luau if missing
if [ ! -d "$ROOT/third_party/luau" ]; then
    mkdir -p "$ROOT/third_party"
    git clone --depth 1 --branch "$LUAU_TAG" \
        https://github.com/luau-lang/luau.git "$ROOT/third_party/luau"
fi

: "${ANDROID_NDK:?ANDROID_NDK must be set}"
TOOLCHAIN="$ANDROID_NDK/build/cmake/android.toolchain.cmake"

for ABI in arm64-v8a armeabi-v7a; do
    BUILD="$ROOT/build-$ABI"
    mkdir -p "$BUILD"
    cmake -S "$ROOT" -B "$BUILD" \
        -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
        -DANDROID_ABI="$ABI" \
        -DANDROID_PLATFORM=android-24 \
        -DCMAKE_BUILD_TYPE=Release
    cmake --build "$BUILD" -j
    mkdir -p "$ROOT/out/$ABI"
    cp "$BUILD"/libRobloxMod.so "$ROOT/out/$ABI/"
done

echo "artifacts:"
find "$ROOT/out" -name '*.so' -exec ls -la {} \;
