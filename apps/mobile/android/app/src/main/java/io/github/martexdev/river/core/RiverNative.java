package io.github.martexdev.river.core;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/**
 * The native interface of River's client core (apps/mobile/core/native.ts):
 * `RiverNative.call(method, argsJson) → {"v": value} | {"e": message, "code"}`.
 * Installed only in the core's own WebView, never in the UI's.
 */
public final class RiverNative {
  private static final String TAG = "RiverNative";
  private final CryptoOps crypto = new CryptoOps();
  private final SignalOps signal = new SignalOps();
  private final KeystoreOps keystore = new KeystoreOps();
  private final DbOps db = new DbOps();
  final FileOps files;

  RiverNative(Context context) throws java.io.IOException {
    files = new FileOps(context);
  }

  /** The core is gone: its databases are closed (not reachable from JavaScript). */
  void close() {
    db.closeAll();
  }

  @JavascriptInterface
  public String call(String method, String argsJson) {
    try {
      JSONObject args = new JSONObject(argsJson == null ? "{}" : argsJson);
      Object value;
      if (method.startsWith("sig.")) value = signal.call(method, args);
      else if (method.startsWith("fs.")) value = files.call(method, args);
      else if (method.startsWith("db.")) value = db.call(method, args);
      else if (method.startsWith("keystore.")) value = keystore.call(method, args);
      else value = crypto.call(method, args);
      return new JSONObject().put("v", value == null ? JSONObject.NULL : value).toString();
    } catch (Throwable e) {
      String code = SignalOps.codeOf(e);
      if (code == null && e instanceof SignalOps.Failure) code = ((SignalOps.Failure) e).code;
      // Never log arguments: they carry keys and message contents.
      Log.w(TAG, method + " failed: " + e.getClass().getSimpleName());
      try {
        JSONObject out = new JSONObject().put("e", String.valueOf(e.getMessage()));
        if (code != null) out.put("code", code);
        return out.toString();
      } catch (Exception never) {
        return "{\"e\":\"native failure\"}";
      }
    }
  }
}
