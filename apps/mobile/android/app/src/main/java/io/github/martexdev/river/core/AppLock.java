package io.github.martexdev.river.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

/**
 * Settings → System → Lock River: River asks for the fingerprint, face or
 * screen lock whenever it comes to the front. A cover hides River until then,
 * and goes up as soon as River leaves the front (before Android takes the
 * recent-apps preview; on Android 13+ that preview is turned off while the
 * lock is on). The setting lives in the app's private preferences so the lock
 * applies before the client core has started.
 */
public final class AppLock {
  private static final int AUTHENTICATORS =
      BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
  private final AppCompatActivity activity;
  private final SharedPreferences prefs;
  private View cover;
  private boolean unlocked = false;
  private boolean prompting = false;
  private Runnable onUnlock;

  public AppLock(AppCompatActivity activity) {
    this.activity = activity;
    this.prefs = prefsOf(activity);
    current = this;
  }

  /** Runs after each unlock (River's screen is usable again). */
  public void onUnlocked(Runnable fn) {
    onUnlock = fn;
  }

  /** The screen is going away: the lock lets go of it. */
  public void detach() {
    if (current == this) current = null;
    onUnlock = null;
  }

  /** River is hidden behind the lock right now. */
  public boolean covering() {
    return cover != null;
  }

  /** Android 13+: no recent-apps preview of River while the lock is on. */
  private void applyRecents() {
    if (android.os.Build.VERSION.SDK_INT >= 33) activity.setRecentsScreenshotEnabled(!enabled());
  }

  private static SharedPreferences prefsOf(Context context) {
    return context.getSharedPreferences("river-app-lock", Context.MODE_PRIVATE);
  }

  public static boolean available(Context context) {
    return BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
  }

  /** Last screen that was open, so turning the lock on does not lock it straight away. */
  private static AppLock current;

  /** From the client core: Settings → System → Lock River. Returns whether the phone can do it. */
  public static boolean setEnabled(Context context, boolean enabled) {
    boolean can = available(context);
    SharedPreferences prefs = prefsOf(context);
    boolean was = prefs.getBoolean("enabled", false);
    prefs.edit().putBoolean("enabled", enabled && can).apply();
    AppLock lock = current;
    if (lock != null) {
      lock.applyRecents();
      if (!enabled || !can) {
        lock.unlocked = true;
        lock.hide();
      } else if (!was) {
        // Switched on just now, by someone using River: no need to ask straight away.
        lock.unlocked = true;
      }
      // Already on (the core repeats the setting when it starts): the lock stays as it is.
    }
    return can;
  }

  public boolean enabled() {
    return prefs.getBoolean("enabled", false);
  }

  /** Activity came to the front. */
  public void onResume() {
    applyRecents();
    if (!enabled() || unlocked) {
      hide();
      return;
    }
    show();
    prompt();
  }

  /**
   * Activity is leaving the front: cover it now, before the recent-apps preview is taken. A
   * dialog in front (a permission prompt) only covers it; leaving River (onStop) locks it.
   * In picture-in-picture the call stays visible.
   */
  public void onPause() {
    if (!enabled() || activity.isInPictureInPictureMode()) return;
    show();
  }

  /** Activity left the screen: lock again (and cover the recent-apps preview). */
  public void onStop() {
    if (!enabled()) return;
    unlocked = false;
    show();
  }

  private void prompt() {
    if (prompting) return;
    prompting = true;
    BiometricPrompt prompt =
        new BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            new BiometricPrompt.AuthenticationCallback() {
              @Override
              public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                prompting = false;
                unlocked = true;
                hide();
                Runnable next = onUnlock;
                if (next != null) next.run();
              }

              @Override
              public void onAuthenticationError(int code, CharSequence message) {
                prompting = false;
              }
            });
    prompt.authenticate(
        new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock River")
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build());
  }

  private void show() {
    if (cover != null) return;
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER);
    box.setBackgroundColor(Color.parseColor("#0B1222"));
    box.setClickable(true);
    TextView title = new TextView(activity);
    title.setText("River is locked");
    title.setTextColor(Color.WHITE);
    title.setTextSize(20);
    title.setGravity(Gravity.CENTER);
    Button unlock = new Button(activity);
    unlock.setText("Unlock");
    unlock.setOnClickListener(v -> prompt());
    box.addView(title);
    box.addView(unlock);
    FrameLayout root = activity.findViewById(android.R.id.content);
    // Covered is not enough (2.18): what lies under the cover (River's interface) is also taken
    // away from screen readers (TalkBack reads and taps views a cover only hides from sight) and
    // from a keyboard, which would still type into a focused message box.
    hiddenFromAccessibility.clear();
    for (int i = 0; i < root.getChildCount(); i++) {
      View under = root.getChildAt(i);
      hiddenFromAccessibility.put(under, under.getImportantForAccessibility());
      under.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
    }
    View focused = activity.getCurrentFocus();
    if (focused != null) focused.clearFocus();
    root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    box.setFocusable(true);
    box.setFocusableInTouchMode(true);
    box.requestFocus();
    cover = box;
  }

  /** What the views under the cover were for screen readers before it went up. */
  private final java.util.Map<View, Integer> hiddenFromAccessibility = new java.util.HashMap<>();

  private void hide() {
    if (cover == null) return;
    ((ViewGroup) cover.getParent()).removeView(cover);
    cover = null;
    for (java.util.Map.Entry<View, Integer> e : hiddenFromAccessibility.entrySet())
      e.getKey().setImportantForAccessibility(e.getValue());
    hiddenFromAccessibility.clear();
  }
}
