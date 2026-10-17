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
  /** Message notifications on screen, kept (as plain, generic ones) when the core restarts. */
  private final java.util.Set<Integer> posted = new java.util.LinkedHashSet<>();
  private final MessageNotifications messages = new MessageNotifications();
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
  /**
   * The core's open "incomingCall" ask (2.11): answered "accept" or "decline" (the call screen or
   * notification), "timeout" (nobody answered) or "ended" (it stopped ringing for another reason).
   */
  private Integer incomingAsk;
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
  private volatile boolean foreground = false;
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

  /** River's screen is open (in front or not). Main thread. */
  public boolean hasScreen() {
    return screen != null;
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
    watchNetwork(gen);
    // The core starts in the background; tell it if River's screen is already in front.
    if (foreground) lifecycle(true);
  }

  // ---- the phone's network (2.12) ----

  private android.net.ConnectivityManager.NetworkCallback network;

  /**
   * A new network (Wi-Fi to mobile data, another Wi-Fi, back from no network): the core checks its
   * connection at once (the old one may be dead without either side noticing, and a reconnect may
   * be waiting out its backoff), as when the watchdog wakes it.
   */
  private void watchNetwork(int gen) {
    unwatchNetwork();
    android.net.ConnectivityManager cm = context.getSystemService(android.net.ConnectivityManager.class);
    if (cm == null) return;
    android.net.Network now;
    try {
      now = cm.getActiveNetwork();
    } catch (RuntimeException e) {
      now = null;
    }
    final android.net.Network initial = now;
    android.net.ConnectivityManager.NetworkCallback callback =
        new android.net.ConnectivityManager.NetworkCallback() {
          /** The network the core is on (Android reports it again as soon as this listens). */
          private android.net.Network current = initial;

          @Override
          public void onAvailable(android.net.Network n) {
            boolean changed = !n.equals(current);
            current = n;
            if (changed && gen == generation) wake();
          }

          @Override
          public void onLost(android.net.Network n) {
            if (n.equals(current)) current = null;
          }
        };
    try {
      // Called on Android's connectivity thread; wake() hands over to the main thread.
      cm.registerDefaultNetworkCallback(callback);
      network = callback;
    } catch (RuntimeException e) {
      Log.w(TAG, "cannot watch the network: " + e.getClass().getSimpleName());
    }
  }

  private void unwatchNetwork() {
    android.net.ConnectivityManager.NetworkCallback callback = network;
    network = null;
    if (callback == null) return;
    android.net.ConnectivityManager cm = context.getSystemService(android.net.ConnectivityManager.class);
    try {
      if (cm != null) cm.unregisterNetworkCallback(callback);
    } catch (RuntimeException ignored) {
      // not registered
    }
  }

  /** Stops the core (River's screen closed and it does not stay connected). */
  public void stop() {
    teardown();
  }

  /** How long a closing screen's call has to tell the other side before the core stops. */
  private static final long CALL_END_GRACE_MS = 2_000;

  /**
   * Stops the core a moment after River's screen closed (2.11.3): {@link #detach} told the core its
   * screen is gone, and the core tells the other side of a call (also one still ringing on their
   * side) that it ended — which needs the core a moment longer. A screen that opens meanwhile
   * keeps the core.
   */
  public void stopAfterCall() {
    if (web == null) return;
    final int gen = generation;
    main.postDelayed(
        () -> {
          // Stay connected started again meanwhile (its service needs the core): keep it.
          if (gen == generation && screen == null && !RiverService.running()) teardown();
        },
        CALL_END_GRACE_MS);
  }

  private void teardown() {
    if (web == null) return;
    generation++;
    unwatchNetwork();
    web.destroy();
    web = null;
    ready = false;
    queue.clear();
    if (nativeInterface != null) nativeInterface.close();
    nativeInterface = null;
    // Nothing of the call outlives the core: no "In a call" notification, no wake lock, no call audio.
    callAsk = null;
    incomingAsk = null;
    overLockForCall = false;
    IncomingCall.stop(context);
    CallService.setActive(context, false, null);
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
   * The core's notifications belong to its asks: when the core goes (it crashed, Android ended its
   * renderer, or River closed), its asks go with it, so a tap or a reply can never answer a newer
   * core's ask. The notifications themselves stay on screen: each message notification still
   * showing is posted again as a plain one that opens River (no Reply, which needed the old core).
   * It says only "New message — open River" (2.11.2): River may have stopped because it was locked
   * or signed out, and the old text must not stay readable after that.
   * Notification numbers are never reused within the app's process.
   */
  private void clearNotifications() {
    notificationAsks.clear();
    notificationTokens.clear();
    messages.restarted();
    if (posted.isEmpty()) return;
    java.util.Set<Integer> showing = new java.util.HashSet<>();
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm != null) {
      try {
        for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications())
          showing.add(sbn.getId());
      } catch (RuntimeException ignored) {
        // cannot tell which still show: bring none back rather than ones that were swiped away
      }
    }
    for (int n : posted) {
      if (!showing.contains(n) || !mayNotify()) continue;
      Intent open =
          new Intent(context, RiverService.ACTIVITY)
              .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent tap =
          PendingIntent.getActivity(
              context, n, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      NotificationCompat.Builder b =
          new NotificationCompat.Builder(context, CHANNEL)
              .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
              .setContentTitle("River")
              .setContentText("New message — open River")
              .setAutoCancel(true)
              .setOnlyAlertOnce(true)
              .setSilent(true)
              .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
              .setPublicVersion(
                  new NotificationCompat.Builder(context, CHANNEL)
                      .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
                      .setContentTitle("River")
                      .setContentText("New message")
                      .build())
              .setContentIntent(tap);
      try {
        NotificationManagerCompat.from(context).notify(n, b.build());
      } catch (SecurityException ignored) {
        // notifications turned off meanwhile
      }
    }
    posted.clear();
  }

  /**
   * Signed out, or this account was removed (2.11.2): the message notifications of the account
   * go away entirely instead of staying readable. The core stops waiting for them.
   */
  private void dropMessageNotifications() {
    NotificationManagerCompat nm = NotificationManagerCompat.from(context);
    for (int n : new ArrayList<>(posted)) {
      nm.cancel(n);
      expire(n);
    }
    posted.clear();
  }

  // ---- UI → core ----

  public void invoke(int id, String json) {
    run("__riverCore.invoke(" + id + "," + JSONObject.quote(json) + ")");
  }

  public void send(String json) {
    run("__riverCore.send(" + JSONObject.quote(json) + ")");
  }

  /** River's screen is in front: activities may open (Android blocks them from the background). */
  public boolean isForeground() {
    return foreground;
  }

  public void lifecycle(boolean foreground) {
    this.foreground = foreground;
    // River's interface rings by itself while it is in front; otherwise the phone's call screen.
    IncomingCall.setForeground(context, foreground);
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
    forget(notification);
    Integer ask = notificationAsks.remove(notification);
    NotificationManagerCompat.from(context).cancel(notification);
    if (ask != null) answer(ask, json("reply", text.length() > 4000 ? text.substring(0, 4000) : text));
    else replyFailed(notification);
  }

  /** A notification River posted was tapped: tell the core, which opens the conversation. */
  public void notificationTapped(int notification, String token) {
    if (!tokenMatches(notification, token)) return;
    notificationTokens.remove(notification);
    forget(notification);
    Integer ask = notificationAsks.remove(notification);
    if (ask != null) answer(ask, (Object) "clicked");
  }

  /** The notification is gone: its conversation's next message starts a new one. */
  private void forget(int notification) {
    posted.remove(notification);
    messages.forget(notification);
  }

  /** A notification River posted was swiped away (or cleared). Main thread. */
  public void notificationDismissed(int notification, String token) {
    if (!tokenMatches(notification, token)) return;
    expire(notification);
  }

  /** The core stops waiting for this notification. */
  private void expire(int notification) {
    notificationTokens.remove(notification);
    forget(notification);
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
    if (!active) {
      earpiece = false;
      if (bluetoothSco) stopBluetoothSco();
    }
    updateProximity();
    Screen s = screen;
    if (s != null) {
      s.activity()
          .setVolumeControlStream(
              active
                  ? android.media.AudioManager.STREAM_VOICE_CALL
                  : android.media.AudioManager.USE_DEFAULT_STREAM_TYPE);
    }
    if (active) {
      callAudioSet = true;
      return;
    }
    // 2.12: only audio River set up for a call goes back to normal. River closing, its core
    // restarting or a call declined here set every app's audio to normal — also in the middle of
    // another app's call (WhatsApp, the phone's own), cutting its microphone or loudspeaker.
    if (!callAudioSet) return;
    callAudioSet = false;
    android.media.AudioManager am =
        (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (am == null) return;
    if (android.os.Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
    else am.setSpeakerphoneOn(false);
    am.setMode(android.media.AudioManager.MODE_NORMAL);
  }

  // ---- the screen goes dark at your ear (2.10.2), as in any phone call ----

  private boolean inCall;
  /** River set the phone's audio up for a call (call mode, loudspeaker, headset) since it was reset. */
  private boolean callAudioSet;
  /** River put the call on the earpiece (not the loudspeaker, not a headset). */
  private boolean earpiece;
  /** Android 8 to 11: River turned on a Bluetooth headset's call audio (SCO) for the call. */
  private boolean bluetoothSco;
  /** River shows over the lock screen for a call answered on the call screen (2.11.3). */
  private boolean overLockForCall;
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

  /** A headset or headphones a call can use (wired, USB, Bluetooth). */
  private static boolean isHeadset(int type) {
    if (type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET
        || type == android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES
        || type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        || type == android.media.AudioDeviceInfo.TYPE_USB_HEADSET) return true;
    // TYPE_BLE_HEADSET (26) exists from Android 12 on.
    return android.os.Build.VERSION.SDK_INT >= 31 && type == 26;
  }

  /** Bluetooth before wired: a connected Bluetooth headset is the one being worn. */
  private static int headsetRank(int type) {
    return type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == 26 ? 0 : 1;
  }

  private void stopBluetoothSco() {
    bluetoothSco = false;
    android.media.AudioManager am =
        (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (am == null) return;
    try {
      am.setBluetoothScoOn(false);
      am.stopBluetoothSco();
    } catch (RuntimeException ignored) {
      // no Bluetooth here
    }
  }

  /**
   * Calls through the loudspeaker, or else a connected headset (Bluetooth first, then wired),
   * or else the earpiece (2.11.3: headsets were ignored). The screen goes dark at your ear only
   * with the earpiece.
   */
  private void speaker(boolean on) {
    callAudioSet = true;
    android.media.AudioManager am =
        (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    if (am == null) {
      earpiece = !on;
      updateProximity();
      return;
    }
    am.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
    boolean headset = false;
    if (android.os.Build.VERSION.SDK_INT >= 31) {
      android.media.AudioDeviceInfo chosen = null;
      for (android.media.AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
        int type = d.getType();
        if (on) {
          if (type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
            chosen = d;
            break;
          }
        } else if (isHeadset(type) && (chosen == null || headsetRank(type) < headsetRank(chosen.getType()))) {
          chosen = d;
        }
      }
      if (chosen != null) {
        headset = !on;
        am.setCommunicationDevice(chosen);
      } else {
        am.clearCommunicationDevice();
      }
    } else {
      am.setSpeakerphoneOn(on);
      boolean bluetooth = false;
      if (!on) {
        for (android.media.AudioDeviceInfo d : am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)) {
          if (!isHeadset(d.getType())) continue;
          headset = true;
          if (d.getType() == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO) bluetooth = true;
        }
      }
      if (bluetooth && !bluetoothSco) {
        try {
          am.startBluetoothSco();
          am.setBluetoothScoOn(true);
          bluetoothSco = true;
        } catch (RuntimeException ignored) {
          // the headset refused: the earpiece or wired headphones play the call
        }
      } else if (!bluetooth && bluetoothSco) {
        stopBluetoothSco();
      }
    }
    earpiece = !on && !headset;
    updateProximity();
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

  // ---- incoming calls on the phone's own call screen (2.11) ----

  /** The ringing is over: the screen, notification and ringtone go, and the core learns how. */
  private void endIncoming(String how) {
    Integer ask = incomingAsk;
    incomingAsk = null;
    IncomingCall.stop(context);
    if (ask != null) answer(ask, (Object) how);
  }

  /** Answer on the call screen or notification: true when that call still rings. Main thread. */
  public boolean callAnswered(String callId) {
    if (!IncomingCall.ringing(callId) || incomingAsk == null) {
      if (IncomingCall.idle()) IncomingCall.stop(context);
      return false;
    }
    // River opens over the lock screen for it, and stays there while the call starts.
    overLockForCall = true;
    endIncoming("accept");
    return true;
  }

  /** Decline on the call screen or notification: the core declines it, without River's screen. */
  public void callDeclined(String callId) {
    if (IncomingCall.idle()) {
      // left over from an earlier run of River: just take it away
      IncomingCall.stop(context);
      return;
    }
    if (IncomingCall.ringing(callId)) endIncoming(incomingAsk != null ? "decline" : "ended");
  }

  /**
   * A volume button while River's screen is in front and a call rings (2.11.3: the phone rings
   * then too): quiet. True when it was ringing, so the button does nothing else.
   */
  public boolean silenceRinging() {
    return IncomingCall.silence();
  }

  /** Stay connected's watchdog woke the phone: the core checks its connection (2.11). */
  public void wake() {
    run("__riverCore.wake()");
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
          notify(id, a);
          break;
        case "clearNotifications":
          // Signed out or the account was removed (2.11.2).
          dropMessageNotifications();
          answer(id, (Object) null);
          break;
        case "incomingCall":
          {
            // Rings like a phone call until answered, declined, or it stops ringing (2.11).
            String callId = a.optString("callId", "");
            if (callId.isEmpty() || callId.length() > 200) {
              answer(id, (Object) "ended");
              break;
            }
            // Another call already rings: it keeps its screen and its ringtone (the core answered
            // this one busy); only the same call again replaces its own ask.
            if (incomingAsk != null && !IncomingCall.idle() && !IncomingCall.ringing(callId)) {
              answer(id, (Object) "ended");
              break;
            }
            endIncoming("ended");
            incomingAsk = id;
            IncomingCall.start(
                context,
                callId,
                a.optString("name", "Someone"),
                a.optBoolean("video", false),
                foreground,
                () -> {
                  if (gen == generation) endIncoming("timeout");
                  // An older core's ask: IncomingCall stops the ringing itself.
                });
            break;
          }
        case "phoneStatus":
          answer(id, PhoneState.status(context));
          break;
        case "phoneFix":
          {
            Screen s = screen;
            PhoneState.open(s != null ? s.activity() : context, a.optString("fix", ""));
            // What the phone says now; the UI asks again when River is back in front.
            answer(id, PhoneState.status(context));
            break;
          }
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
            CallService.setActive(context, active, a.optString("title", ""));
            callAudio(active);
            Screen s = screen;
            if (active) {
              callAsk = id;
              // A call answered from the lock screen (after leaving a voice channel for it, say):
              // River shows over the lock screen again for it.
              if (overLockForCall && s != null) s.showOverLock(true);
            } else {
              answer(id, (Object) "ended");
              // The call is over: River no longer shows over the lock screen — unless a call is
              // still ringing or starting (River left a voice channel to answer it).
              if (!a.optBoolean("keepOverLock", false)) {
                overLockForCall = false;
                if (s != null) s.showOverLock(false);
              }
            }
            break;
          }
        case "callAudio":
          {
            // A 1:1 call ended or failed before it was ever on: the audio River set for it
            // (call mode, loudspeaker, headset) goes back to normal, unless a call is on now.
            if (callAsk == null && !a.optBoolean("active", false)) callAudio(false);
            answer(id, (Object) null);
            break;
          }
        case "ringing":
          {
            // An incoming call stopped ringing (declined, missed, or the caller gave up).
            Screen s = screen;
            if (!a.optBoolean("on", false)) {
              endIncoming("ended");
              if (!inCall) {
                overLockForCall = false;
                if (s != null) s.showOverLock(false);
              }
            }
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
            // Only what is true (2.12): Android may refuse to start it from the background.
            boolean started = RiverService.setEnabled(context, on);
            answer(id, json("running", on && started));
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
    // Pops up, sounds and vibrates (the phone's notification sound); the lock screen shows only
    // what each notification allows (MessageNotifications).
    NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("New messages and mentions while River is in the background");
    channel.enableVibration(true);
    channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
    nm.createNotificationChannel(channel);
    // Incoming calls ring with the phone's ringtone and call screen, like any calling app.
    IncomingCall.createChannel(context);
  }

  private boolean mayNotify() {
    return Build.VERSION.SDK_INT < 33
        || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
  }

  private void notify(int ask, JSONObject a) {
    Screen s = screen;
    if (!mayNotify() && s != null && foreground) {
      // Android 13+: asked only while River is in front (a prompt cannot show from the background).
      final int gen = generation;
      s.requestNotifications(
          () -> {
            if (gen == generation) show(ask, a);
          });
      return;
    }
    show(ask, a);
  }

  /** Message notifications are numbered from 1; River's own (service, call, ringing, notices) use far higher numbers. */
  private static final int MAX_MESSAGE_NOTIFICATION = 0x10000000;

  /**
   * A number no notification on screen has (2.12). Numbers start at 1 again in each app process:
   * one still showing from before Android ended River (a conversation's unread messages) was
   * replaced by the first new conversation's notification, and so lost.
   */
  private int freshNotificationId() {
    java.util.Set<Integer> showing = new java.util.HashSet<>();
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm != null) {
      try {
        for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications())
          showing.add(sbn.getId());
      } catch (RuntimeException ignored) {
        // cannot tell: numbers of this process are still never reused
      }
    }
    if (nextNotification <= 0 || nextNotification >= MAX_MESSAGE_NOTIFICATION) nextNotification = 1;
    while (showing.contains(nextNotification) && nextNotification < MAX_MESSAGE_NOTIFICATION) nextNotification++;
    return nextNotification++;
  }

  private void show(int ask, JSONObject a) {
    String title = a.optString("title", "River");
    String body = a.optString("body", "");
    boolean reply = a.optBoolean("reply", false);
    boolean call = a.optBoolean("call", false);
    boolean lockScreen = a.optBoolean("lockScreen", false);
    String conversation = a.optString("conversation", "");
    if (conversation.length() > 200) conversation = conversation.substring(0, 200);
    String sender = a.isNull("sender") ? null : a.optString("sender", "");
    String group = a.isNull("group") ? null : a.optString("group", "");
    if (!mayNotify()) {
      answer(ask, (Object) "denied");
      return;
    }
    // One notification per conversation (2.11): a new message replaces it, and the core stops
    // waiting for the one it replaces (tapping either opens the same conversation). Reused before
    // anything is evicted (2.11.2): replacing one adds nothing.
    Integer same = call ? null : messages.idOf(conversation);
    int n;
    if (same != null) {
      n = same;
      notificationTokens.remove(n);
      Integer replaced = notificationAsks.remove(n);
      if (replaced != null) answer(replaced, (Object) "dismissed");
    } else {
      // Only so many notifications wait for an answer; the oldest stops waiting, and is forgotten
      // (its conversation's next message starts a new one; a core restart does not post it again).
      Iterator<Map.Entry<Integer, Integer>> oldest = notificationAsks.entrySet().iterator();
      while (notificationAsks.size() >= MAX_PENDING_NOTIFICATIONS && oldest.hasNext()) {
        Map.Entry<Integer, Integer> e = oldest.next();
        int stale = e.getKey();
        int staleAsk = e.getValue();
        oldest.remove();
        notificationTokens.remove(stale);
        forget(stale);
        answer(staleAsk, (Object) "dismissed");
      }
      n = freshNotificationId();
    }
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
        new NotificationCompat.Builder(context, call ? IncomingCall.CHANNEL : CHANNEL)
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
    if (!call) messages.style(context, b, CHANNEL, n, conversation, title, body, sender, group, lockScreen);
    try {
      NotificationManagerCompat.from(context).notify(n, b.build());
    } catch (SecurityException e) {
      notificationAsks.remove(n);
      notificationTokens.remove(n);
      forget(n);
      answer(ask, (Object) "denied");
      return;
    }
    if (call) return;
    posted.add(n);
    // Settings → System → Light up the screen for new messages (Android, on by default).
    if (a.optBoolean("wake", false)) MessageNotifications.wake(context, CHANNEL);
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
