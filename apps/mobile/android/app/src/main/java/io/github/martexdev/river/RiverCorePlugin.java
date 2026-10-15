package io.github.martexdev.river;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.martexdev.river.core.CoreHost;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * window.river's transport on Android (apps/mobile/ui/bridge.ts): carries the
 * UI's calls to the client core and its replies and events back. Payloads are
 * passed through untouched; the core validates every call.
 */
@CapacitorPlugin(name = "RiverCore")
public class RiverCorePlugin extends Plugin implements CoreHost.Listener {
  private final Map<Integer, PluginCall> calls = new ConcurrentHashMap<>();
  private final AtomicInteger next = new AtomicInteger(1);
  private CoreHost core;

  @Override
  public void load() {
    core = CoreHost.get(getContext());
    core.setListener(this);
  }

  @PluginMethod
  public void invoke(PluginCall call) {
    String json = call.getString("json");
    if (json == null) {
      call.reject("missing call");
      return;
    }
    int id = next.getAndIncrement();
    calls.put(id, call);
    core.invoke(id, json);
  }

  @PluginMethod
  public void send(PluginCall call) {
    String json = call.getString("json");
    if (json != null) core.send(json);
    call.resolve();
  }

  @Override
  public void onReply(int id, String payload) {
    PluginCall call = calls.remove(id);
    if (call == null) return;
    JSObject result = new JSObject();
    result.put("json", payload);
    call.resolve(result);
  }

  @Override
  public void onEvent(String payload) {
    JSObject data = new JSObject();
    data.put("json", payload);
    // Kept until the UI listens: the first status events arrive before React has started.
    notifyListeners("event", data, true);
  }
}
