// Called by executor_lib.cpp via JNI to service Lua request({...}) calls.
// Runs on caller thread — the JNI side is already off the UI thread.
package com.byte.robloxmod;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class HttpBridge {
    public static String request(String url, String method, String body) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod(method == null ? "GET" : method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "RobloxMod/1.0");
            if (body != null && !body.isEmpty()) {
                c.setDoOutput(true);
                OutputStream os = c.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.close();
            }
            InputStream is = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] tmp = new byte[8192]; int n;
            while ((n = is.read(tmp)) > 0) buf.write(tmp, 0, n);
            is.close();
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }
}
