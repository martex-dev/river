package io.github.martexdev.river.core;

import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.IntentCompat;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * River for Android's updater, the app shell's half (apps/mobile/core/updater.ts decides).
 *
 * <ul>
 *   <li>{@code update.device}: the phone's processor types and River's version code.
 *   <li>{@code update.download}: downloads a River release file (GitHub Releases only, HTTPS only)
 *       into River's own update folder, with a size cap, and answers its SHA-256 (MessageDigest).
 *       The core checks it against the signed release manifest.
 *   <li>{@code update.progress}: bytes received so far.
 *   <li>{@code update.signers}: the SHA-256 of the installed app's signing certificates and of the
 *       downloaded APK's, so the core can tell before installing whether Android would take it.
 *   <li>{@code update.install}: hands a downloaded APK to Android's PackageInstaller, which always
 *       shows its own confirmation. Without "install unknown apps" permission it opens that setting
 *       and answers "permission-needed".
 * </ul>
 *
 * Answers are complete payloads for CoreHost ({"ok":true,"value":…} or {"ok":false,"error":…}).
 */
public final class UpdateOps {
  private static final String TAG = "RiverUpdate";
  static final String ACTION_STATUS = "io.github.martexdev.river.UPDATE_STATUS";
  /** Release files and the release list of River's own repository, nothing else. */
  private static final String[] ALLOWED =
      new String[] {
        "https://github.com/martex-dev/river/releases/",
        "https://api.github.com/repos/martex-dev/river/releases"
      };

  private static UpdateOps instance;

  public static synchronized UpdateOps get(Context context) {
    if (instance == null) instance = new UpdateOps(context.getApplicationContext());
    return instance;
  }

  private final Context context;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final Map<String, long[]> progress = new ConcurrentHashMap<>();
  /** PackageInstaller session → the core's open "update.install" ask. */
  private final Map<Integer, Consumer<String>> installs = new ConcurrentHashMap<>();

  private UpdateOps(Context context) {
    this.context = context;
  }

  /** River's update folder (the core's userData/updates). */
  private File folder() throws IOException {
    return new File(context.getFilesDir(), "updates").getCanonicalFile();
  }

  /** Only files directly inside River's own update folder. */
  private File confine(String path) throws IOException {
    File dir = folder();
    File f = new File(path).getCanonicalFile();
    File parent = f.getParentFile();
    if (parent == null || !parent.getPath().equals(dir.getPath())) {
      throw new IOException("not in River's update folder");
    }
    return f;
  }

  /** Called on the main thread; `reply` may be called on any thread. */
  public void ask(String kind, JSONObject a, Consumer<String> reply) {
    switch (kind) {
      case "update.device":
        reply.accept(attempt(this::device));
        break;
      case "update.progress":
        reply.accept(
            attempt(
                () -> {
                  long[] p = progress.get(confine(a.getString("path")).getPath());
                  return new JSONObject()
                      .put("received", p == null ? 0 : p[0])
                      .put("total", p == null ? -1 : p[1]);
                }));
        break;
      case "update.download":
        worker.execute(
            () -> reply.accept(attempt(() -> download(a.getString("url"), a.getString("path"), a.getLong("max")))));
        break;
      case "update.signers":
        worker.execute(() -> reply.accept(attempt(() -> signers(a.getString("path")))));
        break;
      case "update.install":
        worker.execute(() -> install(a.optString("path", ""), reply));
        break;
      default:
        reply.accept(failure("not available on this phone"));
    }
  }

  private interface Task {
    Object run() throws Exception;
  }

