package io.github.martexdev.river.core;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * How River's message notifications look and behave (2.11): one notification
 * per conversation (new messages join it, Android's MessagingStyle with the
 * sender's name when previews show names), the lock screen showing the sender
 * and text only with full previews (otherwise "New message"), and a dark
 * screen lighting up for a few seconds when Settings → System says so.
 *
 * 2.17: the conversations' notifications are one group under a summary ("5 new
 * messages in 2 chats"), each says how many messages it stands for (the
 * launcher's badge adds them up), and a chat may have its own sound.
 *
 * Sounds: an Android notification channel's sound is fixed once the channel
 * exists (only the person can change it, in Android's settings). So River does
 * not make a channel per chat; it makes one channel per sound it offers
 * ("Messages · Chime", …), created the first time a chat uses that sound, and
 * posts each chat's notification to the channel of its sound. "Default" uses
 * the usual Messages channel (the phone's notification sound), "No sound" posts
 * silently to it.
 * Main thread only.
 */
final class MessageNotifications {
  private static final int MAX_LINES = 6;
  private static final long WAKE_MS = 4_000;
  /** The group of all message notifications, under one summary. */
  static final String GROUP = "io.github.martexdev.river.MESSAGES";
  /** The group's summary notification (far above the message notifications' numbers). */
  private static final int NOTIFICATION = 0x524d5347; // "RMSG"

  /** A conversation's notification, as the group summary lists it. */
  private static final class Chat {
    /** The conversation's name, or null when previews hide names. */
    final String label;
    final int count;
    final boolean lockScreen;

    Chat(String label, int count, boolean lockScreen) {
      this.label = label;
      this.count = count;
      this.lockScreen = lockScreen;
    }
  }

  /** Notification → what the summary says about it, in posting order. */
  private final Map<Integer, Chat> chats = new LinkedHashMap<>();

  private static final class Line {
    final String sender;
    final String text;
    final long at;
    /** Shown with full previews (its text is the message's own). */
    final boolean full;

    Line(String sender, String text, long at, boolean full) {
      this.sender = sender;
      this.text = text;
      this.at = at;
      this.full = full;
    }
  }

  /** Conversation → its notification, and that notification's recent messages. */
  private final Map<String, Integer> ids = new HashMap<>();
  private final Map<Integer, List<Line>> lines = new HashMap<>();

  /** The notification this conversation already has, or null. */
  Integer idOf(String conversation) {
    return conversation.isEmpty() ? null : ids.get(conversation);
  }

  /** The notification was tapped, answered or swiped away: its conversation starts over. */
  void forget(int notification) {
    lines.remove(notification);
    chats.remove(notification);
    ids.values().removeIf(n -> n.intValue() == notification);
  }

  /** River's core restarted: notifications stay, the messages they gathered start over. */
  void restarted() {
    lines.clear();
    chats.clear();
  }

  void clear() {
    ids.clear();
    lines.clear();
    chats.clear();
  }

  /**
   * Fills in `b` (already titled) for a message in `conversation`. `sender` is null when previews
   * hide names; `group` is a channel's or group's name; `lockScreen` is true only with full
   * previews. `count` is how many messages the conversation's notification stands for (2.17).
   */
  void style(
      Context context,
      NotificationCompat.Builder b,
      String channel,
      int notification,
      String conversation,
      String title,
      String body,
      String sender,
      String group,
      boolean lockScreen,
      int count) {
    if (!conversation.isEmpty()) ids.put(conversation, notification);
    List<Line> list = lines.computeIfAbsent(notification, k -> new ArrayList<>());
    // Previews turned down meanwhile (2.12): earlier messages' text is not shown
    // again in the notification the new one joins — only what the setting shows now.
    if (!lockScreen) list.removeIf(l -> l.full);
    list.add(new Line(sender, body, System.currentTimeMillis(), lockScreen));
    while (list.size() > MAX_LINES) list.remove(0);
    int number = Math.max(count, list.size());
    // The launcher's badge adds up the numbers of River's notifications (2.17).
    b.setCategory(NotificationCompat.CATEGORY_MESSAGE).setNumber(number).setGroup(GROUP);
    boolean named = sender != null && !sender.isEmpty();
    chats.remove(notification);
    chats.put(
        notification,
        new Chat(named ? (group != null && !group.isEmpty() ? group : title) : null, number, lockScreen));
    if (sender != null && !sender.isEmpty()) {
      NotificationCompat.MessagingStyle style =
          new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build());
      if (group != null && !group.isEmpty()) style.setConversationTitle(group).setGroupConversation(true);
      for (Line l : list) {
        String who = l.sender == null || l.sender.isEmpty() ? title : l.sender;
        style.addMessage(new NotificationCompat.MessagingStyle.Message(l.text, l.at, new Person.Builder().setName(who).build()));
      }
      b.setStyle(style);
    } else if (number > 1) {
      // Previews hide names: only how many, never who or what.
      b.setContentText(number + " new messages");
    }
    if (lockScreen) {
      b.setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    } else {
      b.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
          .setPublicVersion(
              new NotificationCompat.Builder(context, channel)
                  .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
                  .setContentTitle("River")
                  .setContentText("New message")
                  .build());
    }
  }

  /**
   * Posts, updates or removes the group's summary (2.17): with two or more conversations waiting,
   * Android shows them as one group headed "5 new messages in 2 chats". It lists the chats' names
   * only when previews show names, and the lock screen sees only "New messages" unless every
   * chat's previews are full. The summary itself never sounds (the chats' notifications do).
   */
  void summarize(Context context, String channel, Class<?> activity) {
    NotificationManagerCompat nm = NotificationManagerCompat.from(context);
    if (chats.size() < 2) {
      nm.cancel(NOTIFICATION);
      return;
    }
    int total = 0;
    boolean lockScreen = true;
    NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle();
    for (Chat c : chats.values()) {
      total += c.count;
      lockScreen &= c.lockScreen;
      if (c.label != null) inbox.addLine(c.label + " · " + c.count + (c.count == 1 ? " new message" : " new messages"));
    }
    String text = total + " new messages in " + chats.size() + " chats";
    inbox.setSummaryText(text);
    Intent open =
        new Intent(context, activity)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    PendingIntent tap =
        PendingIntent.getActivity(
            context, NOTIFICATION, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, channel)
            .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
            .setContentTitle("River")
            .setContentText(text)
            .setStyle(inbox)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(tap);
    if (lockScreen) {
      b.setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
    } else {
      b.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
          .setPublicVersion(
              new NotificationCompat.Builder(context, channel)
                  .setSmallIcon(io.github.martexdev.river.R.drawable.ic_stat_river)
                  .setContentTitle("River")
                  .setContentText("New messages")
                  .build());
    }
    try {
      nm.notify(NOTIFICATION, b.build());
    } catch (SecurityException ignored) {
      // notifications turned off meanwhile
    }
  }

  /** River's own notification sounds (apps/desktop/src/shared/notify-sounds.ts), as res/raw files. */
  private static int toneResource(String sound) {
    switch (sound) {
      case "chime":
        return io.github.martexdev.river.R.raw.river_tone_chime;
      case "bell":
        return io.github.martexdev.river.R.raw.river_tone_bell;
      case "pop":
        return io.github.martexdev.river.R.raw.river_tone_pop;
      case "drop":
        return io.github.martexdev.river.R.raw.river_tone_drop;
      case "harp":
        return io.github.martexdev.river.R.raw.river_tone_harp;
      default:
        return 0;
    }
  }

  /**
   * The channel a chat with this sound posts to: one channel per River tone, made the first time
   * it is used (its sound cannot change afterwards, so it is never reused for another sound), or
   * the usual Messages channel for "default", "none" and anything unknown.
   */
  static String channelFor(Context context, String sound, String fallback) {
    int res = sound == null ? 0 : toneResource(sound);
    if (res == 0) return fallback;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return fallback;
    String id = "messages_tone_" + sound;
    if (nm.getNotificationChannel(id) == null) {
      String name = Character.toUpperCase(sound.charAt(0)) + sound.substring(1);
      NotificationChannel c =
          new NotificationChannel(id, "Messages · " + name, NotificationManager.IMPORTANCE_HIGH);
      c.setDescription("Chats and channels you gave the " + name + " sound");
      c.enableVibration(true);
      c.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
      c.setSound(
          Uri.parse("android.resource://" + context.getPackageName() + "/" + res),
          new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build());
      nm.createNotificationChannel(c);
    }
    return id;
  }

  /**
   * Lights up a dark screen for a few seconds for a new message — not during Do Not Disturb,
   * and not when the person turned River's message notifications down to silent.
   */
  static void wake(Context context, String channel) {
    PowerManager pm = context.getSystemService(PowerManager.class);
    if (pm == null || pm.isInteractive()) return;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    int filter = nm.getCurrentInterruptionFilter();
    if (filter != NotificationManager.INTERRUPTION_FILTER_ALL
        && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return;
    NotificationChannel c = nm.getNotificationChannel(channel);
    if (c != null && c.getImportance() < NotificationManager.IMPORTANCE_DEFAULT) return;
    try {
      @SuppressWarnings("deprecation")
      PowerManager.WakeLock light =
          pm.newWakeLock(
              PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                  | PowerManager.ACQUIRE_CAUSES_WAKEUP
                  | PowerManager.ON_AFTER_RELEASE,
              "river:new-message");
      light.setReferenceCounted(false);
      light.acquire(WAKE_MS);
    } catch (RuntimeException ignored) {
      // not allowed on this phone: the notification still shows
    }
  }
}
