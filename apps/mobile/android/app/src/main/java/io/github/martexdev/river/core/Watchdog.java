package io.github.martexdev.river.core;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

/**
 * Stay connected's watchdog (2.11). With the screen off Android lets the
 * processor sleep, and River's heartbeat timers sleep with it, so a connection
 * the network dropped may look open for a long time. About every 15 minutes
 * (an inexact alarm that also fires in Doze; no exact-alarm permission needed)
 * this wakes the phone for up to 30 seconds, makes sure the service and the
 * core run, and asks the core to check its connection or connect again.
 * Not exported: only River's own alarm sends it.
 */
public final class Watchdog extends BroadcastReceiver {
  private static final String TAG = "RiverWatchdog";
  private static final String ACTION = "io.github.martexdev.river.WATCHDOG";
  private static final long INTERVAL_MS = 15 * 60 * 1000L;
  private static final long AWAKE_MS = 30_000;

  private static PendingIntent intent(Context context) {
    Intent i = new Intent(context, Watchdog.class).setAction(ACTION);
    return PendingIntent.getBroadcast(
        context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  /** The next check, in about 15 minutes (replaces one already set). */
  public static void schedule(Context context) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
    if (am == null) return;
    try {
      am.setAndAllowWhileIdle(
          AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + INTERVAL_MS, intent(context));
    } catch (RuntimeException e) {
      Log.w(TAG, "could not set the watchdog: " + e.getClass().getSimpleName());
    }
  }

  public static void cancel(Context context) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
    if (am != null) am.cancel(intent(context));
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !ACTION.equals(intent.getAction())) return;
    if (!RiverService.enabled(context)) {
      cancel(context);
      return;
    }
    PowerManager pm = context.getSystemService(PowerManager.class);
    if (pm != null) {
      PowerManager.WakeLock awake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "river:watchdog");
      awake.setReferenceCounted(false);
      // Released by the timeout: long enough to reconnect and take in what waited on the server.
      awake.acquire(AWAKE_MS);
    }
    schedule(context);
    // Android ended the service (or River's process) meanwhile: start it again; its new core
    // connects by itself. River's core never runs without the service's visible notification.
    if (!RiverService.running()) {
      // From an inexact alarm Android 12+ refuses unless River may run in the background
      // (2.11.2): say so instead of staying silently disconnected. Opening River reconnects.
      if (!RiverService.setEnabled(context, true)) AppNotices.stopped(context);
      return;
    }
    CoreHost core = CoreHost.get(context);
    core.start();
    core.wake();
  }
}
