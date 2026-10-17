package io.github.martexdev.river.core;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

/**
 * Settings → System → Calls and notifications (2.11): what keeps River
 * reachable while it is closed, read from Android each time it is asked, and
 * Android's own screens to change it. River changes none of these by itself.
 */
final class PhoneState {
  private PhoneState() {}

  static JSONObject status(Context context) {
    JSONObject o = new JSONObject();
    try {
      o.put("background", RiverService.enabled(context) && RiverService.running());
      o.put("batteryExempt", batteryExempt(context));
      o.put("fullScreenCalls", IncomingCall.fullScreenAllowed(context));
      o.put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled());
    } catch (Exception ignored) {
      // keys are constants
    }
    return o;
  }

  static boolean batteryExempt(Context context) {
    PowerManager pm = context.getSystemService(PowerManager.class);
    return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
  }

  /** Opens Android's screen for `fix`: "battery", "fullScreen" or "notifications". */
  static void open(Context from, String fix) {
    String pkg = from.getPackageName();
    Uri app = Uri.parse("package:" + pkg);
    Intent intent;
    Intent fallback;
    switch (fix) {
      case "battery":
        if (batteryExempt(from)) return;
        // Android's own question: "Let River always run in the background?"
        intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, app);
        fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        break;
      case "fullScreen":
        if (Build.VERSION.SDK_INT < 34) return;
        intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, app);
        fallback = notificationSettings(pkg);
        break;
      case "notifications":
        intent = notificationSettings(pkg);
        fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, app);
        break;
      default:
        return;
    }
    if (!(from instanceof Activity)) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }
    try {
      from.startActivity(intent);
    } catch (ActivityNotFoundException | SecurityException e) {
      try {
        from.startActivity(fallback);
      } catch (ActivityNotFoundException | SecurityException ignored) {
        // this phone has neither screen
      }
    }
  }

  private static Intent notificationSettings(String pkg) {
    return new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
  }
}
