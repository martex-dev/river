package io.github.martexdev.river.core;

import static io.github.martexdev.river.core.SignalOps.b;
import static io.github.martexdev.river.core.SignalOps.s;

import android.database.Cursor;
import android.database.sqlite.SQLiteException;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import net.zetetic.database.sqlcipher.SQLiteStatement;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * River's local database on Android: SQLCipher 4 (the same format and settings
 * as the desktop's), keyed with a raw 32-byte key. One statement per call; the
 * core splits scripts and drives transactions with BEGIN / COMMIT / ROLLBACK
 * and savepoints.
 */
final class DbOps {
  private final Map<Integer, SQLiteDatabase> open = new HashMap<>();
  private int next = 1;

  static {
    System.loadLibrary("sqlcipher");
  }

  private SQLiteDatabase db(JSONObject a) throws Exception {
    SQLiteDatabase db = open.get(a.getInt("db"));
    if (db == null) throw new SignalOps.Failure("database is closed", "SQLITE_MISUSE");
    return db;
  }

  private static Object[] params(JSONArray raw) throws Exception {
    Object[] out = new Object[raw.length()];
    for (int i = 0; i < raw.length(); i++) {
      Object v = raw.get(i);
      if (v == JSONObject.NULL) out[i] = null;
      else if (v instanceof JSONObject) out[i] = b(((JSONObject) v).getString("$b"));
      else if (v instanceof Integer || v instanceof Long) out[i] = ((Number) v).longValue();
      else if (v instanceof Number) {
        double d = ((Number) v).doubleValue();
        out[i] = (d == Math.rint(d) && Math.abs(d) < 9.007199254740992E15) ? (Object) (long) d : (Object) d;
      } else out[i] = v.toString();
    }
    return out;
  }

  private static String keyword(String sql) {
    String t = sql.trim();
    int end = 0;
    while (end < t.length() && Character.isLetter(t.charAt(end))) end++;
    return t.substring(0, end).toUpperCase(Locale.ROOT);
  }

  private static boolean returnsRows(String sql) {
    String k = keyword(sql);
    return k.equals("SELECT") || k.equals("PRAGMA") || k.equals("WITH") || k.equals("VALUES") || k.equals("EXPLAIN");
  }

  private static SignalOps.Failure sqliteFailure(SQLiteException e) {
    String m = e.getMessage() == null ? "SQLite error" : e.getMessage();
    String code = m.contains("file is not a database") || m.contains("(code 26") ? "SQLITE_NOTADB" : "SQLITE_ERROR";
    if (m.contains("constraint") || m.contains("(code 19")) code = "SQLITE_CONSTRAINT";
    return new SignalOps.Failure(m, code);
  }

  private static JSONObject rows(Cursor c) throws Exception {
    JSONArray columns = new JSONArray();
    for (String n : c.getColumnNames()) columns.put(n);
    JSONArray rows = new JSONArray();
    while (c.moveToNext()) {
      JSONArray row = new JSONArray();
      for (int i = 0; i < c.getColumnCount(); i++) {
        switch (c.getType(i)) {
          case Cursor.FIELD_TYPE_NULL:
            row.put(JSONObject.NULL);
            break;
          case Cursor.FIELD_TYPE_INTEGER:
            row.put(c.getLong(i));
            break;
          case Cursor.FIELD_TYPE_FLOAT:
            row.put(c.getDouble(i));
            break;
          case Cursor.FIELD_TYPE_BLOB:
            row.put(new JSONObject().put("$b", s(c.getBlob(i))));
            break;
          default:
            row.put(c.getString(i));
        }
      }
      rows.put(row);
    }
    return new JSONObject().put("columns", columns).put("rows", rows);
  }

  Object call(String method, JSONObject a) throws Exception {
    try {
      switch (method) {
        case "db.open":
          {
            File f = new File(a.getString("path"));
            // SQLCipher reads a key given as x'…' as the raw key, exactly as PRAGMA key does on the desktop.
            String hex = toHex(b(a.getString("key")));
            byte[] key = ("x'" + hex + "'").getBytes(StandardCharsets.US_ASCII);
            SQLiteDatabase db =
                SQLiteDatabase.openDatabase(
                    f.getPath(),
                    key,
                    null,
                    SQLiteDatabase.OPEN_READWRITE | SQLiteDatabase.CREATE_IF_NECESSARY | SQLiteDatabase.NO_LOCALIZED_COLLATORS,
                    null,
                    null);
            java.util.Arrays.fill(key, (byte) 0);
            try (Cursor c = db.rawQuery("SELECT count(*) FROM sqlite_master", new Object[0])) {
              c.moveToFirst();
            } catch (SQLiteException e) {
              db.close();
              throw e;
            }
            int id = next++;
            open.put(id, db);
            return id;
          }
        case "db.close":
          {
            SQLiteDatabase db = open.remove(a.getInt("db"));
            if (db != null) db.close();
            return JSONObject.NULL;
          }
        case "db.run":
          {
            SQLiteDatabase db = db(a);
            String sql = a.getString("sql");
            Object[] args = params(a.getJSONArray("params"));
            String upper = sql.trim().toUpperCase(Locale.ROOT);
            if (upper.equals("BEGIN")) {
              db.beginTransaction();
              return changes(0, 0);
            }
            if (upper.equals("COMMIT")) {
              db.setTransactionSuccessful();
              db.endTransaction();
              return changes(0, 0);
            }
            if (upper.equals("ROLLBACK")) {
              db.endTransaction();
              return changes(0, 0);
            }
            if (returnsRows(sql)) {
              try (Cursor c = db.rawQuery(sql, args)) {
                while (c.moveToNext()) {
                  // run to completion
                }
              }
              return changes(0, 0);
            }
            String k = keyword(sql);
            if (k.equals("INSERT") || k.equals("REPLACE") || k.equals("UPDATE") || k.equals("DELETE")) {
              try (SQLiteStatement st = db.compileStatement(sql)) {
                st.bindAllArgs(args);
                int n = st.executeUpdateDelete();
                long rowid = 0;
                try (Cursor c = db.rawQuery("SELECT last_insert_rowid()", new Object[0])) {
                  if (c.moveToFirst()) rowid = c.getLong(0);
                }
                return changes(n, rowid);
              }
            }
            try (SQLiteStatement st = db.compileStatement(sql)) {
              st.bindAllArgs(args);
              st.execute();
            }
            return changes(0, 0);
          }
        case "db.all":
          {
            SQLiteDatabase db = db(a);
            String sql = a.getString("sql");
            Object[] args = params(a.getJSONArray("params"));
            if (!returnsRows(sql)) {
              call("db.run", a);
              return new JSONObject().put("columns", new JSONArray()).put("rows", new JSONArray());
            }
            try (Cursor c = db.rawQuery(sql, args)) {
              return rows(c);
            }
          }
        default:
          throw new SignalOps.Failure("unknown native method " + method, null);
      }
    } catch (SQLiteException e) {
      throw sqliteFailure(e);
    }
  }

  private static JSONObject changes(int changes, long rowid) throws Exception {
    return new JSONObject().put("changes", changes).put("lastInsertRowid", rowid);
  }

  private static String toHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte x : bytes) sb.append(String.format(Locale.ROOT, "%02x", x));
    return sb.toString();
  }
}
