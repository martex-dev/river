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
import android.os.SystemClock;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
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
 * so messages keep arriving when River is closed. It outlives screens: what
 * it asked of one (no screenshots, picture-in-picture, call volume) is kept
 * here and given to the next.
 */
public final class CoreHost {
  private static final String TAG = "RiverCore";
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String CORE_URL = ORIGIN + "/assets/core/index.html";
  private static final String CHANNEL = "messages";
  private static final String CALL_CHANNEL = "calls";
  /** Notifications whose answer the core still waits for; older ones are answered "dismissed". */
  private static final int MAX_PENDING_NOTIFICATIONS = 32;
  /** An incoming call's notification rings this long (then Android removes it). */
  private static final long CALL_NOTIFICATION_MS = 45_000;
  /** Set on the screen opened by an incoming call: it may show over the lock screen. */
  public static final String EXTRA_CALL = "river.call";
  public static final String EXTRA_NOTIFICATION = "river.notification";
  /** A random secret per notification, so other apps cannot fake a tap on River's notifications. */
  public static final String EXTRA_NOTIFICATION_TOKEN = "river.notification.token";
  private final Map<Integer, String> notificationTokens = new HashMap<>();
  private final java.security.SecureRandom random = new java.security.SecureRandom();

  private static CoreHost instance;

  /** Where replies and events go (the UI's plugin). Called on the main thread. */
  public interface Listener {
    void onReply(int id, String payload);

    void onEvent(String payload);

    /** The core was replaced (its WebView crashed): calls still waiting will get no reply. */
    default void onCoreRestarted() {}
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

    /** While a call is on, leaving River shows it in picture-in-picture (2.10). */
    default void pip(boolean allowed) {}

    /** An incoming call may show River over the lock screen; false ends that. */
    default void showOverLock(boolean on) {}
  }

  public static synchronized CoreHost get(Context context) {
    if (instance == null) instance = new CoreHost(context.getApplicationContext());
    return instance;
  }

  private final Context context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ArrayDeque<String> queue = new ArrayDeque<>();
  /** Notification → the core's ask, oldest first. */
  private final LinkedHashMap<Integer, Integer> notificationAsks = new LinkedHashMap<>();
  /** The core's open "call" ask: answered "hangup" (notification button) or "ended". */
  private Integer callAsk;
  private RiverNative nativeInterface;
  private WebView web;
  private boolean ready = false;
  private volatile Listener listener;
  private Screen screen;
  private int nextNotification = 1;
  /**
   * Which core is running. Each start is a new core whose ask ids start again at 1, so an answer
   * that arrives later (a dialog, a picker, a permission prompt) only goes to the core that asked.
   */
  private volatile int generation = 0;
  /** UI call ids: from here, not per plugin, so a reply never resolves a newer screen's call. */
  private final AtomicInteger nextCallId = new AtomicInteger(1);
  /** River's screen is in front (the core starts in the background until it is). */
  private boolean foreground = false;
  /** What the core asked of the screen, given again to the next one. */
  private Boolean screenSecure;
  private boolean pipAllowed;
  private final List<AlertDialog> dialogs = new ArrayList<>();
  private final ArrayDeque<Long> crashes = new ArrayDeque<>();

  private CoreHost(Context context) {
    this.context = context;
  }

  public void setListener(Listener listener) {
    this.listener = listener;
  }

  /** The plugin of a closed screen lets go (it would hold the old activity). */
  public void clearListener(Listener listener) {
    if (this.listener == listener) this.listener = null;
  }

  /** An id for a UI call, unique for this app process. */
  public int nextCallId() {
    return nextCallId.getAndIncrement();
  }

  public void attach(Screen screen) {
    this.screen = screen;
    // River's screen opened again while the core kept running: it gets what the core asked for.
    android.view.Window w = screen.activity().getWindow();
    if (Boolean.TRUE.equals(screenSecure)) w.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
    if (inCall) screen.activity().setVolumeControlStream(android.media.AudioManager.STREAM_VOICE_CALL);
    if (pipAllowed) {
      main.post(
          () -> {
            if (this.screen == screen && pipAllowed) screen.pip(true);
          });
    }
  }

