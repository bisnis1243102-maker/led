# Android install path

Two ways to get `libRobloxMod.so` running inside Roblox on Android. Pick
based on whether your device is rooted.

## Getting the .so

Every push triggers `.github/workflows/build-android.yml`, which builds
`libRobloxMod.so` for `arm64-v8a` and `armeabi-v7a` on an Ubuntu runner
using NDK r26d. Grab from repo → Actions → latest "Build RobloxMod (Android)"
run → Artifacts → `RobloxMod-android`.

## Path A — non-root (LSPatch, easiest, recommended)

1. Grab the module APK from the "Build RobloxMod (LSPatch module APK)"
   workflow → Artifacts → `RobloxMod-module-apk`. Install it. Its icon
   shows on your launcher.
2. Grab a Roblox APK from APKPure/APKMirror.
3. Install **LSPatch** (`github.com/JingMatrix/LSPatch/releases`).
4. Open LSPatch → New Patch → pick your Roblox APK.
5. Add the RobloxMod module to the patch list.
6. Choose "Local integrated" patch mode. Install.
7. Uninstall Play Store Roblox → open the patched Roblox → grant
   "Draw over other apps" → overlay appears ~2s after splash.

No smali edits, no MT Manager. LSPatch handles the Xposed injection
non-invasively at Application.attach.

## Path B — non-root (manual repack with MT Manager)

1. Get a Roblox APK (`com.roblox.client`) — grab a specific version from
   APKPure / APKMirror. Same version as your Google Play install ideally
   so cloud saves line up.
2. Install **MT Manager** (or **APK Editor Pro**) on your phone.
3. Open the APK in MT Manager → view mode → `lib/arm64-v8a/` → drop
   `libRobloxMod.so` in.
4. Inject the Java loader:
   - Extract `classes.dex` → open with MT's dex editor → find the main
     Activity (`com.roblox.client.startup.ActivityProtocolLaunchIntent`
     on current builds) → find `onCreate` → after `super.onCreate(...)`
     inject `invoke-static {p0}, Lcom/byte/robloxmod/RobloxMod;->install(Landroid/app/Activity;)V`
   - Add the compiled `RobloxMod.dex` and `HttpBridge.dex` from the
     artifact into the APK.
5. Add these to `AndroidManifest.xml`:
   ```
   <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
   <uses-permission android:name="android.permission.INTERNET"/>
   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
   ```
6. Re-sign the APK (MT Manager does this automatically on export).
7. Uninstall your Google Play Roblox → install the modded APK → grant
   the "Draw over other apps" permission when prompted.

## Path C — rooted (LSPosed module, cleanest for developers)

1. Root your device with Magisk. Install LSPosed via Magisk module.
2. Install the same `RobloxMod-module-apk` from Path A.
3. Open LSPosed manager → Modules → enable RobloxMod → scope already
   preconfigured to `com.roblox.client`.
4. Force-stop and relaunch Roblox — module attaches automatically.

## First launch checklist

- Roblox splash → overlay appears in top-left within a few seconds.
- Tap Execute on the default script → check logcat for `RobloxMod`
  tag: `adb logcat | grep RobloxMod`
- If overlay doesn't appear: check `Settings → Apps → Roblox → Permissions
  → Display over other apps` is ON.

## Updating for a Roblox release

Same as iOS: populate `patcher/offsets.py` against the current
`libroblox.so`, push, Actions rebuilds, download new .so, re-inject.
`find_offsets.py` accepts either an IPA or an APK — extract the .so from
`lib/arm64-v8a/` before scanning.
