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
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * While you are in a call or a voice channel: a foreground service with an
 * ongoing "In a call" notification, so Android keeps the microphone and the
 * call running when the screen turns off or you switch apps. The notification
 * has Hang up; it ends with the call. River never records without this
 * notification showing.
 */
public final class CallService extends Service {
  private static final String TAG = "RiverCall";
  private static final String CHANNEL = "call";
  private static final int NOTIFICATION = 0x43414c4c; // "CALL"
  private static final String ACTION_HANG_UP = "io.github.martexdev.river.HANG_UP";

  /** Starts or stops the service to match whether a call is active. */
  public static void setActive(Context context, boolean active) {
    Intent intent = new Intent(context, CallService.class);
    if (!active) {
      context.stopService(intent);
      return;
    }
    // Android only lets a call keep the microphone in the background with the permission granted.
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) return;
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
    Intent hangUp = new Intent(this, CallService.class).setAction(ACTION_HANG_UP);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle("In a call")
            .setContentText("River is using the microphone. Tap to return.")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(
                0,
                "Hang up",
                PendingIntent.getService(this, 1, hangUp, PendingIntent.FLAG_IMMUTABLE));
    if (RiverService.activityClass != null) {
      Intent open = new Intent(this, RiverService.activityClass).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      b.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
    }
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
    }
    return START_NOT_STICKY;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
