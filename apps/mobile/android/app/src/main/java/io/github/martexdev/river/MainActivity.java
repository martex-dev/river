package io.github.martexdev.river;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.BridgeActivity;
import io.github.martexdev.river.core.AppLock;
import io.github.martexdev.river.core.CoreHost;
import io.github.martexdev.river.core.RiverService;
import java.util.function.Consumer;

public class MainActivity extends BridgeActivity implements CoreHost.Screen {
  private CoreHost core;
  private AppLock lock;
  private ActivityResultLauncher<Intent> saveLauncher;
  private ActivityResultLauncher<String> notificationPermission;
  private Consumer<Uri> pendingSave;
  private Runnable afterPermission;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RiverCorePlugin.class);
    RiverService.activityClass = MainActivity.class;
    core = CoreHost.get(this);
    lock = new AppLock(this);
    saveLauncher =
        registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
              Consumer<Uri> done = pendingSave;
              pendingSave = null;
              if (done == null) return;
              Uri uri = result.getData() == null ? null : result.getData().getData();
              done.accept(result.getResultCode() == RESULT_OK ? uri : null);
            });
    notificationPermission =
        registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
              Runnable next = afterPermission;
              afterPermission = null;
              if (next != null) next.run();
            });
    core.attach(this);
    super.onCreate(savedInstanceState);
    core.start();
    // "Stay connected" survives restarts of the phone's app process.
    if (RiverService.enabled(this)) RiverService.setEnabled(this, true);
    handle(getIntent());
  }

  // ---- CoreHost.Screen ----

  @Override
  public AppCompatActivity activity() {
    return this;
  }

  @Override
  public void saveDocument(String name, Consumer<Uri> done) {
    pendingSave = done;
    saveLauncher.launch(
        new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, name));
  }

  @Override
  public void requestNotifications(Runnable after) {
    afterPermission = after;
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
  }

  @Override
  public Class<?> activityClass() {
    return MainActivity.class;
  }

  // ---- lifecycle ----

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
    lock.onResume();
    core.lifecycle(true);
  }

  @Override
  public void onPause() {
    super.onPause();
    core.lifecycle(false);
  }

  @Override
  public void onStop() {
    super.onStop();
    lock.onStop();
  }

  @Override
  public void onDestroy() {
    core.detach(this);
    // Without "Stay connected" River's core ends with its screen.
    if (isFinishing() && !RiverService.enabled(this)) core.stop();
    super.onDestroy();
  }
}