  private static String attempt(Task task) {
    try {
      return success(task.run());
    } catch (Exception e) {
      Log.w(TAG, "update step failed: " + e.getClass().getSimpleName());
      return failure(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
    }
  }

  private static String success(Object value) {
    try {
      return new JSONObject().put("ok", true).put("value", value == null ? JSONObject.NULL : value).toString();
    } catch (Exception e) {
      return failure("failed");
    }
  }

  private static String failure(String message) {
    try {
      return new JSONObject().put("ok", false).put("error", message).toString();
    } catch (Exception e) {
      return "{\"ok\":false,\"error\":\"failed\"}";
    }
  }

  // ---- device ----

  @SuppressWarnings("deprecation")
  private JSONObject device() throws Exception {
    JSONArray abis = new JSONArray();
    for (String abi : Build.SUPPORTED_ABIS) abis.put(abi);
    PackageInfo me = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
    long versionCode = Build.VERSION.SDK_INT >= 28 ? me.getLongVersionCode() : me.versionCode;
    return new JSONObject().put("abis", abis).put("versionCode", versionCode).put("sdk", Build.VERSION.SDK_INT);
  }

  // ---- download ----

  private static boolean allowed(String url) {
    for (String prefix : ALLOWED) if (url.startsWith(prefix)) return true;
    return false;
  }

  private JSONObject download(String url, String path, long max) throws Exception {
    if (!allowed(url) || url.contains("..")) throw new IOException("not a River release address");
    if (max <= 0) throw new IOException("bad size limit");
    File dir = folder();
    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create the update folder");
    File target = confine(path);
    File part = new File(dir, target.getName() + ".part");
    String key = target.getPath();
    progress.put(key, new long[] {0, -1});
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    try {
      if (!(c instanceof HttpsURLConnection)) throw new IOException("HTTPS only");
      c.setConnectTimeout(15_000);
      c.setReadTimeout(30_000);
      // Redirects (to GitHub's download servers) stay on HTTPS: HttpURLConnection never follows a
      // redirect to another protocol.
      c.setInstanceFollowRedirects(true);
      c.setUseCaches(false);
      c.setRequestProperty("User-Agent", "River-Android");
      c.setRequestProperty(
          "Accept", url.startsWith("https://api.github.com/") ? "application/vnd.github+json" : "*/*");
      int code = c.getResponseCode();
      if (code != 200) throw new IOException("HTTP " + code);
      if (!"https".equals(c.getURL().getProtocol())) throw new IOException("HTTPS only");
      long total = c.getContentLengthLong();
      if (total > max) throw new IOException("the file is larger than expected");
      progress.put(key, new long[] {0, total});
      MessageDigest sha = MessageDigest.getInstance("SHA-256");
      long received = 0;
      try (InputStream in = new BufferedInputStream(c.getInputStream());
          OutputStream out = new FileOutputStream(part)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
          if (n == 0) continue;
          received += n;
          if (received > max) throw new IOException("the file is larger than expected");
          sha.update(buf, 0, n);
          out.write(buf, 0, n);
          progress.put(key, new long[] {received, total});
        }
        out.flush();
      }
      if (target.exists() && !target.delete()) throw new IOException("cannot replace " + target.getName());
      if (!part.renameTo(target)) throw new IOException("cannot save " + target.getName());
      return new JSONObject().put("size", received).put("sha256", hex(sha.digest()));
    } catch (Exception e) {
      //noinspection ResultOfMethodCallIgnored
      part.delete();
      progress.remove(key);
      throw e;
    } finally {
      c.disconnect();
    }
  }

  // ---- signing certificates ----

  @SuppressWarnings("deprecation")
  private JSONObject signersOf(PackageInfo info) throws Exception {
    JSONArray current = new JSONArray();
    JSONArray history = new JSONArray();
    if (Build.VERSION.SDK_INT >= 28) {
      SigningInfo s = info.signingInfo;
      if (s != null) {
        Signature[] contents = s.getApkContentsSigners();
        if (contents != null) for (Signature sig : contents) current.put(certHash(sig));
        Signature[] past = s.hasMultipleSigners() ? contents : s.getSigningCertificateHistory();
        if (past != null) for (Signature sig : past) history.put(certHash(sig));
      }
    } else if (info.signatures != null) {
      for (Signature sig : info.signatures) {
        current.put(certHash(sig));
        history.put(certHash(sig));
      }
    }
    return new JSONObject().put("current", current).put("history", history);
  }

  @SuppressWarnings("deprecation")
  private static int signingFlags() {
    return Build.VERSION.SDK_INT >= 28
        ? PackageManager.GET_SIGNING_CERTIFICATES
        : PackageManager.GET_SIGNATURES;
  }

  @SuppressWarnings("deprecation")
  private PackageInfo archiveInfo(File apk) {
    PackageInfo info = context.getPackageManager().getPackageArchiveInfo(apk.getPath(), signingFlags());
    if (info != null && info.applicationInfo != null) {
      // Needed on some Android versions before the archive's details can be read.
      info.applicationInfo.sourceDir = apk.getPath();
      info.applicationInfo.publicSourceDir = apk.getPath();
    }
    return info;
  }

  @SuppressWarnings("deprecation")
  private JSONObject signers(String path) throws Exception {
    File apk = confine(path);
    if (!apk.isFile()) throw new IOException("the update file is missing");
    PackageManager pm = context.getPackageManager();
    PackageInfo installed = pm.getPackageInfo(context.getPackageName(), signingFlags());
    PackageInfo archive = archiveInfo(apk);
    return new JSONObject()
        .put("ownPackage", context.getPackageName())
        .put("installed", signersOf(installed))
        .put("packageName", archive == null ? JSONObject.NULL : archive.packageName)
        .put("apk", archive == null ? JSONObject.NULL : signersOf(archive));
  }

