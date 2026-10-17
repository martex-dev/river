package io.github.martexdev.river.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android's installer reports on a River update here (not exported: only the PendingIntent River
 * gave to PackageInstaller reaches it).
 */
public final class UpdateInstallReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !UpdateOps.ACTION_STATUS.equals(intent.getAction())) return;
    UpdateOps.get(context).onStatus(intent);
  }
}
