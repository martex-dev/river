package io.github.martexdev.river.core;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * River's own quiet notices (2.11.2), on a low-priority channel of their own:
 *
 * <ul>
 *   <li>"River update ready — tap to install": Android's installer confirmation cannot open from
 *       the background, so it waits behind a tap instead of leaving the updater "installing".
 *   <li>"River was stopped — tap to reconnect": Android refused to start Stay connected again from
 *       the watchdog (Android 12+ does that unless River may run in the background).
 * </ul>
 */
final class AppNotices {
  private static final String TAG = "RiverNotices";
  private static final String CHANNEL = "notices";
  private static final int UPDATE = 0x52555044; // "RUPD"
  private static final int STOPPED = 0x52535450; // "RSTP"

  private AppNotices() {}

  private static boolean mayNotify(Context context) {
    if (Build.VERSION.SDK_INT >= 33
        && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return false;
    return NotificationManagerCompat.from(context).areNotificationsEnabled();
  }

  private static void createChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel channel =
        new NotificationChannel(
            CHANNEL, context.getString(io.github.martexdev.river.R.string.notice_channel_name), NotificationManager.IMPORTANCE_LOW);
    channel.setDescription(context.getString(io.github.martexdev.river.R.string.notice_channel_description));
    channel.setShowBadge(false);
    nm.createNotificationChannel(channel);
  }

  private static boolean post(Context context, int id, String title, String text, PendingIntent tap) {
    if (!mayNotify(context)) return false;
    try {
      createChannel(context);
      NotificationCompat.Builder b =
          new NotificationCompat.Builder(context, CHANNEL)
              .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
              .setContentTitle(title)
              .setContentText(text)
              .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
              .setPriority(NotificationCompat.PRIORITY_LOW)
              .setAutoCancel(true)
              .setContentIntent(tap);
      NotificationManagerCompat.from(context).notify(id, b.build());
      return true;
    } catch (RuntimeException e) {
      Log.w(TAG, "notice not shown: " + e.getClass().getSimpleName());
      return false;
    }
  }

  /** Android's "Do you want to update this app?" waits behind this notification. */
  static boolean updateReady(Context context, int session, Intent confirm) {
    PendingIntent tap =
        PendingIntent.getActivity(
            context,
            session,
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    return post(
        context,
        UPDATE,
        context.getString(io.github.martexdev.river.R.string.notice_update_title),
        context.getString(io.github.martexdev.river.R.string.notice_update_text),
        tap);
  }

  static void cancelUpdate(Context context) {
    NotificationManagerCompat.from(context).cancel(UPDATE);
  }

  /** Stay connected could not start again: opening River starts it. */
  static void stopped(Context context) {
    Intent open = new Intent(context, RiverService.ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    PendingIntent tap =
        PendingIntent.getActivity(
            context, STOPPED, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    post(
        context,
        STOPPED,
        context.getString(io.github.martexdev.river.R.string.notice_stopped_title),
        context.getString(io.github.martexdev.river.R.string.notice_stopped_text),
        tap);
  }

  static void cancelStopped(Context context) {
    NotificationManagerCompat.from(context).cancel(STOPPED);
  }
}
