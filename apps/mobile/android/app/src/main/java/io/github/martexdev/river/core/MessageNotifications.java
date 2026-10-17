package io.github.martexdev.river.core;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * How River's message notifications look and behave (2.11): one notification
 * per conversation (new messages join it, Android's MessagingStyle with the
 * sender's name when previews show names), the lock screen showing the sender
 * and text only with full previews (otherwise "New message"), and a dark
 * screen lighting up for a few seconds when Settings → System says so.
 * Main thread only.
 */
final class MessageNotifications {
  private static final int MAX_LINES = 6;
  private static final long WAKE_MS = 4_000;

  private static final class Line {
    final String sender;
    final String text;
    final long at;

    Line(String sender, String text, long at) {
      this.sender = sender;
      this.text = text;
      this.at = at;
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
    ids.values().removeIf(n -> n.intValue() == notification);
  }

  /** River's core restarted: notifications stay, the messages they gathered start over. */
  void restarted() {
    lines.clear();
  }

  void clear() {
    ids.clear();
    lines.clear();
  }

  /**
   * Fills in `b` (already titled) for a message in `conversation`. `sender` is null when previews
   * hide names; `group` is a channel's or group's name; `lockScreen` is true only with full
   * previews.
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
      boolean lockScreen) {
    if (!conversation.isEmpty()) ids.put(conversation, notification);
    List<Line> list = lines.computeIfAbsent(notification, k -> new ArrayList<>());
    list.add(new Line(sender, body, System.currentTimeMillis()));
    while (list.size() > MAX_LINES) list.remove(0);
    b.setCategory(NotificationCompat.CATEGORY_MESSAGE).setNumber(list.size());
    if (sender != null && !sender.isEmpty()) {
      NotificationCompat.MessagingStyle style =
          new NotificationCompat.MessagingStyle(new Person.Builder().setName("You").build());
      if (group != null && !group.isEmpty()) style.setConversationTitle(group).setGroupConversation(true);
      for (Line l : list) {
        String who = l.sender == null || l.sender.isEmpty() ? title : l.sender;
        style.addMessage(new NotificationCompat.MessagingStyle.Message(l.text, l.at, new Person.Builder().setName(who).build()));
      }
      b.setStyle(style);
    } else if (list.size() > 1) {
      // Previews hide names: only how many, never who or what.
      b.setContentText(list.size() + " new messages");
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
