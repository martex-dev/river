package io.github.martexdev.river.core;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import java.lang.ref.WeakReference;

/**
 * An incoming 1:1 call ringing like a phone call (2.11): a call notification
 * (Answer / Decline, Android's CallStyle) whose full-screen intent opens
 * {@link IncomingCallActivity} over the lock screen, plus {@link Ringer}.
 * Only while River's own screen is not in front — River's interface rings by
 * itself then. Main thread only; {@link CoreHost} owns the outcome.
 */
final class IncomingCall {
  static final String CHANNEL = "incoming_calls";
  /** 2.10's call channel rang with the channel's own sound; the ringtone now comes from Ringer. */
  static final String OLD_CHANNEL = "calls";
  static final String EXTRA_CALL_ID = "river.call.id";
  static final String ACTION_ANSWER = "io.github.martexdev.river.ANSWER_CALL";
  static final String ACTION_DECLINE = "io.github.martexdev.river.DECLINE_CALL";
  private static final int NOTIFICATION = 0x52494e47; // "RING"
  /** As long as the caller's side rings (dm-service's RING_MS). */
  static final long RING_MS = 45_000;

  private static final Handler main = new Handler(Looper.getMainLooper());
  private static String callId;
  private static String name = "Someone";
  private static boolean video;
  private static boolean showing;
  private static Ringer ringer;
  private static Runnable onTimeout;
  private static WeakReference<IncomingCallActivity> screen = new WeakReference<>(null);
  /** Application context of the call ringing now (for the timeout, which always stops it). */
  private static Context app;
  /**
   * Keeps the processor awake exactly while a call rings (2.11.1): with the screen off the phone
   * would otherwise sleep, freezing the 45-second timeout and the connection that brings the
   * caller's hang-up, while the ringtone played on — the call rang until the phone was woken.
   */
  private static android.os.PowerManager.WakeLock awake;
  private static final Runnable timeout =
      () -> {
        Runnable r = onTimeout;
        if (r != null) r.run();
        // Whatever the core does (it may be restarting), the phone stops ringing now.
        if (callId != null && app != null) stop(app);
      };

  private IncomingCall() {}

  static boolean ringing(String id) {
    return callId != null && callId.equals(id);
  }

  static boolean idle() {
    return callId == null;
  }

  static String name() {
    return name;
  }

  static boolean video() {
    return video;
  }

  static void createChannel(Context context) {
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel calls =
        new NotificationChannel(CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
    calls.setDescription("Rings and shows the call screen when someone calls you");
    // Silent channel: Ringer plays the ringtone in a loop and vibrates, following the ringer mode.
    calls.setSound(null, null);
    calls.enableVibration(false);
    calls.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(calls);
    nm.deleteNotificationChannel(OLD_CHANNEL);
  }

  /** Starts ringing for a call; `whenTimedOut` runs if nobody answers in {@link #RING_MS}. */
  static void start(
      Context context, String id, String caller, boolean isVideo, boolean foreground, Runnable whenTimedOut) {
    stop(context);
    app = context.getApplicationContext();
    keepAwake(app);
    callId = id;
    name = caller == null || caller.isEmpty() ? "Someone" : caller.substring(0, Math.min(caller.length(), 64));
    video = isVideo;
    onTimeout = whenTimedOut;
    main.postDelayed(timeout, RING_MS);
    if (!foreground) show(context);
  }

  /** River's screen came to the front (it rings by itself) or went away (the phone rings). */
  static void setForeground(Context context, boolean foreground) {
    if (callId == null) return;
    if (foreground) hide(context);
    else show(context);
  }

  /** Ringing is over, however it ended. */
  static void stop(Context context) {
    main.removeCallbacks(timeout);
    onTimeout = null;
    hide(context);
    callId = null;
    letSleep();
    // Also a notification left from an earlier run of River (its process ended while it rang).
    NotificationManagerCompat.from(context).cancel(NOTIFICATION);
  }

  private static void keepAwake(Context context) {
    letSleep();
    try {
      android.os.PowerManager pm = context.getSystemService(android.os.PowerManager.class);
      if (pm == null) return;
      awake = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "river:ringing");
      awake.setReferenceCounted(false);
      // Released when ringing ends; never held longer than the ringing could last.
      awake.acquire(RING_MS + 15_000);
    } catch (RuntimeException e) {
      awake = null;
    }
  }

