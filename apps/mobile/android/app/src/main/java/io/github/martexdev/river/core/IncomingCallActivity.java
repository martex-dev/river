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

  // ---- the screen (2.11.1: like a phone call — Telegram, Instagram, the phone's own) ----

  private final java.util.List<android.animation.Animator> animations = new java.util.ArrayList<>();

  private int dp(float v) {
    return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
  }

  private TextView text(String s, float sp, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    t.setTextColor(color);
    t.setGravity(Gravity.CENTER);
    if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
    t.setShadowLayer(dp(6), 0, dp(1), 0x40000000);
    return t;
  }

  /** Two colours from the caller's name, so each person's call looks a little different. */
  private static int[] palette(String name) {
    int[][] colours = {
      {0xFF1E3C72, 0xFF2A5298},
      {0xFF42275A, 0xFF734B6D},
      {0xFF0F3443, 0xFF2E8B6F},
      {0xFF3A1C71, 0xFFB45A6A},
      {0xFF134E5E, 0xFF4E8C62},
      {0xFF232526, 0xFF414345},
      {0xFF614385, 0xFF516395},
      {0xFF1F4037, 0xFF3F8F78},
    };
    int h = 0;
    for (int i = 0; i < name.length(); i++) h = h * 31 + name.charAt(i);
    return colours[Math.floorMod(h, colours.length)];
  }

  private static String initials(String name) {
    String[] parts = name.trim().split("\\s+");
    StringBuilder b = new StringBuilder();
    int letters = 0;
    for (String p : parts) {
      if (p.isEmpty()) continue;
      b.appendCodePoint(p.codePointAt(0));
      if (++letters >= 2) break;
    }
    String out = b.toString().toUpperCase(java.util.Locale.ROOT);
    return out.isEmpty() ? "?" : out;
  }

  /** The caller's picture: initials in a circle, with rings pulsing outward while it rings. */
  private View avatar(String name) {
    android.widget.FrameLayout box = new android.widget.FrameLayout(this);
    box.setClipChildren(false);
    int size = dp(132);
    for (int i = 0; i < 2; i++) {
      View ring = new View(this);
      GradientDrawable g = new GradientDrawable();
      g.setShape(GradientDrawable.OVAL);
      g.setColor(0x33FFFFFF);
      ring.setBackground(g);
      box.addView(ring, new android.widget.FrameLayout.LayoutParams(size, size, Gravity.CENTER));
      android.animation.ObjectAnimator pulse =
          android.animation.ObjectAnimator.ofPropertyValuesHolder(
              ring,
              android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.75f),
              android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.75f),
              android.animation.PropertyValuesHolder.ofFloat(View.ALPHA, 0.9f, 0f));
      pulse.setDuration(2000);
      pulse.setStartDelay(i * 1000L);
      pulse.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      pulse.setInterpolator(new android.view.animation.DecelerateInterpolator());
      animations.add(pulse);
    }
    TextView face = text(initials(name), 46, Color.WHITE, true);
    face.setShadowLayer(0, 0, 0, 0);
    GradientDrawable circle =
        new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {0x66FFFFFF, 0x26FFFFFF});
    circle.setShape(GradientDrawable.OVAL);
    circle.setStroke(dp(2), 0x80FFFFFF);
    face.setBackground(circle);
    box.addView(face, new android.widget.FrameLayout.LayoutParams(size, size, Gravity.CENTER));
    return box;
  }

  private View button(String label, int color, int icon, boolean bounce, View.OnClickListener onClick) {
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);
    column.setGravity(Gravity.CENTER_HORIZONTAL);
    column.setClipChildren(false);
    ImageButton b = new ImageButton(this);
    GradientDrawable round = new GradientDrawable();
    round.setShape(GradientDrawable.OVAL);
    round.setColor(color);
    b.setBackground(round);
    b.setImageResource(icon);
    b.setImageTintList(ColorStateList.valueOf(Color.WHITE));
    b.setScaleType(ImageButton.ScaleType.FIT_CENTER);
    b.setPadding(dp(20), dp(20), dp(20), dp(20));
    b.setElevation(dp(8));
    b.setContentDescription(label);
    b.setOnClickListener(onClick);
    column.addView(b, new LinearLayout.LayoutParams(dp(74), dp(74)));
    TextView t = text(label, 15, 0xE6FFFFFF, false);
    t.setPadding(0, dp(12), 0, 0);
    column.addView(t);
    if (bounce) {
      // The Answer button nudges, as phone call screens do.
      android.animation.ObjectAnimator nudge =
          android.animation.ObjectAnimator.ofPropertyValuesHolder(
              b,
              android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.1f, 1f),
              android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.1f, 1f));
      nudge.setDuration(1200);
      nudge.setRepeatCount(android.animation.ValueAnimator.INFINITE);
      animations.add(nudge);
    }
    return column;
  }

  private View layout() {
    for (android.animation.Animator a : animations) a.cancel();
    animations.clear();
    String name = IncomingCall.name();
    boolean video = IncomingCall.video();
    int[] colours = palette(name);
    android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
    frame.setBackground(
        new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM, new int[] {colours[0], colours[1], 0xFF05070C}));
    getWindow().setStatusBarColor(colours[0]);
    getWindow().setNavigationBarColor(0xFF05070C);

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER_HORIZONTAL);
    root.setPadding(dp(24), dp(72), dp(24), dp(56));
    root.setClipChildren(false);
    frame.addView(
        root,
        new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    TextView kind = text(video ? "River video call" : "River voice call", 15, 0xCCFFFFFF, false);
    kind.setLetterSpacing(0.04f);
    root.addView(kind);

    root.addView(new View(this), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 0.6f));
    root.addView(avatar(name), new LinearLayout.LayoutParams(dp(240), dp(240)));

    TextView who = text(name, 32, Color.WHITE, true);
    who.setPadding(0, dp(8), 0, dp(6));
    who.setMaxLines(2);
    who.setEllipsize(android.text.TextUtils.TruncateAt.END);
    root.addView(who);
    root.addView(text("Ringing…", 17, 0xB3FFFFFF, false));

    root.addView(new View(this), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER);
    row.setClipChildren(false);
    LinearLayout.LayoutParams half =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    row.addView(
        button("Decline", 0xFFFF3B30, io.github.martexdev.river.R.drawable.ic_call_end, false, v -> decline()),
        half);
    row.addView(
        button(
            "Answer",
            0xFF34C759,
            video
                ? io.github.martexdev.river.R.drawable.ic_call_video
                : io.github.martexdev.river.R.drawable.ic_call_answer,
            true,
            v -> answer()),
        half);
    root.addView(
        row,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    for (android.animation.Animator a : animations) a.start();
    return frame;
  }

  @Override
  protected void onStop() {
    // Off screen: the animations rest (they go on with the screen).
    for (android.animation.Animator a : animations) a.pause();
    super.onStop();
  }

  @Override
  protected void onStart() {
    super.onStart();
    for (android.animation.Animator a : animations) a.resume();
  }
}
