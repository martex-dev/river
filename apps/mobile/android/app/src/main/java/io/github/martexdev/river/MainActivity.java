package io.github.martexdev.river;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import io.github.martexdev.river.core.AppLock;
import io.github.martexdev.river.core.CoreHost;
import io.github.martexdev.river.core.RiverService;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

public class MainActivity extends BridgeActivity implements CoreHost.Screen {
  /** How long River may show over the lock screen for a call that is not answered. */
  private static final long RING_OVER_LOCK_MS = 60_000;
  /** Android 13+: River asks for notifications once per app start, while its screen is in front. */
  private static boolean askedForNotifications;
  /** When the interface's renderer last ended: rebuilt up to 3 times a minute (as the core is). */
  private static final ArrayDeque<Long> uiCrashes = new ArrayDeque<>();

  private CoreHost core;
  private AppLock lock;
  private ActivityResultLauncher<Intent> saveLauncher;
  private ActivityResultLauncher<String> notificationPermission;
  /** "Save as" requests, one picker at a time; the first is the one showing. */
  private final ArrayDeque<PendingSave> saves = new ArrayDeque<>();
  /** Everything waiting for the notification permission prompt to close. */
  private final List<Runnable> afterPermission = new ArrayList<>();
  private boolean askingPermission;
  private boolean overLock;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable ringTimeout =
      () -> {
        if (!core.inCall()) showOverLock(false);
      };

  private static final class PendingSave {
    final String name;
    final Consumer<Uri> done;

