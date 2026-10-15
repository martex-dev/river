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
 *
 * There is one core per app process. It lives as long as River's screen is
 * open, or — with "Stay connected" on — as long as {@link RiverService} runs,
 * so messages keep arriving when River is closed.
 */
public final class CoreHost {
  private static final String TAG = "RiverCore";
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String CORE_URL = ORIGIN + "/assets/core/index.html";
  private static final String CHANNEL = "messages";
  public static final String EXTRA_NOTIFICATION = "river.notification";
  /** A random secret per notification, so other apps cannot fake a tap on River's notifications. */
  public static final String EXTRA_NOTIFICATION_TOKEN = "river.notification.token";
  private final Map<Integer, String> notificationTokens = new HashMap<>();
  private final java.security.SecureRandom random = new java.security.SecureRandom();

  private static CoreHost instance;

  /** Where replies and events go (the UI's plugin). */
  public interface Listener {
    void onReply(int id, String payload);

    void onEvent(String payload);
  }

  /** What only River's open screen can do: pickers, permission prompts, dialogs. */
  public interface Screen {
    AppCompatActivity activity();

    /** Asks where to save `name`; `done` gets the chosen document, or null. */
    void saveDocument(String name, java.util.function.Consumer<Uri> done);

    /** Asks for permission to post notifications, then runs `after`. */
    void requestNotifications(Runnable after);

    /** The activity River's notifications open. */
    Class<?> activityClass();
  }

  public static synchronized CoreHost get(Context context) {
    if (instance == null) instance = new CoreHost(context.getApplicationContext());
    return instance;
  }

  private final Context context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ArrayDeque<String> queue = new ArrayDeque<>();
  private final Map<Integer, Integer> notificationAsks = new HashMap<>();
  /** The core's open "call" ask: answered "hangup" (notification button) or "ended". */
  private Integer callAsk;
  private RiverNative nativeInterface;
  private WebView web;
  private boolean ready = false;
  private volatile Listener listener;
  private Screen screen;
  private int nextNotification = 1;

  private CoreHost(Context context) {
    this.context = context;
  }

  public void setListener(Listener listener) {
    this.listener = listener;
  }

  public void attach(Screen screen) {
    this.screen = screen;
  }

  public void detach(Screen screen) {
    if (this.screen == screen) this.screen = null;
  }

  public boolean running() {
    return web != null;
  }

