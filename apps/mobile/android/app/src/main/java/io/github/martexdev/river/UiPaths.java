package io.github.martexdev.river;

import com.getcapacitor.Bridge;

/**
 * What the interface's WebView may not load (2.18): Capacitor's file and content:// passthroughs.
 * They would hand the interface any file of River's (the database, its key file, logs) and any
 * content:// address River may open, on the interface's own origin and so past its content
 * security policy. River's interface never uses them; only the client core touches storage.
 */
final class UiPaths {
  private UiPaths() {}

  static boolean refused(String path) {
    if (path == null) return false;
    return path.startsWith(Bridge.CAPACITOR_FILE_START) || path.startsWith(Bridge.CAPACITOR_CONTENT_START);
  }
}
