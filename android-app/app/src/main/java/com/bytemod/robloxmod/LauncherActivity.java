// The APK is primarily an Xposed module, but this Activity gives it a
// launcher icon so the user can find it after install. Explains how to
// patch Roblox with LSPatch and shows the module status.
package com.bytemod.robloxmod;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.*;

public class LauncherActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 96, 48, 48);
        root.setBackgroundColor(Color.BLACK);

        TextView title = new TextView(this);
        title.setText("RobloxMod");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        root.addView(title);

        TextView status = new TextView(this);
        status.setTextColor(0xFF44FF66);
        status.setText(isActive() ? "Xposed hook: ACTIVE" : "Xposed hook: not detected");
        root.addView(status);

        TextView desc = new TextView(this);
        desc.setTextColor(Color.LTGRAY);
        desc.setText(
            "\nThis APK is an Xposed module targeting com.roblox.client.\n\n" +
            "To install without root:\n" +
            "1. Install LSPatch from lsposed.org/LSPatch\n" +
            "2. Open LSPatch, pick your Roblox APK\n" +
            "3. Add THIS module (com.bytemod.robloxmod) to the patch\n" +
            "4. Choose 'Local integrated' patch mode\n" +
            "5. Install the resulting patched APK\n\n" +
            "Overlay pops ~2s after Roblox splash. Grant\n" +
            "'Draw over other apps' when prompted.");
        root.addView(desc);

        Button lspatch = new Button(this);
        lspatch.setText("Open LSPatch GitHub");
        lspatch.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW,
            Uri.parse("https://github.com/JingMatrix/LSPatch/releases"))));
        root.addView(lspatch);

        setContentView(root);
    }

    private boolean isActive() {
        // LSPatch/LSPosed sets this env when a hooked process starts — the
        // launcher itself is unhooked, so this always returns false here.
        // Kept for symmetry with LSPosed-enrolled devices where the manager
        // patches THIS class at load time.
        return false;
    }
}
