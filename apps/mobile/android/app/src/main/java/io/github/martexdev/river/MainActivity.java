package io.github.martexdev.river;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.martexdev.river.core.CoreHost;

public class MainActivity extends BridgeActivity {
  private CoreHost core;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RiverCorePlugin.class);
    core = new CoreHost(this);
    super.onCreate(savedInstanceState);
    core.start();
    handle(getIntent());
  }

  public CoreHost core() {
    return core;
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    handle(intent);
  }

  private void handle(Intent intent) {
    if (intent == null) return;
    int notification = intent.getIntExtra(CoreHost.EXTRA_NOTIFICATION, 0);
    if (notification > 0) core.notificationTapped(notification);
    Uri data = intent.getData();
    if (data != null && "river".equals(data.getScheme())) core.deepLink(data.toString());
  }

  @Override
  public void onResume() {
    super.onResume();
    core.lifecycle(true);
  }

  @Override
  public void onPause() {
    super.onPause();
    core.lifecycle(false);
  }

  @Override
  public void onDestroy() {
    core.destroy();
    super.onDestroy();
  }
}