  private static String certHash(Signature sig) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()));
  }

  private static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
    return sb.toString();
  }

  // ---- install ----

  private static String status(String status, String message) {
    try {
      JSONObject o = new JSONObject().put("status", status);
      if (message != null) o.put("message", message);
      return success(o);
    } catch (Exception e) {
      return failure("failed");
    }
  }

  private void install(String path, Consumer<String> reply) {
    int session = -1;
    PackageInstaller installer = context.getPackageManager().getPackageInstaller();
    try {
      File apk = confine(path);
      if (!apk.isFile()) throw new IOException("the update file is missing");
      String own = context.getPackageName();
      PackageInfo archive = archiveInfo(apk);
      if (archive != null && !own.equals(archive.packageName)) throw new IOException("not a River update");
      if (!context.getPackageManager().canRequestPackageInstalls()) {
        // Settings → Apps → Special access → Install unknown apps → River.
        Intent settings =
            new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + own))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
          context.startActivity(settings);
        } catch (ActivityNotFoundException | SecurityException ignored) {
          // some phones hide the setting; the UI still explains what is needed
        }
        reply.accept(status("permission-needed", null));
        return;
      }
      // An earlier attempt still waiting (its installer screen was closed): it is replaced.
      AppNotices.cancelUpdate(context);
      for (Integer previous : installs.keySet()) {
        Consumer<String> old = installs.remove(previous);
        try {
          installer.abandonSession(previous);
        } catch (RuntimeException ignored) {
          // already finished
        }
        if (old != null) old.accept(status("aborted", null));
      }
      PackageInstaller.SessionParams params =
          new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
      // Android refuses the session if the APK is any other app.
      params.setAppPackageName(own);
      params.setSize(apk.length());
      params.setInstallReason(PackageManager.INSTALL_REASON_USER);
      session = installer.createSession(params);
      try (PackageInstaller.Session s = installer.openSession(session)) {
        try (InputStream in = new FileInputStream(apk);
            OutputStream out = s.openWrite("river.apk", 0, apk.length())) {
          byte[] buf = new byte[64 * 1024];
          int n;
          while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
          s.fsync(out);
        }
        installs.put(session, reply);
        // Explicit, to River's own (not exported) receiver; mutable so Android can add the result.
        Intent result =
            new Intent(context, UpdateInstallReceiver.class)
                .setAction(ACTION_STATUS)
                .setPackage(own);
        int flags =
            PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent pending = PendingIntent.getBroadcast(context, session, result, flags);
        s.commit(pending.getIntentSender());
      }
    } catch (Exception e) {
      Log.w(TAG, "install failed: " + e.getClass().getSimpleName());
      if (session != -1) {
        installs.remove(session);
        try {
          installer.abandonSession(session);
        } catch (RuntimeException ignored) {
          // nothing to abandon
        }
      }
      reply.accept(failure(e.getMessage() == null ? "the update could not be installed" : e.getMessage()));
    }
  }

  /** PackageInstaller's answer for a session (UpdateInstallReceiver). */
  void onStatus(Intent intent) {
    int session = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
    int code = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
    if (code == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      // Android's confirmation ("Do you want to update this app?"): the user decides.
      Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
      if (confirm != null) {
        // From the background Android silently blocks the activity (2.11.2): with River not in
        // front the confirmation waits behind a "River update ready — tap to install" notification.
        if (CoreHost.get(context).isForeground()) {
          try {
            context.startActivity(new Intent(confirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return;
          } catch (RuntimeException e) {
            Log.w(TAG, "the installer's confirmation could not open");
          }
        }
        if (AppNotices.updateReady(context, session, confirm)) return;
      }
      Consumer<String> reply = installs.remove(session);
      if (reply != null) reply.accept(status("failed", context.getString(io.github.martexdev.river.R.string.installer_could_not_open)));
      return;
    }
    AppNotices.cancelUpdate(context);
    Consumer<String> reply = installs.remove(session);
    if (reply == null) return;
    String outcome;
    switch (code) {
      case PackageInstaller.STATUS_SUCCESS:
        outcome = "success";
        break;
      case PackageInstaller.STATUS_FAILURE_ABORTED:
        outcome = "aborted";
        break;
      case PackageInstaller.STATUS_FAILURE_CONFLICT:
      case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
        // Signed with another key (or otherwise not an update of this install).
        outcome = "conflict";
        break;
      default:
        outcome = "failed";
    }
    reply.accept(status(outcome, message));
  }
}
