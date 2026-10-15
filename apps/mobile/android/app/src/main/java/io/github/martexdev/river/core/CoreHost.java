package io.github.martexdev.river.core;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Runs River's client core in its own WebView: no UI, no navigation, and the
 * only WebView with the native interface. The UI's WebView reaches it through
 * RiverCorePlugin, which hands calls over here; replies and events come back
 * the same way. This keeps the desktop's split: the UI is untrusted and never
 * sees keys, the core validates every call.
 */
public final class CoreHost {
  private static final String TAG = "RiverCore";
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String CORE_URL = ORIGIN + "/assets/core/index.html";
  private static final String CHANNEL = "messages";
  public static final String EXTRA_NOTIFICATION = "river.notification";

  /** Where replies and events go (the UI's plugin). */
  public interface Listener {
    void onReply(int id, String payload);

    void onEvent(String payload);
  }

  private final AppCompatActivity activity;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ArrayDeque<String> queue = new ArrayDeque<>();
  private final Map<Integer, Integer> notificationAsks = new HashMap<>();
  private final ActivityResultLauncher<Intent> saveLauncher;
  private final ActivityResultLauncher<String> notificationPermission;
  private RiverNative nativeInterface;
  private AppLock appLock;
  private WebView web;
  private boolean ready = false;
  private volatile Listener listener;
  private int pendingSaveAsk = -1;
  private String pendingSaveName = "";
  private int nextNotification = 1;
  private Runnable afterPermission;

