package io.github.martexdev.river.core;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Settings → System → Stay connected (phones): keeps River's client core and
 * its connection running while River is closed, so new messages and calls
 * notify like any messaging app. Android shows a quiet, permanent "River is
 * connected" notification while it runs; River never runs hidden.
 *
 * River does not use Google's or Apple's push services (they would need an
 * account with them and would see when you get messages); this is the
 * alternative, at some cost in battery.
 */
public final class RiverService extends Service {
  private static final String CHANNEL = "connection";
  private static final int NOTIFICATION = 0x52495645; // "RIVE"
  /** Whether the service runs in this process right now (Settings → System shows it). */
  private static volatile boolean running;
  /** Android refused this start of the service as a foreground service: it ends at once. */
  private boolean refused;

  /**
   * River's screen, which its notifications open. A constant: Android restarts this service
   * (START_STICKY) in a new process where no screen has run yet.
   */
  public static final Class<?> ACTIVITY = io.github.martexdev.river.MainActivity.class;

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences("river-background", Context.MODE_PRIVATE);
  }

  public static boolean enabled(Context context) {
    return prefs(context).getBoolean("enabled", false);
  }

  public static boolean running() {
    return running;
  }

  /**
   * Turns staying connected on or off, and starts or stops the service to match. False when Android
   * refused to start it (see below).
   */
  public static boolean setEnabled(Context context, boolean on) {
    prefs(context).edit().putBoolean("enabled", on).apply();
    Intent intent = new Intent(context, RiverService.class);
    if (!on) {
      Watchdog.cancel(context);
      AppNotices.cancelStopped(context);
      context.stopService(intent);
      return true;
    }
    try {
      ContextCompat.startForegroundService(context, intent);
      return true;
    } catch (RuntimeException e) {
      // Android 12+ refuses to start it from the background (battery optimization on): it starts
      // the next time River opens, and Settings → System says it is not running.
      Log.w("RiverService", "could not start: " + e.getClass().getSimpleName());
      return false;
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
      NotificationChannel channel =
          new NotificationChannel(CHANNEL, "Staying connected", NotificationManager.IMPORTANCE_MIN);
      channel.setDescription("Shown while River stays connected in the background");
      channel.setShowBadge(false);
      nm.createNotificationChannel(channel);
    }
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle("River is connected")
            .setContentText("New messages arrive while River is closed. Turn off in Settings → System.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN);
    Intent open = new Intent(this, ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    b.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
    Notification notification = b.build();
    int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0;
    try {
      ServiceCompat.startForeground(this, NOTIFICATION, notification, type);
    } catch (RuntimeException e) {
      // 2.12: Android restarted the service by itself (START_STICKY) while River was in the
      // background, and Android 12+ refused the foreground start (ForegroundServiceStartNotAllowed)
      // — that crashed River. Now it stops quietly and says so; opening River starts it again.
      Log.w("RiverService", "foreground refused: " + e.getClass().getSimpleName());
      refused = true;
      AppNotices.stopped(this);
      stopSelf();
      return;
    }
    running = true;
    // Connected again: "River was stopped" (Watchdog) is no longer true.
    AppNotices.cancelStopped(this);
    CoreHost.get(this).start();
    // Wakes the phone now and then to check the connection (2.11).
    Watchdog.schedule(this);
  }

  @Override
  public void onDestroy() {
    boolean was = running;
    running = false;
    // 2.12: the service ended (Stay connected turned off, or Android stopped it) while River's
    // screen is closed: the core goes too, instead of staying connected without the visible
    // "River is connected" notification. With the screen open the core stays with the screen.
    if (was) {
      CoreHost core = CoreHost.get(this);
      if (!core.hasScreen()) core.stopAfterCall();
    }
    super.onDestroy();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    // Never a core without the notification (the foreground start was refused in onCreate).
    if (refused) return START_NOT_STICKY;
    CoreHost.get(this).start();
    return START_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
