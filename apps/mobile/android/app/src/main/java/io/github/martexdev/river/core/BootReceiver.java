package io.github.martexdev.river.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Stay connected after the phone restarts or River is updated (2.11): starts
 * the visible "River is connected" service again, and its watchdog. Nothing
 * runs when Stay connected is off. Only Android's own broadcasts reach it.
 */
public final class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    String action = intent == null ? null : intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))
      return;
    if (!RiverService.enabled(context)) return;
    RiverService.setEnabled(context, true);
    Watchdog.schedule(context);
  }
}
