// Java-side entry point. Repacked APK's main Activity calls
// RobloxMod.install(this) after super.onCreate(); that loads the native
// library, spawns the overlay, and wires the JNI callbacks.
//
// Native symbols:
//   execute(String src)          — send Lua source to the executor
//   setWalkSpeed(float)          — patch Humanoid walkspeed
//   setFly(boolean)              — toggle fly
//   setNoclip(boolean)           — toggle noclip
package com.byte.robloxmod;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

public class RobloxMod {
    static { System.loadLibrary("RobloxMod"); }

    public static native void execute(String src);
    public static native void setWalkSpeed(float v);
    public static native void setFly(boolean on);
    public static native void setNoclip(boolean on);

    private static LinearLayout overlay;
    private static WindowManager.LayoutParams lp;
    private static float touchX, touchY;

    public static void install(final Activity a) {
        a.runOnUiThread(new Runnable() { @Override public void run() { build(a); } });
    }

    private static void build(final Activity a) {
        final Context ctx = a.getApplicationContext();
        overlay = new LinearLayout(ctx);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(0xDD000000);
        overlay.setPadding(px(ctx, 8), px(ctx, 8), px(ctx, 8), px(ctx, 8));

        TextView title = new TextView(ctx);
        title.setText("RobloxMod");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        overlay.addView(title);

        final EditText editor = new EditText(ctx);
        editor.setBackgroundColor(0xFF111111);
        editor.setTextColor(0xFF44FF66);
        editor.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        editor.setSingleLine(false);
        editor.setMinLines(6);
        editor.setHint("-- lua here");
        overlay.addView(editor);

        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);

        Button exec = new Button(ctx);
        exec.setText("Execute");
        exec.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                execute(editor.getText().toString());
            }
        });
        row.addView(exec);

        Switch fly = new Switch(ctx);
        fly.setText("Fly");
        fly.setTextColor(Color.WHITE);
        fly.setOnCheckedChangeListener((b, on) -> setFly(on));
        row.addView(fly);

        Switch nc = new Switch(ctx);
        nc.setText("Noclip");
        nc.setTextColor(Color.WHITE);
        nc.setOnCheckedChangeListener((b, on) -> setNoclip(on));
        row.addView(nc);

        overlay.addView(row);

        SeekBar ws = new SeekBar(ctx);
        ws.setMax(200);
        ws.setProgress(32);
        ws.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int p, boolean u) { setWalkSpeed(p); }
            @Override public void onStartTrackingTouch(SeekBar sb) {}
            @Override public void onStopTrackingTouch(SeekBar sb) {}
        });
        overlay.addView(ws);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(
            px(ctx, 340), WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
              | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = 20; lp.y = 80;

        overlay.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        touchX = e.getRawX() - lp.x; touchY = e.getRawY() - lp.y; return true;
                    case MotionEvent.ACTION_MOVE:
                        lp.x = (int)(e.getRawX() - touchX);
                        lp.y = (int)(e.getRawY() - touchY);
                        ((WindowManager)ctx.getSystemService(Context.WINDOW_SERVICE))
                            .updateViewLayout(overlay, lp);
                        return true;
                }
                return false;
            }
        });

        WindowManager wm = (WindowManager)ctx.getSystemService(Context.WINDOW_SERVICE);
        wm.addView(overlay, lp);
    }

    private static int px(Context c, int dp) {
        return (int)(dp * c.getResources().getDisplayMetrics().density);
    }
}
