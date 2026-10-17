package io.github.martexdev.river.core;

import android.app.Activity;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The incoming call screen (2.11): shown by the call notification's
 * full-screen intent over the lock screen, waking the screen, like a phone
 * call. Native views only — no WebView, nothing of River's content but the
 * caller's name (or "Someone", with previews hidden). Accept opens River and
 * answers there; Decline declines without opening River. It closes as soon as
 * the call stops ringing ({@link IncomingCall#stop}). Not exported: only
 * River's own notifications open it.
 */
public final class IncomingCallActivity extends Activity {
  private String callId;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (handle(getIntent())) return;
    showOverLock();
    setContentView(layout());
    IncomingCall.attach(this);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (handle(intent)) return;
    setContentView(layout());
  }

  /** Answer from the notification, or a call that no longer rings: true when this screen is done. */
  private boolean handle(Intent intent) {
    callId = intent == null ? null : intent.getStringExtra(IncomingCall.EXTRA_CALL_ID);
    if (intent != null && IncomingCall.ACTION_ANSWER.equals(intent.getAction())) {
      answer();
      return true;
    }
    if (callId == null || !IncomingCall.ringing(callId)) {
      finish();
      return true;
    }
    return false;
  }

  private void showOverLock() {
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    } else {
      getWindow()
          .addFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
    // The screen stays on while it rings (the ringing ends after 45 seconds at most).
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  private void answer() {
    String id = callId;
    boolean ringing = id != null && CoreHost.get(this).callAnswered(id);
    if (ringing) {
      // River opens over the lock screen (EXTRA_CALL) and its interface answers the call there.
      startActivity(
          new Intent(this, RiverService.ACTIVITY)
              .addFlags(
                  Intent.FLAG_ACTIVITY_NEW_TASK
                      | Intent.FLAG_ACTIVITY_SINGLE_TOP
                      | Intent.FLAG_ACTIVITY_CLEAR_TOP)
              .putExtra(CoreHost.EXTRA_CALL, true));
    }
    finish();
  }

  private void decline() {
    String id = callId;
    if (id != null) CoreHost.get(this).callDeclined(id);
    finish();
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    // As on a phone call: a volume button silences the ringing.
    if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
      IncomingCall.silence();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  protected void onDestroy() {
    IncomingCall.detach(this);
    super.onDestroy();
  }

  // ---- the screen ----

  private int dp(float v) {
    return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
  }

  private TextView text(String s, float sp, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    t.setTextColor(color);
    t.setGravity(Gravity.CENTER);
    if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    return t;
  }

  private View button(String label, int color, int icon, View.OnClickListener onClick) {
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);
    column.setGravity(Gravity.CENTER_HORIZONTAL);
    ImageButton b = new ImageButton(this);
    GradientDrawable round = new GradientDrawable();
    round.setShape(GradientDrawable.OVAL);
    round.setColor(color);
    b.setBackground(round);
    b.setImageResource(icon);
    b.setImageTintList(ColorStateList.valueOf(Color.WHITE));
    b.setScaleType(ImageButton.ScaleType.CENTER_INSIDE);
    b.setPadding(dp(18), dp(18), dp(18), dp(18));
    b.setContentDescription(label);
    b.setOnClickListener(onClick);
    column.addView(b, new LinearLayout.LayoutParams(dp(76), dp(76)));
    TextView t = text(label, 16, Color.WHITE, false);
    t.setPadding(0, dp(10), 0, 0);
    column.addView(t);
    return column;
  }

  private View layout() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER_HORIZONTAL);
    root.setBackgroundColor(0xFF0F1720);
    root.setPadding(dp(24), dp(96), dp(24), dp(64));

    root.addView(text("River", 16, 0xB3FFFFFF, false));
    TextView who = text(IncomingCall.name(), 34, Color.WHITE, true);
    who.setPadding(0, dp(28), 0, dp(8));
    who.setMaxLines(2);
    root.addView(who);
    root.addView(text(IncomingCall.video() ? "Video call" : "Voice call", 18, 0xB3FFFFFF, false));

    View spacer = new View(this);
    root.addView(spacer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    row.addView(
        button("Decline", 0xFFE5484D, android.R.drawable.ic_menu_close_clear_cancel, v -> decline()), half);
    row.addView(button("Answer", 0xFF30A46C, android.R.drawable.ic_menu_call, v -> answer()), half);
    root.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    return root;
  }
}
