package io.github.martexdev.river;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.martexdev.river.core.CoreHost;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * window.river's transport on Android (apps/mobile/ui/bridge.ts): carries the
 * UI's calls to the client core and its replies and events back. Payloads are
 * passed through untouched; the core validates every call.
 *
 * Call ids come from CoreHost, which outlives this plugin (the core keeps
 * running when River's screen closes): a reply meant for a closed screen's
 * call can never resolve a call of the next one.
 */
@CapacitorPlugin(name = "RiverCore")
public class RiverCorePlugin extends Plugin implements CoreHost.Listener {
  /** What a call gets when the core was replaced before it answered (bridge.ts makes it an Error). */
  private static final String RESTARTED = "{\"ok\":false,\"error\":\"River restarted its core. Try again.\"}";

  private final Map<Integer, PluginCall> calls = new ConcurrentHashMap<>();
  private CoreHost core;

  @Override
  public void load() {
    core = CoreHost.get(getContext());
    core.setListener(this);
  }

  @Override
  protected void handleOnDestroy() {
    // The screen is closing: the core must not keep this plugin (and its activity) alive.
    if (core != null) core.clearListener(this);
    calls.clear();
  }

  @PluginMethod
  public void invoke(PluginCall call) {
    String json = call.getString("json");
    if (json == null) {
      call.reject("missing call");
      return;
    }
    int id = core.nextCallId();
    calls.put(id, call);
    core.invoke(id, json);
  }

  @PluginMethod
  public void send(PluginCall call) {
    String json = call.getString("json");
    if (json != null) core.send(json);
    call.resolve();
  }

  /** On the main thread (CoreHost posts it). */
  @Override
  public void onReply(int id, String payload) {
    PluginCall call = calls.remove(id);
    if (call == null) return;
    JSObject result = new JSObject();
    result.put("json", payload);
    call.resolve(result);
  }

  /** On the main thread (CoreHost posts it). */
  @Override
  public void onEvent(String payload) {
    JSObject data = new JSObject();
    data.put("json", payload);
    // Kept until the UI listens: the first status events arrive before React has started.
    notifyListeners("event", data, true);
  }

  @Override
  public void onCoreRestarted() {
    List<Integer> ids = new ArrayList<>(calls.keySet());
    for (Integer id : ids) onReply(id, RESTARTED);
  }
}