  /** Call from onCreate, before the activity starts (activity results are registered here). */
  public CoreHost(AppCompatActivity activity) {
    this.activity = activity;
    saveLauncher =
        activity.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
              int ask = pendingSaveAsk;
              pendingSaveAsk = -1;
              if (ask < 0) return;
              Uri uri = result.getData() == null ? null : result.getData().getData();
              if (result.getResultCode() != android.app.Activity.RESULT_OK || uri == null) {
                answer(ask, json("canceled", true));
                return;
              }
              String path = nativeInterface.files.saveTarget(uri, pendingSaveName);
              answer(ask, json("canceled", false, "filePath", path));
            });
    notificationPermission =
        activity.registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
              Runnable next = afterPermission;
              afterPermission = null;
              if (next != null) next.run();
            });
  }

  public void setAppLock(AppLock lock) {
    this.appLock = lock;
  }

  public void setListener(Listener listener) {
    this.listener = listener;
  }

  public void start() {
    try {
      nativeInterface = new RiverNative(activity);
    } catch (java.io.IOException e) {
      fatal("River could not open its storage: " + e.getMessage());
      return;
    }
    WebViewAssetLoader assets =
        new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(activity))
            .build();
    // Debug builds only: lets the emulator test inspect the core (release builds never allow it).
    if ((activity.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    web = new WebView(activity);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(false);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setSupportMultipleWindows(false);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assets.shouldInterceptRequest(request.getUrl());
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // The core never navigates.
            return true;
          }
        });
    web.addJavascriptInterface(nativeInterface, "RiverNative");
    web.addJavascriptInterface(new Shell(), "RiverHost");
    web.loadUrl(CORE_URL);
    createChannel();
  }

  public void destroy() {
    if (web != null) {
      web.destroy();
      web = null;
    }
  }

  // ---- UI → core ----

  public void invoke(int id, String json) {
    run("__riverCore.invoke(" + id + "," + JSONObject.quote(json) + ")");
  }

  public void send(String json) {
    run("__riverCore.send(" + JSONObject.quote(json) + ")");
  }

  public void lifecycle(boolean foreground) {
    run("__riverCore.lifecycle('" + (foreground ? "foreground" : "background") + "')");
  }

  public void deepLink(String url) {
    run("__riverCore.deepLink(" + JSONObject.quote(url) + ")");
  }

  /** A notification River posted was tapped: tell the core, which opens the conversation. */
  public void notificationTapped(int notification) {
    Integer ask = notificationAsks.remove(notification);
    if (ask != null) answer(ask, (Object) "clicked");
  }

  private void answer(int id, Object value) {
    String payload;
    try {
      payload = new JSONObject().put("ok", true).put("value", value == null ? JSONObject.NULL : value).toString();
    } catch (Exception e) {
      payload = "{\"ok\":false,\"error\":\"failed\"}";
    }
    answerPayload(id, payload);
  }

  private void answerPayload(int id, String payload) {
    run("__riverCore.answer(" + id + "," + JSONObject.quote(payload) + ")");
  }

  /** Runs a call in the core once it is ready, on the main thread. */
  private void run(String js) {
    main.post(
        () -> {
          if (web == null) return;
          if (!ready) {
            queue.add(js);
            return;
          }
          web.evaluateJavascript(js, null);
        });
  }

  // ---- core → UI and shell ----

  private final class Shell {
    @JavascriptInterface
    public void post(String header, String payload) {
      try {
        JSONObject h = new JSONObject(header);
        switch (h.getString("t")) {
          case "ready":
            main.post(
                () -> {
                  ready = true;
                  while (!queue.isEmpty() && web != null) web.evaluateJavascript(queue.poll(), null);
                });
            break;
          case "reply":
            if (listener != null) listener.onReply(h.getInt("id"), payload);
            break;
          case "event":
            if (payload.startsWith("{\"channel\":\"core:fatal\"")) {
              JSONArray args = new JSONObject(payload).getJSONArray("args");
              fatal(args.optString(0, "unknown error"));
            }
            if (listener != null) listener.onEvent(payload);
            break;
          case "ask":
            {
              int id = h.getInt("id");
              String kind = h.getString("kind");
              main.post(() -> ask(id, kind, payload));
              break;
            }
          default:
            break;
        }
      } catch (Exception e) {
        Log.w(TAG, "bad message from the core: " + e.getClass().getSimpleName());
      }
    }
  }

  private void ask(int id, String kind, String payload) {
    try {
      JSONObject a = payload.isEmpty() ? new JSONObject() : new JSONObject(payload);
      switch (kind) {
        case "messageBox":
          messageBox(id, a);
          break;
        case "openUrl":
          {
            Uri uri = Uri.parse(a.getString("url"));
            String scheme = uri.getScheme();
            if ("https".equals(scheme) || "http".equals(scheme)) {
              activity.startActivity(new Intent(Intent.ACTION_VIEW, uri));
            }
            answer(id, (Object) null);
            break;
          }
        case "clipboard":
          {
            ClipboardManager cb = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("River", a.optString("text")));
            answer(id, (Object) null);
            break;
          }
        case "saveFile":
          {
            pendingSaveAsk = id;
            pendingSaveName = a.optString("name", "River file");
            Intent intent =
                new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/octet-stream")
                    .putExtra(Intent.EXTRA_TITLE, pendingSaveName);
            saveLauncher.launch(intent);
            break;
          }
        case "notify":
          notify(id, a.optString("title", "River"), a.optString("body", ""));
          break;
        case "appLock":
          {
            boolean available = appLock != null && appLock.setEnabled(a.optBoolean("enabled", false));
            answer(id, json("available", available));
            break;
          }
        default:
          answerPayload(id, "{\"ok\":false,\"error\":\"not available on this phone\"}");
      }
    } catch (Exception e) {
      answerPayload(id, "{\"ok\":false,\"error\":\"failed\"}");
    }
  }

  private void messageBox(int id, JSONObject a) throws Exception {
    JSONArray buttons = a.optJSONArray("buttons");
    int count = buttons == null ? 0 : Math.min(buttons.length(), 3);
    int cancelId = a.optInt("cancelId", -1);
    String detail = a.optString("detail", "");
    AlertDialog.Builder b =
        new AlertDialog.Builder(activity)
            .setTitle(a.optString("title", "River"))
            .setMessage(a.optString("message", "") + (detail.isEmpty() ? "" : "\n\n" + detail))
            .setOnCancelListener(d -> answer(id, json("response", cancelId < 0 ? Math.max(0, count - 1) : cancelId)));
    if (count == 0) {
      b.setPositiveButton(android.R.string.ok, (d, w) -> answer(id, json("response", 0)));
    }
    if (count >= 1) b.setPositiveButton(buttons.getString(0), (d, w) -> answer(id, json("response", 0)));
    if (count >= 2) b.setNegativeButton(buttons.getString(1), (d, w) -> answer(id, json("response", 1)));
    if (count >= 3) b.setNeutralButton(buttons.getString(2), (d, w) -> answer(id, json("response", 2)));
    b.show();
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = activity.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel channel =
        new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("New messages and mentions while River is in the background");
    nm.createNotificationChannel(channel);
  }

  private void notify(int ask, String title, String body) {
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      afterPermission = () -> show(ask, title, body);
      notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
      return;
    }
    show(ask, title, body);
  }

  private void show(int ask, String title, String body) {
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
      answer(ask, (Object) "denied");
      return;
    }
    int n = nextNotification++;
    notificationAsks.put(n, ask);
    Intent open =
        new Intent(activity, activity.getClass())
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_NOTIFICATION, n);
    PendingIntent tap =
        PendingIntent.getActivity(activity, n, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(activity, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
    try {
      NotificationManagerCompat.from(activity).notify(n, b.build());
    } catch (SecurityException e) {
      notificationAsks.remove(n);
      answer(ask, (Object) "denied");
    }
  }

  private void fatal(String details) {
    Log.e(TAG, "the client core failed to start");
    main.post(
        () ->
            new AlertDialog.Builder(activity)
                .setTitle("River could not start")
                .setMessage(details)
                .setPositiveButton(android.R.string.ok, null)
                .show());
  }

  private static JSONObject json(Object... pairs) {
    JSONObject o = new JSONObject();
    try {
      for (int i = 0; i + 1 < pairs.length; i += 2) o.put((String) pairs[i], pairs[i + 1]);
    } catch (Exception ignored) {
      // keys are constants
    }
    return o;
  }
}
