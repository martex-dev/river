package io.github.martexdev.river.core;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * While you are in a call or a voice channel: a foreground service with an
 * ongoing "In a call" notification, so Android keeps the microphone and the
 * call running when the screen turns off or you switch apps. The notification
 * is Android's ongoing-call style (2.11) with Hang up; it ends with the call.
 * River never records without this notification showing.
 */
public final class CallService extends Service {
  private static final String TAG = "RiverCall";
  private static final String CHANNEL = "call";
  private static final int NOTIFICATION = 0x43414c4c; // "CALL"
  private static final String ACTION_HANG_UP = "io.github.martexdev.river.HANG_UP";
  private static final String EXTRA_TITLE = "river.call.title";

  /**
   * Starts or stops the service to match whether a call is active. `title` names the call (the
   * person, "Voice channel", or "River call" when previews hide names).
   */
  public static void setActive(Context context, boolean active, String title) {
    Intent intent = new Intent(context, CallService.class);
    if (!active) {
      context.stopService(intent);
      return;
    }
    // Android only lets a call keep the microphone in the background with the permission granted.
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) return;
    if (title != null && !title.isEmpty()) intent.putExtra(EXTRA_TITLE, title.substring(0, Math.min(title.length(), 64)));
    try {
      ContextCompat.startForegroundService(context, intent);
    } catch (RuntimeException e) {
      Log.w(TAG, "could not keep the call running in the background: " + e.getClass().getSimpleName());
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
      NotificationChannel channel =
          new NotificationChannel(CHANNEL, "Calls in progress", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Shown while you are in a call or a voice channel");
      channel.setShowBadge(false);
      nm.createNotificationChannel(channel);
    }
    // Android needs the foreground notification at once; the call's name follows in onStartCommand.
    foreground(null);
  }

  private void foreground(String title) {
    Intent hangUp = new Intent(this, CallService.class).setAction(ACTION_HANG_UP);
    PendingIntent hangUpIntent = PendingIntent.getService(this, 1, hangUp, PendingIntent.FLAG_IMMUTABLE);
    Intent open = new Intent(this, RiverService.ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    Person who = new Person.Builder().setName(title == null || title.isEmpty() ? "In a call" : title).build();
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle(title == null || title.isEmpty() ? "In a call" : title)
            .setContentText("River is using the microphone. Tap to return.")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
            // Android's ongoing-call notification (a call chip on Android 12+), with Hang up.
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(who, hangUpIntent));
    Notification notification = b.build();
    int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
    try {
      ServiceCompat.startForeground(this, NOTIFICATION, notification, type);
    } catch (RuntimeException e) {
      Log.w(TAG, "foreground refused: " + e.getClass().getSimpleName());
      stopSelf();
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_HANG_UP.equals(intent.getAction())) {
      CoreHost.get(this).hangUp();
      stopSelf();
    } else if (intent != null && intent.hasExtra(EXTRA_TITLE)) {
      foreground(intent.getStringExtra(EXTRA_TITLE));
    }
    return START_NOT_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
