package io.github.martexdev.river.core;

import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * The phone's ringtone and a repeating vibration while a call rings (2.11), as
 * the phone's own calls ring: nothing in silent mode, only vibration in vibrate
 * mode, and nothing while Do Not Disturb holds calls back. Stopped on any
 * outcome by {@link IncomingCall}.
 */
final class Ringer {
  private static final String TAG = "RiverRinger";
  /** Ring for a second, pause for a second, again. */
  private static final long[] VIBRATION = {0, 1000, 1000};

  private final Context context;
  private MediaPlayer player;
  private Ringtone fallback;
  private Vibrator vibrator;
  private AudioFocusRequest focus;
  /** Ringing or vibrating now (the ringer mode let it). */
  private boolean on;

  Ringer(Context context) {
    this.context = context.getApplicationContext();
  }

  private static AudioAttributes attributes() {
    return new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
  }

  /** Whether Do Not Disturb lets a call from anyone through right now. */
  static boolean callsAllowed(Context context) {
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return true;
    int filter = nm.getCurrentInterruptionFilter();
    if (filter == NotificationManager.INTERRUPTION_FILTER_ALL
        || filter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return true;
    if (filter != NotificationManager.INTERRUPTION_FILTER_PRIORITY) return false;
    try {
      // Priority only: calls ring only when the person allowed calls from anyone (River's callers
      // are not the phone's contacts).
      NotificationManager.Policy policy = nm.getNotificationPolicy();
      return (policy.priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_CALLS) != 0
          && policy.priorityCallSenders == NotificationManager.Policy.PRIORITY_SENDERS_ANY;
    } catch (RuntimeException e) {
      return false;
    }
  }

  void start() {
    stop();
    if (!callsAllowed(context)) return;
    AudioManager am = context.getSystemService(AudioManager.class);
    int mode = am == null ? AudioManager.RINGER_MODE_NORMAL : am.getRingerMode();
    if (mode == AudioManager.RINGER_MODE_SILENT) return;
    on = true;
    vibrate();
    if (mode == AudioManager.RINGER_MODE_NORMAL) play(am);
  }

  private void vibrate() {
    try {
      vibrator = context.getSystemService(Vibrator.class);
      if (vibrator == null || !vibrator.hasVibrator()) return;
      vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, 0), attributes());
    } catch (RuntimeException e) {
      Log.w(TAG, "could not vibrate: " + e.getClass().getSimpleName());
    }
  }

  private void play(AudioManager am) {
    if (am != null) {
      focus =
          new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
              .setAudioAttributes(attributes())
              .build();
      am.requestAudioFocus(focus);
    }
    Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    MediaPlayer p = null;
    try {
      p = new MediaPlayer();
      p.setAudioAttributes(attributes());
      p.setDataSource(context, uri);
      p.setLooping(true);
      p.prepare();
      p.start();
      player = p;
    } catch (Exception e) {
      // 2.12: the player that failed is released (it held a native player and a file per call).
      if (p != null) p.release();
      // No playable ringtone file (or none chosen): the system's Ringtone player, looped where it can.
      try {
        Ringtone r = RingtoneManager.getRingtone(context, uri);
        if (r == null) return;
        r.setAudioAttributes(attributes());
        if (Build.VERSION.SDK_INT >= 28) r.setLooping(true);
        r.play();
        fallback = r;
      } catch (RuntimeException ignored) {
        Log.w(TAG, "no ringtone to play");
      }
    }
  }

  /** Whether it rings or vibrates right now. */
  boolean ringing() {
    return on;
  }

  /** Quiet now (a volume or the power button), still ringing on screen. */
  void silence() {
    on = false;
    if (player != null) {
      try {
        player.stop();
      } catch (RuntimeException ignored) {
        // already stopped
      }
      player.release();
      player = null;
    }
    if (fallback != null) {
      fallback.stop();
      fallback = null;
    }
    if (vibrator != null) {
      vibrator.cancel();
      vibrator = null;
    }
    AudioManager am = context.getSystemService(AudioManager.class);
    if (am != null && focus != null) am.abandonAudioFocusRequest(focus);
    focus = null;
  }

  void stop() {
    silence();
  }
}
