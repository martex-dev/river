package io.github.martexdev.river;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.IntentCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Share → River" from other apps: text, links, photos and files. The content
 * goes to River's interface, which asks where to send it; nothing is sent until
 * you pick a conversation and press Send.
 */
final class ShareReceiver {
  private static final String TAG = "RiverShare";
  /** River's attachment limit per message, in total. */
  private static final long MAX_BYTES = 25L * 1024 * 1024;
  private static final int MAX_FILES = 10;

  private ShareReceiver() {}

  static boolean isShare(Intent intent) {
    String action = intent == null ? null : intent.getAction();
    return Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action);
  }

  /** The event for the UI (channel river:app:share), or null if there is nothing to share. */
  static String read(Context context, Intent intent) {
    try {
      // A CharSequence, not only a String (2.12): apps that share styled text sent nothing.
      CharSequence sharedText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
      CharSequence sharedSubject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
      String text = sharedText == null ? "" : sharedText.toString();
      String subject = sharedSubject == null ? null : sharedSubject.toString();
      if (subject != null && !subject.isEmpty() && !text.contains(subject)) {
        text = text.isEmpty() ? subject : subject + "\n" + text;
      }
      JSONArray files = new JSONArray();
      long total = 0;
      for (Uri uri : streams(intent)) {
        if (files.length() >= MAX_FILES) break;
        JSONObject file = readFile(context.getContentResolver(), context.getPackageName(), uri, MAX_BYTES - total);
        if (file == null) continue;
        total += file.getLong("size");
        file.remove("size");
        files.put(file);
      }
      if (text.isEmpty() && files.length() == 0) return null;
      JSONObject content = new JSONObject().put("text", text.length() > 4000 ? text.substring(0, 4000) : text);
      content.put("files", files);
      return new JSONObject()
          .put("channel", "river:app:share")
          .put("args", new JSONArray().put(content))
          .toString();
    } catch (Exception e) {
      Log.w(TAG, "could not read what was shared: " + e.getClass().getSimpleName());
      return null;
    }
  }

  /**
   * IntentCompat (2.12): Android 13's own typed getParcelableExtra can throw on some intents, and
   * the older one took anything another app put under EXTRA_STREAM as a Uri.
   */
  private static List<Uri> streams(Intent intent) {
    List<Uri> out = new ArrayList<>();
    if (Intent.ACTION_SEND.equals(intent.getAction())) {
      Uri one = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
      if (one != null) out.add(one);
    } else {
      ArrayList<Uri> many = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
      if (many != null) for (Uri u : many) if (u != null) out.add(u);
    }
    return out;
  }

  private static JSONObject readFile(ContentResolver resolver, String self, Uri uri, long budget) {
    // Only content the sharing app granted us; never River's own files.
    if (!"content".equals(uri.getScheme())) return null;
    String authority = uri.getAuthority();
    // "content://0@authority" (a user-ID prefix) still reaches the provider named after the "@".
    if (authority == null || authority.contains("@")) return null;
    if (authority.equals(self) || authority.startsWith(self + ".")) {
      return null;
    }
    String name = "shared file";
    try (Cursor c = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
    } catch (Exception ignored) {
      // keep the default name
    }
    String type = resolver.getType(uri);
    try (InputStream in = resolver.openInputStream(uri)) {
      if (in == null) return null;
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) {
        bytes.write(buf, 0, n);
        if (bytes.size() > budget) return null;
      }
      return new JSONObject()
          .put("name", name.length() > 200 ? name.substring(0, 200) : name)
          .put("type", type == null ? "application/octet-stream" : type)
          .put("data", new JSONObject().put("$u8", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)))
          .put("size", bytes.size());
    } catch (Exception e) {
      Log.w(TAG, "could not read a shared file: " + e.getClass().getSimpleName());
      return null;
    }
  }
}
