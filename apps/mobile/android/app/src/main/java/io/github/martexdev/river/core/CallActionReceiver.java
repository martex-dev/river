package io.github.martexdev.river.core;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Decline on an incoming call's notification (2.11): the core declines the call
 * (end-to-end encrypted, like any call message) without opening River's screen.
 * Not exported: only River's own notification can send it.
 */
public final class CallActionReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !IncomingCall.ACTION_DECLINE.equals(intent.getAction())) return;
    String callId = intent.getStringExtra(IncomingCall.EXTRA_CALL_ID);
    if (callId != null) CoreHost.get(context).callDeclined(callId);
  }
}