  public void detach(Screen screen) {
    if (this.screen != screen) return;
    // A dialog still open answers "cancel" rather than never.
    for (AlertDialog d : new ArrayList<>(dialogs)) d.dismiss();
    dialogs.clear();
    this.screen = null;
    // The UI's WebView (and a call's sound and video with it) ends with the screen.
    if (web != null) run("__riverCore.uiGone()");
  }

  public boolean running() {
    return web != null;
  }

  /** In a call or a voice channel right now. */
  public boolean inCall() {
    return inCall;
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
    final int gen = ++generation;
    ready = false;
    queue.clear();
    clearNotifications();
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

          @Override
          public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The core's renderer crashed or was ended to free memory. Returning true keeps
            // River running; the dead WebView is replaced by a new core.
            Log.w(TAG, "the core's renderer ended (crashed: " + detail.didCrash() + ")");
            if (view == web && gen == generation) main.post(() -> restartAfterCrash(gen));
            else view.destroy();
            return true;
          }
        });
    web.addJavascriptInterface(nativeInterface, "RiverNative");
    web.addJavascriptInterface(new Shell(gen), "RiverHost");
    web.loadUrl(CORE_URL);
    createChannel();
    // The core starts in the background; tell it if River's screen is already in front.
    if (foreground) lifecycle(true);
  }

  /** Stops the core (River's screen closed and it does not stay connected). */
  public void stop() {
    teardown();
  }

  private void teardown() {
    if (web == null) return;
    generation++;
    web.destroy();
    web = null;
    ready = false;
    queue.clear();
    if (nativeInterface != null) nativeInterface.close();
    nativeInterface = null;
    // Nothing of the call outlives the core: no "In a call" notification, no wake lock, no call audio.
    callAsk = null;
    CallService.setActive(context, false);
    callAudio(false);
    pipAllowed = false;
    Screen s = screen;
    if (s != null) {
      s.pip(false);
      s.showOverLock(false);
    }
    clearNotifications();
  }

  /** Replaces a core whose WebView died, unless it keeps dying. */
  private void restartAfterCrash(int gen) {
    if (web == null || gen != generation) return;
    long now = SystemClock.elapsedRealtime();
    while (!crashes.isEmpty() && now - crashes.peekFirst() > 60_000) crashes.pollFirst();
    crashes.addLast(now);
    teardown();
    Listener l = listener;
    if (l != null) l.onCoreRestarted();
    if (crashes.size() > 3) {
      fatal("River's core stopped several times in a row. Close River and open it again.");
      return;
    }
    start();
  }

  /**
   * The core's notifications belong to its asks: when the core goes, they go too, so a tap or a
   * reply can never answer a newer core's ask with the same number.
   */
  private void clearNotifications() {
    NotificationManagerCompat nm = NotificationManagerCompat.from(context);
    for (Integer n : notificationAsks.keySet()) nm.cancel(n);
    notificationAsks.clear();
    notificationTokens.clear();
  }

  // ---- UI → core ----

  public void invoke(int id, String json) {
    run("__riverCore.invoke(" + id + "," + JSONObject.quote(json) + ")");
  }

  public void send(String json) {
    run("__riverCore.send(" + JSONObject.quote(json) + ")");
  }

  public void lifecycle(boolean foreground) {
    this.foreground = foreground;
    run("__riverCore.lifecycle('" + (foreground ? "foreground" : "background") + "')");
  }

  public void deepLink(String url) {
    run("__riverCore.deepLink(" + JSONObject.quote(url) + ")");
  }

  private boolean tokenMatches(int notification, String token) {
    String expected = notificationTokens.get(notification);
    return expected != null
        && token != null
        && java.security.MessageDigest.isEqual(expected.getBytes(), token.getBytes());
  }

  /** Someone replied from a River notification: the core sends it. Main thread. */
  public void notificationReplied(int notification, String token, String text) {
    if (text == null || !tokenMatches(notification, token) || web == null) {
      // The core that posted it is gone (River was closed, or Android ended it): say so on the
      // notification rather than dropping the reply without a word.
      replyFailed(notification);
      return;
    }
    notificationTokens.remove(notification);
    Integer ask = notificationAsks.remove(notification);
    NotificationManagerCompat.from(context).cancel(notification);
    if (ask != null) answer(ask, json("reply", text.length() > 4000 ? text.substring(0, 4000) : text));
    else replyFailed(notification);
  }

  /** A notification River posted was tapped: tell the core, which opens the conversation. */
  public void notificationTapped(int notification, String token) {
    if (!tokenMatches(notification, token)) return;
    notificationTokens.remove(notification);
    Integer ask = notificationAsks.remove(notification);
    if (ask != null) answer(ask, (Object) "clicked");
  }

  /** A notification River posted was swiped away (or cleared). Main thread. */
  public void notificationDismissed(int notification, String token) {
    if (!tokenMatches(notification, token)) return;
    expire(notification);
  }

  /** The core stops waiting for this notification. */
  private void expire(int notification) {
    notificationTokens.remove(notification);
    Integer ask = notificationAsks.remove(notification);
    if (ask != null) answer(ask, (Object) "dismissed");
  }

  /** A reply that could not be sent: the notification says so and opens River. */
  private void replyFailed(int notification) {
    if (notification <= 0 || !mayNotify()) return;
    createChannel();
    Intent open =
        new Intent(context, RiverService.ACTIVITY)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent tap =
        PendingIntent.getActivity(
            context, notification, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle("Reply not sent")
            .setContentText("River was closed. Open River to send it.")
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap);
    try {
      NotificationManagerCompat.from(context).notify(notification, b.build());
    } catch (SecurityException ignored) {
      // notifications were turned off meanwhile
    }
  }

  /**
   * During a call the volume buttons set the call's volume (not media volume, which the call
   * does not use); afterwards the phone's audio goes back to normal.
   */
  private void callAudio(boolean active) {
    inCall = active;
    if (!active) earpiece = false;
    updateProximity();
    Screen s = screen;
    if (s != null) {
      s.activity()
          .setVolumeControlStream(
              active
                  ? android.media.AudioManager.STREAM_VOICE_CALL
                  : android.media.AudioManager.USE_DEFAULT_STREAM_TYPE);
    }
    if (active) return;
    android.media.AudioManager am =
        (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (am == null) return;
    if (android.os.Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
    else am.setSpeakerphoneOn(false);
    am.setMode(android.media.AudioManager.MODE_NORMAL);
  }

  // ---- the screen goes dark at your ear (2.10.2), as in any phone call ----

  private boolean inCall;
  /** River put the call on the earpiece (not the loudspeaker, not headphones' default). */
  private boolean earpiece;
  private android.os.PowerManager.WakeLock proximity;

  private void updateProximity() {
    try {
      if (inCall && earpiece) {
        if (proximity == null) {
          android.os.PowerManager pm =
              (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
          if (pm == null
              || !pm.isWakeLockLevelSupported(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return;
          proximity =
              pm.newWakeLock(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "river:call-proximity");
          proximity.setReferenceCounted(false);
        }
        if (!proximity.isHeld()) proximity.acquire(4 * 60 * 60 * 1000L);
      } else if (proximity != null && proximity.isHeld()) {
        proximity.release(android.os.PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY);
      }
    } catch (RuntimeException e) {
      // no proximity sensor here: the screen just stays on
    }
  }

  /** Calls through the loudspeaker or the earpiece. */
  private void speaker(boolean on) {
    earpiece = !on;
    updateProximity();
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

  /** An answer that comes later: only for the core that asked (see {@link #generation}). */
  private void answerLater(int gen, int id, Object value) {
    if (gen == generation) answer(id, value);
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

  /** RiverHost in one core's WebView; a replaced core's last messages are dropped. */
  private final class Shell {
    private final int gen;

    Shell(int gen) {
      this.gen = gen;
    }

    /** Called on the WebView's JavaBridge thread: everything moves to the main thread. */
    @JavascriptInterface
    public void post(String header, String payload) {
      if (gen != generation) return;
      try {
        JSONObject h = new JSONObject(header);
        switch (h.getString("t")) {
          case "ready":
            main.post(
                () -> {
                  if (gen != generation) return;
                  ready = true;
                  while (!queue.isEmpty() && web != null) web.evaluateJavascript(queue.poll(), null);
                });
            break;
          case "reply":
            {
              int id = h.getInt("id");
              main.post(
                  () -> {
                    Listener l = listener;
                    if (l != null && gen == generation) l.onReply(id, payload);
                  });
              break;
            }
          case "event":
            if (payload.startsWith("{\"channel\":\"core:fatal\"")) {
              JSONArray args = new JSONObject(payload).getJSONArray("args");
              fatal(args.optString(0, "unknown error"));
            }
            main.post(
                () -> {
                  Listener l = listener;
                  if (l != null && gen == generation) l.onEvent(payload);
                });
            break;
          case "ask":
            {
              int id = h.getInt("id");
              String kind = h.getString("kind");
              main.post(
                  () -> {
                    if (gen == generation) ask(id, kind, payload);
                  });
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
    final int gen = generation;
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
                  RiverNative n = nativeInterface;
                  if (gen != generation || n == null) return;
                  if (uri == null) answer(id, json("canceled", true));
                  else answer(id, json("canceled", false, "filePath", n.files.saveTarget(uri, name)));
                });
            break;
          }
        case "notify":
          notify(
              id,
              a.optString("title", "River"),
              a.optString("body", ""),
              a.optBoolean("reply", false),
              a.optBoolean("call", false));
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
            callAudio(active);
            if (active) callAsk = id;
            else {
              answer(id, (Object) "ended");
              // The call is over: River no longer shows over the lock screen.
              Screen s = screen;
              if (s != null) s.showOverLock(false);
            }
            break;
          }
        case "ringing":
          {
            // An incoming call stopped ringing (declined, missed, or the caller gave up).
            Screen s = screen;
            if (!a.optBoolean("on", false) && !inCall && s != null) s.showOverLock(false);
            answer(id, (Object) null);
            break;
          }
        case "pip":
          {
            pipAllowed = a.optBoolean("on", false);
            Screen s = screen;
            if (s != null) s.pip(pipAllowed);
            answer(id, (Object) null);
            break;
          }
        case "haptic":
          {
            // The phone's own haptics: no permission, and off when the user turned touch feedback off.
            Screen s = screen;
            if (s != null) {
              String k = a.optString("kind", "tap");
              int effect =
                  "select".equals(k)
                      ? android.view.HapticFeedbackConstants.LONG_PRESS
                      : "success".equals(k) && android.os.Build.VERSION.SDK_INT >= 30
                          ? android.view.HapticFeedbackConstants.CONFIRM
                          : "warning".equals(k) && android.os.Build.VERSION.SDK_INT >= 30
                              ? android.view.HapticFeedbackConstants.REJECT
                              : android.view.HapticFeedbackConstants.KEYBOARD_TAP;
              s.activity().getWindow().getDecorView().performHapticFeedback(effect);
            }
            answer(id, (Object) null);
            break;
          }
        case "screenSecurity":
          {
            boolean on = a.optBoolean("on", false);
            // Kept: a screen that opens later (River reopened from "Stay connected") gets it too.
            screenSecure = on;
            Screen s = screen;
            if (s != null) {
              android.view.Window w = s.activity().getWindow();
              if (on) w.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
              else w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            }
            answer(id, (Object) null);
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
        case "update.device":
        case "update.download":
        case "update.progress":
        case "update.signers":
        case "update.install":
          // River's own signed updates (UpdateOps); answers may come later, from another thread.
          UpdateOps.get(context)
              .ask(
                  kind,
                  a,
                  reply -> {
                    if (gen == generation) answerPayload(id, reply);
                  });
          break;
        default:
          answerPayload(id, "{\"ok\":false,\"error\":\"not available on this phone\"}");
      }
    } catch (Exception e) {
      answerPayload(id, "{\"ok\":false,\"error\":\"failed\"}");
    }
  }

  private void messageBox(int id, JSONObject a) throws Exception {
    final int gen = generation;
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
    // Answered exactly once: by a button, or as "cancel" however else the dialog goes away.
    AtomicBoolean answered = new AtomicBoolean(false);
    java.util.function.IntConsumer respond =
        response -> {
          if (answered.compareAndSet(false, true)) answerLater(gen, id, json("response", response));
        };
    String detail = a.optString("detail", "");
    AlertDialog.Builder b =
        new AlertDialog.Builder(s.activity())
            .setTitle(a.optString("title", "River"))
            .setMessage(a.optString("message", "") + (detail.isEmpty() ? "" : "\n\n" + detail));
    if (count == 0) {
      b.setPositiveButton(android.R.string.ok, (d, w) -> respond.accept(0));
    }
    if (count >= 1) b.setPositiveButton(buttons.getString(0), (d, w) -> respond.accept(0));
    if (count >= 2) b.setNegativeButton(buttons.getString(1), (d, w) -> respond.accept(1));
    if (count >= 3) b.setNeutralButton(buttons.getString(2), (d, w) -> respond.accept(2));
    AlertDialog dialog = b.create();
    dialog.setOnDismissListener(
        d -> {
          dialogs.remove(dialog);
          respond.accept(cancel);
        });
    dialogs.add(dialog);
    try {
      dialog.show();
    } catch (RuntimeException e) {
      // the screen is closing: the safe answer is "cancel"
      dialogs.remove(dialog);
      respond.accept(cancel);
    }
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("New messages and mentions while River is in the background");
    nm.createNotificationChannel(channel);
    // Incoming calls ring with the phone's ringtone, like any calling app.
    NotificationChannel calls = new NotificationChannel(CALL_CHANNEL, "Calls", NotificationManager.IMPORTANCE_HIGH);
    calls.setDescription("Incoming calls while River is in the background");
    calls.setSound(
        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE),
        new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
    calls.enableVibration(true);
    nm.createNotificationChannel(calls);
  }

  private boolean mayNotify() {
    return Build.VERSION.SDK_INT < 33
        || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
  }

  private void notify(int ask, String title, String body, boolean reply, boolean call) {
    Screen s = screen;
    if (!mayNotify() && s != null && foreground) {
      // Android 13+: asked only while River is in front (a prompt cannot show from the background).
      final int gen = generation;
      s.requestNotifications(
          () -> {
            if (gen == generation) show(ask, title, body, reply, call);
          });
      return;
    }
    show(ask, title, body, reply, call);
  }

  private void show(int ask, String title, String body, boolean reply, boolean call) {
    if (!mayNotify()) {
      answer(ask, (Object) "denied");
      return;
    }
    // Only so many notifications wait for an answer; the oldest stops waiting.
    Iterator<Map.Entry<Integer, Integer>> oldest = notificationAsks.entrySet().iterator();
    while (notificationAsks.size() >= MAX_PENDING_NOTIFICATIONS && oldest.hasNext()) {
      Map.Entry<Integer, Integer> e = oldest.next();
      int stale = e.getKey();
      int staleAsk = e.getValue();
      oldest.remove();
      notificationTokens.remove(stale);
      answer(staleAsk, (Object) "dismissed");
    }
    int n = nextNotification++;
    notificationAsks.put(n, ask);
    byte[] secret = new byte[16];
    random.nextBytes(secret);
    String token = android.util.Base64.encodeToString(secret, android.util.Base64.NO_WRAP);
    notificationTokens.put(n, token);
    Screen s = screen;
    Class<?> target = s != null ? s.activityClass() : RiverService.ACTIVITY;
    Intent open =
        new Intent(context, target)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_NOTIFICATION, n)
            .putExtra(EXTRA_NOTIFICATION_TOKEN, token)
            .putExtra(EXTRA_CALL, call);
    PendingIntent tap =
        PendingIntent.getActivity(context, n, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    // Swiped away: the core stops waiting for it.
    Intent dismissed =
        new Intent(context, NotificationReplyReceiver.class)
            .setAction(NotificationReplyReceiver.ACTION_DISMISSED)
            .putExtra(EXTRA_NOTIFICATION, n)
            .putExtra(EXTRA_NOTIFICATION_TOKEN, token);
    PendingIntent delete =
        PendingIntent.getBroadcast(
            context, n, dismissed, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, call ? CALL_CHANNEL : CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setDeleteIntent(delete)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
    if (call) {
      // Rings for as long as the call does, and fills the screen when the phone is locked.
      b.setCategory(NotificationCompat.CATEGORY_CALL)
          .setTimeoutAfter(CALL_NOTIFICATION_MS)
          .setFullScreenIntent(tap, true);
      // Android removes it after the timeout without telling River: stop waiting then too.
      final int gen = generation;
      main.postDelayed(
          () -> {
            if (gen == generation) expire(n);
          },
          CALL_NOTIFICATION_MS + 1_000);
    }
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
