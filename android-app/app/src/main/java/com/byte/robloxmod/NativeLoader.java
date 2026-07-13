// Extracts libRobloxMod.so from THIS module APK into the target Roblox
// process's app_data dir and System.load()s it. Necessary because
// System.loadLibrary("RobloxMod") looks under Roblox's own lib/, which
// doesn't contain our .so — we live in a different APK.
package com.byte.robloxmod;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class NativeLoader {
    private static boolean loaded = false;

    public static synchronized void loadInto(Context ctx, ClassLoader cl) {
        if (loaded) return;
        try {
            String abi = android.os.Build.SUPPORTED_ABIS[0];
            File dst = new File(ctx.getFilesDir(), "libRobloxMod-" + abi + ".so");
            if (!dst.exists() || dst.length() == 0) {
                String path = "lib/" + abi + "/libRobloxMod.so";
                // Pull from the module's own APK resources.
                InputStream is = cl.getResourceAsStream(path);
                if (is == null) {
                    // Fallback: it may be an assets-packaged copy.
                    is = XposedInit.class.getClassLoader()
                        .getResourceAsStream(path);
                }
                if (is == null) {
                    throw new RuntimeException("libRobloxMod.so not in module APK");
                }
                OutputStream os = new FileOutputStream(dst);
                byte[] buf = new byte[16384]; int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
                os.close(); is.close();
            }
            System.load(dst.getAbsolutePath());
            loaded = true;
        } catch (Throwable t) {
            de.robv.android.xposed.XposedBridge.log("[RobloxMod] loadInto failed: " + t);
        }
    }
}