  private static void letSleep() {
    android.os.PowerManager.WakeLock w = awake;
    awake = null;
    try {
      if (w != null && w.isHeld()) w.release();
    } catch (RuntimeException ignored) {
      // already released by its timeout
    }
  }

  /** A volume button: quiet, still on screen. */
  static void silence() {
    if (ringer != null) ringer.silence();
  }

  static void attach(IncomingCallActivity activity) {
    screen = new WeakReference<>(activity);
  }

  static void detach(IncomingCallActivity activity) {
    if (screen.get() == activity) screen = new WeakReference<>(null);
  }

  private static void show(Context context) {
    if (showing || callId == null) return;
    createChannel(context);
    NotificationManagerCompat nmc = NotificationManagerCompat.from(context);
    if (!nmc.areNotificationsEnabled()) {
      // Notifications are off for River: no call screen can be shown, but the call still rings
      // (2.11.2) — opening River shows it. Silent and vibrate modes and Do Not Disturb still apply.
      showing = true;
      if (ringer == null) ringer = new Ringer(context);
      ringer.start();
      return;
    }
    Person caller = new Person.Builder().setName(name).setImportant(true).build();
    Intent full =
        new Intent(context, IncomingCallActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .putExtra(EXTRA_CALL_ID, callId);
    PendingIntent fullScreen =
        PendingIntent.getActivity(
            context, 1, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    // Answer opens a screen (Android 12+ lets notification buttons start screens only directly).
    Intent answer =
        new Intent(context, IncomingCallActivity.class)
            .setAction(ACTION_ANSWER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_CALL_ID, callId);
    PendingIntent answerIntent =
        PendingIntent.getActivity(
            context, 2, answer, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    // Decline needs no screen: River's own receiver tells the core.
    Intent decline =
        new Intent(context, CallActionReceiver.class).setAction(ACTION_DECLINE).putExtra(EXTRA_CALL_ID, callId);
    PendingIntent declineIntent =
        PendingIntent.getBroadcast(
            context, 3, decline, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle(name)
            .setContentText(video ? "Incoming video call" : "Incoming voice call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(RING_MS)
            .setContentIntent(fullScreen)
            // Locked or screen off: the call screen covers it. In use: a heads-up that stays.
            .setFullScreenIntent(fullScreen, true)
            .setStyle(
                NotificationCompat.CallStyle.forIncomingCall(caller, declineIntent, answerIntent)
                    .setIsVideo(video));
    try {
      nmc.notify(NOTIFICATION, b.build());
    } catch (RuntimeException e) {
      // notifications turned off meanwhile (SecurityException), or a malformed style
      return;
    }
    showing = true;
    if (channelRings(context)) {
      if (ringer == null) ringer = new Ringer(context);
      ringer.start();
    }
  }

  /** The person may have turned River's call channel down or off in Android's settings. */
  private static boolean channelRings(Context context) {
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return true;
    NotificationChannel c = nm.getNotificationChannel(CHANNEL);
    return c == null || c.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT;
  }

  private static void hide(Context context) {
    showing = false;
    if (ringer != null) ringer.stop();
    NotificationManagerCompat.from(context).cancel(NOTIFICATION);
    IncomingCallActivity s = screen.get();
    screen = new WeakReference<>(null);
    if (s != null && !s.isFinishing()) s.finish();
  }

  /** For the full-screen intent: Android 14+ lets the person turn it off for River. */
  static boolean fullScreenAllowed(Context context) {
    if (Build.VERSION.SDK_INT < 34) return true;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    return nm == null || nm.canUseFullScreenIntent();
  }
}
