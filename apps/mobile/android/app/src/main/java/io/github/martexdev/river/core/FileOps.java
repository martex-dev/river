package io.github.martexdev.river.core;

import static io.github.martexdev.river.core.SignalOps.b;
import static io.github.martexdev.river.core.SignalOps.s;

import android.content.Context;
import android.net.Uri;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Files for the client core, confined to the app's private storage. A file
 * the person chose to save elsewhere (Android's "Save as" picker) appears to
 * the core as a path under cache/saf/ and is written to the chosen document.
 */
final class FileOps {
  private final Context context;
  private final File files;
  private final File cache;
  private final Map<String, Uri> saveTargets = new ConcurrentHashMap<>();
  private int nextTarget = 1;

  FileOps(Context context) throws IOException {
    this.context = context;
    this.files = context.getFilesDir().getCanonicalFile();
    this.cache = context.getCacheDir().getCanonicalFile();
  }

  /** Registers a document the person picked; returns the path the core writes it at. */
  synchronized String saveTarget(Uri uri, String name) {
    String safe = name.replaceAll("[^A-Za-z0-9._ -]", "_");
    if (safe.isEmpty() || safe.startsWith(".")) safe = "file" + safe;
    String path = new File(cache, "saf/" + (nextTarget++) + "/" + safe).getPath();
    saveTargets.put(path, uri);
    return path;
  }

  private File confine(String path) throws IOException, SignalOps.Failure {
    File f = new File(path).getCanonicalFile();
    String p = f.getPath();
    if (p.equals(files.getPath()) || p.startsWith(files.getPath() + File.separator)) return f;
    if (p.equals(cache.getPath()) || p.startsWith(cache.getPath() + File.separator)) return f;
    throw new SignalOps.Failure("outside app storage: " + path, "EACCES");
  }

  private static SignalOps.Failure enoent(String path) {
    return new SignalOps.Failure("no such file or directory: " + path, "ENOENT");
  }

  private static byte[] readAll(InputStream in) throws IOException {
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    byte[] buf = new byte[65536];
    int n;
    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    return out.toByteArray();
  }

  private static boolean removeTree(File f) {
    File[] children = f.listFiles();
    if (children != null) for (File c : children) removeTree(c);
    return f.delete();
  }

  Object call(String method, JSONObject a) throws Exception {
    switch (method) {
      case "fs.paths":
        {
          File documents = new File(files, "documents");
          File downloads = new File(files, "downloads");
          return new JSONObject()
              .put("data", files.getPath())
              .put("cache", cache.getPath())
              .put("documents", documents.getPath())
              .put("downloads", downloads.getPath());
        }
      case "fs.read":
        {
          File f = confine(a.getString("path"));
          if (!f.isFile()) throw enoent(a.getString("path"));
          try (InputStream in = new FileInputStream(f)) {
            return s(readAll(in));
          }
        }
      case "fs.write":
        {
          String path = a.getString("path");
          boolean append = a.optBoolean("append", false);
          Uri target = saveTargets.get(new File(path).getPath());
          if (target != null) {
            try (OutputStream out = context.getContentResolver().openOutputStream(target, append ? "wa" : "wt")) {
              if (out == null) throw new IOException("cannot write the chosen file");
              out.write(b(a.getString("data")));
            }
            return JSONObject.NULL;
          }
          File f = confine(path);
          File parent = f.getParentFile();
          if (parent == null || !parent.isDirectory()) throw enoent(path);
          try (OutputStream out = new FileOutputStream(f, append)) {
            out.write(b(a.getString("data")));
          }
          return JSONObject.NULL;
        }
      case "fs.stat":
        {
          String path = a.getString("path");
          if (saveTargets.containsKey(new File(path).getPath())) {
            return new JSONObject().put("size", 0).put("mtimeMs", System.currentTimeMillis()).put("dir", false);
          }
          File f = confine(path);
          if (!f.exists()) return JSONObject.NULL;
          return new JSONObject().put("size", f.length()).put("mtimeMs", f.lastModified()).put("dir", f.isDirectory());
        }
      case "fs.list":
        {
          File f = confine(a.getString("path"));
          String[] names = f.list();
          if (names == null) throw enoent(a.getString("path"));
          JSONArray out = new JSONArray();
          for (String n : names) out.put(n);
          return out;
        }
      case "fs.mkdir":
        {
          File f = confine(a.getString("path"));
          if (!f.isDirectory() && !f.mkdirs()) throw new IOException("cannot create " + a.getString("path"));
          return JSONObject.NULL;
        }
      case "fs.rename":
        {
          File from = confine(a.getString("from"));
          File to = confine(a.getString("to"));
          if (!from.exists()) throw enoent(a.getString("from"));
          if (to.exists() && !to.isDirectory() && !to.delete()) throw new IOException("cannot replace " + a.getString("to"));
          if (!from.renameTo(to)) throw new IOException("cannot rename " + a.getString("from"));
          return JSONObject.NULL;
        }
      case "fs.remove":
        {
          File f = confine(a.getString("path"));
          if (!f.exists()) throw enoent(a.getString("path"));
          boolean ok = a.optBoolean("recursive", false) ? removeTree(f) : f.delete();
          if (!ok) throw new IOException("cannot remove " + a.getString("path"));
          return JSONObject.NULL;
        }
      case "fs.copy":
        {
          File from = confine(a.getString("from"));
          File to = confine(a.getString("to"));
          if (!from.isFile()) throw enoent(a.getString("from"));
          try (InputStream in = new FileInputStream(from);
              OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
          }
          return JSONObject.NULL;
        }
      default:
        throw new SignalOps.Failure("unknown native method " + method, null);
    }
  }
}
