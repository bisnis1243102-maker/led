// Xposed module entry point. LSPatch / LSPosed / EdXposed all resolve this
// class from assets/xposed_init. Hooks com.roblox.client's Application.
package com.bytemod.robloxmod;

import android.app.Activity;
import android.app.Application;
import android.content.Context;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage.LoadPackageParam;

public class XposedInit implements IXposedHookLoadPackage {
    @Override
    public void handleLoadPackage(final LoadPackageParam lpp) {
        if (!"com.roblox.client".equals(lpp.packageName)) return;

        XposedBridge.log("[RobloxMod] loaded into " + lpp.packageName);

        // Hook Application.attach so we can copy our .so out of the module
        // APK into the target's writable dir, then System.load() it.
        XposedHelpers.findAndHookMethod(Application.class, "attach",
            Context.class, new XC_MethodHook() {
                @Override protected void afterHookedMethod(MethodHookParam p) {
                    Context ctx = (Context) p.args[0];
                    NativeLoader.loadInto(ctx, lpp.classLoader);
                }
            });

        // Also hook the first Activity onCreate so the overlay window has a
        // context to attach to.
        XposedHelpers.findAndHookMethod(Activity.class, "onCreate",
            android.os.Bundle.class, new XC_MethodHook() {
                boolean fired = false;
                @Override protected void afterHookedMethod(MethodHookParam p) {
                    if (fired) return;
                    fired = true;
                    RobloxMod.install((Activity) p.thisObject);
                }
            });
    }
}