  /** Starts the core if it is not running. Main thread only. */
  public void start() {
    if (web != null) return;
    try {
      nativeInterface = new RiverNative(context);
    } catch (java.io.IOException e) {
      fatal("River could not open its storage: " + e.getMessage());
      return;
    }
    WebViewAssetLoader assets =
        new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(context))
            .build();
    // Debug builds only: lets the emulator test inspect the core (release builds never allow it).
    if ((context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    ready = false;
    queue.clear();
    web = new WebView(context);
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

  /** Stops the core (River's screen closed and it does not stay connected). */
  public void stop() {
    if (web == null) return;
    web.destroy();
    web = null;
    ready = false;
    queue.clear();
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

  /** Someone replied from a River notification: the core sends it. */
  public void notificationReplied(int notification, String token, String text) {
    String expected = notificationTokens.get(notification);
    if (expected == null
        || token == null
        || text == null
        || !java.security.MessageDigest.isEqual(expected.getBytes(), token.getBytes())) return;
    notificationTokens.remove(notification);
    Integer ask = notificationAsks.remove(notification);
    NotificationManagerCompat.from(context).cancel(notification);
    if (ask != null) answer(ask, json("reply", text.length() > 4000 ? text.substring(0, 4000) : text));
  }

  /** A notification River posted was tapped: tell the core, which opens the conversation. */
  public void notificationTapped(int notification, String token) {
    String expected = notificationTokens.get(notification);
    if (expected == null
        || token == null
        || !java.security.MessageDigest.isEqual(expected.getBytes(), token.getBytes())) return;
    notificationTokens.remove(notification);
    Integer ask = notificationAsks.remove(notification);
    if (ask != null) answer(ask, (Object) "clicked");
  }

  /** Calls through the loudspeaker or the earpiece. */
  private void speaker(boolean on) {
    android.media.AudioManager am =
        (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (am == null) return;
    am.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
    if (android.os.Build.VERSION.SDK_INT >= 31) {
      if (!on) {
        am.clearCommunicationDevice();
        return;
      }
      for (android.media.AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
        if (d.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
          am.setCommunicationDevice(d);
          return;
        }
      }
    } else {
      am.setSpeakerphoneOn(on);
    }
  }

  /** Hang up from the "In a call" notification. */
  public void hangUp() {
    main.post(
        () -> {
          Integer ask = callAsk;
          callAsk = null;
          if (ask != null) answer(ask, (Object) "hangup");
        });
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
              context.startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            answer(id, (Object) null);
            break;
          }
        case "clipboard":
          {
            ClipboardManager cb = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cb != null) cb.setPrimaryClip(ClipData.newPlainText("River", a.optString("text")));
            answer(id, (Object) null);
            break;
          }
        case "saveFile":
          {
            Screen s = screen;
            String name = a.optString("name", "River file");
            if (s == null) {
              answer(id, json("canceled", true));
              break;
            }
            s.saveDocument(
                name,
                uri -> {
                  if (uri == null) answer(id, json("canceled", true));
                  else answer(id, json("canceled", false, "filePath", nativeInterface.files.saveTarget(uri, name)));
                });
            break;
          }
        case "notify":
          notify(id, a.optString("title", "River"), a.optString("body", ""), a.optBoolean("reply", false));
          break;
        case "appLock":
          answer(id, json("available", AppLock.setEnabled(context, a.optBoolean("enabled", false))));
          break;
        case "call":
          {
            // Stays open while the call lasts; the answer says how it ended.
            Integer previous = callAsk;
            callAsk = null;
            if (previous != null) answer(previous, (Object) "ended");
            boolean active = a.optBoolean("active", false);
            CallService.setActive(context, active);
            if (active) callAsk = id;
            else answer(id, (Object) "ended");
            break;
          }
        case "speaker":
          {
            speaker(a.optBoolean("on", false));
            answer(id, (Object) null);
            break;
          }
        case "background":
          {
            boolean on = a.optBoolean("enabled", false);
            RiverService.setEnabled(context, on);
            answer(id, json("running", on));
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
    int cancel = cancelId < 0 ? Math.max(0, count - 1) : cancelId;
    Screen s = screen;
    if (s == null) {
      // No screen to ask on: the safe answer is "cancel".
      answer(id, json("response", cancel));
      return;
    }
    String detail = a.optString("detail", "");
    AlertDialog.Builder b =
        new AlertDialog.Builder(s.activity())
            .setTitle(a.optString("title", "River"))
            .setMessage(a.optString("message", "") + (detail.isEmpty() ? "" : "\n\n" + detail))
            .setOnCancelListener(d -> answer(id, json("response", cancel)));
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
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("New messages and mentions while River is in the background");
    nm.createNotificationChannel(channel);
  }

  private boolean mayNotify() {
    return Build.VERSION.SDK_INT < 33
        || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
  }

  private void notify(int ask, String title, String body, boolean reply) {
    Screen s = screen;
    if (!mayNotify() && s != null) {
      s.requestNotifications(() -> show(ask, title, body, reply));
      return;
    }
    show(ask, title, body, reply);
  }

  private void show(int ask, String title, String body, boolean reply) {
    if (!mayNotify()) {
      answer(ask, (Object) "denied");
      return;
    }
    int n = nextNotification++;
    notificationAsks.put(n, ask);
    byte[] secret = new byte[16];
    random.nextBytes(secret);
    String token = android.util.Base64.encodeToString(secret, android.util.Base64.NO_WRAP);
    notificationTokens.put(n, token);
    Screen s = screen;
    Class<?> target = s != null ? s.activityClass() : RiverService.activityClass;
    Intent open =
        new Intent(context, target)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_NOTIFICATION, n)
            .putExtra(EXTRA_NOTIFICATION_TOKEN, token);
    PendingIntent tap =
        PendingIntent.getActivity(context, n, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
    if (reply) {
      // Reply from the notification: the text goes to the core, which sends it end-to-end encrypted.
      Intent replied =
          new Intent(context, NotificationReplyReceiver.class)
              .putExtra(EXTRA_NOTIFICATION, n)
              .putExtra(EXTRA_NOTIFICATION_TOKEN, token);
      // RemoteInput needs a mutable PendingIntent; the intent is explicit, to River's own receiver.
      int flags =
          PendingIntent.FLAG_UPDATE_CURRENT
              | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
      PendingIntent action = PendingIntent.getBroadcast(context, n, replied, flags);
      androidx.core.app.RemoteInput input =
          new androidx.core.app.RemoteInput.Builder(NotificationReplyReceiver.KEY_TEXT).setLabel("Reply").build();
      b.addAction(
          new NotificationCompat.Action.Builder(0, "Reply", action)
              .addRemoteInput(input)
              .setAllowGeneratedReplies(false)
              .build());
    }
    try {
      NotificationManagerCompat.from(context).notify(n, b.build());
    } catch (SecurityException e) {
      notificationAsks.remove(n);
      notificationTokens.remove(n);
      answer(ask, (Object) "denied");
    }
  }

  private void fatal(String details) {
    Log.e(TAG, "the client core failed to start");
    main.post(
        () -> {
          Screen s = screen;
          if (s == null) return;
          new AlertDialog.Builder(s.activity())
              .setTitle("River could not start")
              .setMessage(details)
              .setPositiveButton(android.R.string.ok, null)
              .show();
        });
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