    PendingSave(String name, Consumer<Uri> done) {
      this.name = name;
      this.done = done;
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RiverCorePlugin.class);
    core = CoreHost.get(this);
    lock = new AppLock(this);
    lock.onUnlocked(this::askForNotifications);
    saveLauncher =
        registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
              PendingSave done = saves.poll();
              if (done != null) {
                Uri uri = result.getData() == null ? null : result.getData().getData();
                done.done.accept(result.getResultCode() == RESULT_OK ? uri : null);
              }
              launchNextSave();
            });
    notificationPermission =
        registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
              askingPermission = false;
              runPermissionWaiters();
            });
    core.attach(this);
    super.onCreate(savedInstanceState);
    // Android's Back: River's interface goes back first (an open menu or dialog, then from a
    // conversation to the list); when it has nothing to go back to, River moves to the
    // background and keeps running, as Android's own apps do.
    getOnBackPressedDispatcher()
        .addCallback(
            this,
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                back();
              }
            });
    if (getBridge() != null) {
      getBridge()
          .addWebViewListener(
              new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                  // The interface's renderer crashed or was ended to free memory: open River's
                  // screen again rather than letting Android end River — unless it keeps
                  // crashing, which would loop: then the screen closes with a word.
                  long now = android.os.SystemClock.elapsedRealtime();
                  while (!uiCrashes.isEmpty() && now - uiCrashes.peekFirst() > 60_000) uiCrashes.pollFirst();
                  uiCrashes.addLast(now);
                  if (uiCrashes.size() > 3) {
                    uiCrashes.clear();
                    handler.post(
                        () -> {
                          android.widget.Toast.makeText(
                                  getApplicationContext(),
                                  "River's screen stopped several times in a row. Open River again.",
                                  android.widget.Toast.LENGTH_LONG)
                              .show();
                          finish();
                        });
                  } else {
                    handler.post(MainActivity.this::recreate);
                  }
                  return true;
                }
              });
    }
    core.start();
    // "Stay connected" survives restarts of the phone's app process.
    if (RiverService.enabled(this)) RiverService.setEnabled(this, true);
    // Rebuilt by Android, or reopened from recent apps: what opened it was handled the first time
    // (a share would be shared again, a call would show over the lock screen again).
    boolean fromHistory = (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
    if (savedInstanceState == null && !fromHistory) handle(getIntent());
  }

  private void back() {
    WebView ui = getBridge() == null ? null : getBridge().getWebView();
    if (ui == null || lock.covering()) {
      moveTaskToBack(true);
      return;
    }
    // Contract with the interface (apps/mobile/ui): window.__riverBack() returns true when it
    // handled Back itself.
    ui.evaluateJavascript(
        "(window.__riverBack ? window.__riverBack() : false)",
        handled -> {
          if (!"true".equals(handled)) moveTaskToBack(true);
        });
  }

  // ---- CoreHost.Screen ----

  @Override
  public AppCompatActivity activity() {
    return this;
  }

  @Override
  public void saveDocument(String name, Consumer<Uri> done) {
    saves.add(new PendingSave(name, done));
    if (saves.size() == 1) launchNextSave();
  }

  private void launchNextSave() {
    PendingSave next = saves.peek();
    if (next == null) return;
    try {
      saveLauncher.launch(
          new Intent(Intent.ACTION_CREATE_DOCUMENT)
              .addCategory(Intent.CATEGORY_OPENABLE)
              .setType("application/octet-stream")
              .putExtra(Intent.EXTRA_TITLE, next.name));
    } catch (ActivityNotFoundException e) {
      // No document picker on this phone: nothing was saved.
      saves.poll();
      next.done.accept(null);
      launchNextSave();
    }
  }

  @Override
  public void requestNotifications(Runnable after) {
    afterPermission.add(after);
    if (askingPermission) return;
    askingPermission = true;
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
  }

  private void runPermissionWaiters() {
    List<Runnable> waiting = new ArrayList<>(afterPermission);
    afterPermission.clear();
    for (Runnable r : waiting) r.run();
  }

  /**
   * Android 13+ shows River's notifications only with permission, and the prompt can only show
   * while River is in front: ask the first time River's screen is in front and unlocked.
   */
  private void askForNotifications() {
    if (android.os.Build.VERSION.SDK_INT < 33 || askedForNotifications || askingPermission) return;
    if (lock.covering() || isFinishing()) return;
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        == PackageManager.PERMISSION_GRANTED) return;
    askedForNotifications = true;
    askingPermission = true;
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
  }

  @Override
  public Class<?> activityClass() {
    return MainActivity.class;
  }

  /**
   * An incoming call shows River over the lock screen and wakes it, like any phone call. It ends
   * when the call does, when the ringing stops unanswered, or when River leaves the screen
   * outside a call; never later than a minute without a call.
   */
  @Override
  public void showOverLock(boolean on) {
    if (android.os.Build.VERSION.SDK_INT < 27) return;
    handler.removeCallbacks(ringTimeout);
    if (on) handler.postDelayed(ringTimeout, RING_OVER_LOCK_MS);
    if (on == overLock) return;
    overLock = on;
    setShowWhenLocked(on);
    setTurnScreenOn(on);
  }

  // ---- picture-in-picture during calls (2.10) ----

  private boolean pipAllowed;

  private boolean pipSupported() {
    return getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE);
  }

  private android.app.PictureInPictureParams pipParams(boolean auto) {
    android.app.PictureInPictureParams.Builder b =
        new android.app.PictureInPictureParams.Builder().setAspectRatio(new android.util.Rational(3, 4));
    if (android.os.Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(auto).setSeamlessResizeEnabled(false);
    return b.build();
  }

  @Override
  public void pip(boolean allowed) {
    pipAllowed = allowed;
    // Android 12+ moves the call into a small window by itself when River is left.
    if (pipSupported() && android.os.Build.VERSION.SDK_INT >= 31) setPictureInPictureParams(pipParams(allowed));
  }

  @Override
  protected void onUserLeaveHint() {
    super.onUserLeaveHint();
    // Android 8 to 11: going home during a call keeps it in a small window.
    if (pipAllowed && pipSupported() && android.os.Build.VERSION.SDK_INT < 31) {
      try {
        enterPictureInPictureMode(pipParams(false));
      } catch (IllegalStateException ignored) {
        // not allowed right now: the call goes on in the background as before
      }
    }
  }

  @Override
  public void onPictureInPictureModeChanged(boolean inPip, android.content.res.Configuration config) {
    super.onPictureInPictureModeChanged(inPip, config);
    shareToUi("{\"channel\":\"river:app:pip\",\"args\":[" + inPip + "]}");
  }

  // ---- lifecycle ----

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    handle(intent);
  }

  private void handle(Intent intent) {
    if (intent == null) return;
    if (ShareReceiver.isShare(intent)) {
      // Reading shared files can take a moment: off the main thread, then to the interface.
      new Thread(
              () -> {
                String event = ShareReceiver.read(getApplicationContext(), intent);
                if (event != null) runOnUiThread(() -> shareToUi(event));
              },
              "river-share")
          .start();
      return;
    }
    if (intent.getBooleanExtra(CoreHost.EXTRA_CALL, false)) showOverLock(true);
    int notification = intent.getIntExtra(CoreHost.EXTRA_NOTIFICATION, 0);
    if (notification > 0) {
      core.notificationTapped(notification, intent.getStringExtra(CoreHost.EXTRA_NOTIFICATION_TOKEN));
    }
    Uri data = intent.getData();
    if (data != null && "river".equals(data.getScheme())) core.deepLink(data.toString());
  }

  private void shareToUi(String event) {
    com.getcapacitor.PluginHandle handle = getBridge() == null ? null : getBridge().getPlugin("RiverCore");
    if (handle != null && handle.getInstance() instanceof RiverCorePlugin plugin) plugin.onEvent(event);
  }

  @Override
  public void onStart() {
    super.onStart();
    // River is on screen from here on (2.11.3): also behind the notification shade or in split
    // screen, where it is paused but its interface still shows an incoming call. (onResume and
    // onPause made the phone ring and show its call screen there too: two rings at once.)
    core.lifecycle(true);
  }

  @Override
  public void onResume() {
    super.onResume();
    lock.onResume();
    askForNotifications();
  }

  @Override
  public void onPause() {
    super.onPause();
    lock.onPause();
  }

  @Override
  public void onStop() {
    super.onStop();
    lock.onStop();
    core.lifecycle(false);
    // Left the screen outside a call: River no longer shows over the lock screen.
    if (!core.inCall()) showOverLock(false);
  }

  @Override
  public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
    // A call ringing while River is in front: a volume button silences it, as on a phone call.
    if ((keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP)
        && core.silenceRinging()) return true;
    return super.onKeyDown(keyCode, event);
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    // A picker or permission prompt still open gets its answer: nothing was chosen.
    PendingSave save;
    while ((save = saves.poll()) != null) save.done.accept(null);
    askingPermission = false;
    runPermissionWaiters();
    lock.detach();
    core.detach(this);
    // Without "Stay connected" River's core ends with its screen — after a call that was on has
    // told the other side it ended (detach told the core the screen is gone).
    if (isFinishing() && !RiverService.enabled(this)) core.stopAfterCall();
    super.onDestroy();
  }
}
