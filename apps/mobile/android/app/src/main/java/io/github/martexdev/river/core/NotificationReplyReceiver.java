package io.github.martexdev.river.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;

/** "Reply" on a River notification (not exported: only River's own notifications reach it). */
public final class NotificationReplyReceiver extends BroadcastReceiver {
  static final String KEY_TEXT = "river.reply";

  @Override
  public void onReceive(Context context, Intent intent) {
    Bundle results = RemoteInput.getResultsFromIntent(intent);
    CharSequence text = results == null ? null : results.getCharSequence(KEY_TEXT);
    if (text == null || text.toString().trim().isEmpty()) return;
    int notification = intent.getIntExtra(CoreHost.EXTRA_NOTIFICATION, 0);
    String token = intent.getStringExtra(CoreHost.EXTRA_NOTIFICATION_TOKEN);
    CoreHost.get(context).notificationReplied(notification, token, text.toString().trim());
  }
}
