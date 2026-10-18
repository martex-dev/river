package io.github.martexdev.river.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;

/**
 * "Reply" and (2.17) "Mark as read" on a River notification, and a River
 * notification swiped away (not exported: only River's own notifications reach it).
 */
public final class NotificationReplyReceiver extends BroadcastReceiver {
  static final String KEY_TEXT = "river.reply";
  static final String ACTION_DISMISSED = "io.github.martexdev.river.NOTIFICATION_DISMISSED";
  static final String ACTION_READ = "io.github.martexdev.river.NOTIFICATION_READ";

  @Override
  public void onReceive(Context context, Intent intent) {
    int notification = intent.getIntExtra(CoreHost.EXTRA_NOTIFICATION, 0);
    String token = intent.getStringExtra(CoreHost.EXTRA_NOTIFICATION_TOKEN);
    if (ACTION_DISMISSED.equals(intent.getAction())) {
      CoreHost.get(context).notificationDismissed(notification, token);
      return;
    }
    if (ACTION_READ.equals(intent.getAction())) {
      CoreHost.get(context).notificationMarkedRead(notification, token);
      return;
    }
    Bundle results = RemoteInput.getResultsFromIntent(intent);
    CharSequence text = results == null ? null : results.getCharSequence(KEY_TEXT);
    if (text == null || text.toString().trim().isEmpty()) return;
    CoreHost.get(context).notificationReplied(notification, token, text.toString().trim());
  }
}
