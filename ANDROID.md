# Android install path

Two ways to get `libRobloxMod.so` running inside Roblox on Android. Pick
based on whether your device is rooted.

## Getting the .so

Every push triggers `.github/workflows/build-android.yml`, which builds
`libRobloxMod.so` for `arm64-v8a` and `armeabi-v7a` on an Ubuntu runner
using NDK r26d. Grab from repo → Actions → latest "Build RobloxMod (Android)"
run → Artifacts → `RobloxMod-android`.

## Path A — non-root (repacked APK, most users)

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

## Path B — rooted (LSPosed module, cleanest for developers)

1. Root your device with Magisk. Install LSPosed via Magisk module.
2. Wrap the artifact into an LSPosed module APK (structure in
   `android/lsposed/` — TODO for a later commit).
3. Install the module APK, enable it in LSPosed, target
   `com.roblox.client`, force-stop and relaunch Roblox.
4. LSPosed injects the module before the app's own code runs — no APK
   repack needed.

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
