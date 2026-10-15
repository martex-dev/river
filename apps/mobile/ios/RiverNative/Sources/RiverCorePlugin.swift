import Capacitor
import Foundation
import UIKit

/// window.river's transport on iOS (apps/mobile/ui/bridge.ts): carries the UI's
/// calls to the client core and its replies and events back. Payloads pass
/// through untouched; the core validates every call.
@objc(RiverCorePlugin)
public class RiverCorePlugin: CAPPlugin, CAPBridgedPlugin, CoreListener {
    public let identifier = "RiverCorePlugin"
    public let jsName = "RiverCore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "invoke", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
    ]
    private var calls: [Int: CAPPluginCall] = [:]
    private var next = 1
    private let lock = NSLock()

    override public func load() {
        CoreHost.shared.listener = self
    }

    @objc func invoke(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing call")
            return
        }
        lock.lock()
        let id = next
        next += 1
        calls[id] = call
        lock.unlock()
        CoreHost.shared.invoke(id: id, json: json)
    }

    @objc func send(_ call: CAPPluginCall) {
        if let json = call.getString("json") { CoreHost.shared.send(json: json) }
        call.resolve()
    }

    public func coreReply(id: Int, payload: String) {
        lock.lock()
        let call = calls.removeValue(forKey: id)
        lock.unlock()
        call?.resolve(["json": payload] as [String: Any])
    }

    public func coreEvent(payload: String) {
        // Kept until the UI listens: the first status events arrive before React has started.
        notifyListeners("event", data: ["json": payload] as [String: Any], retainUntilConsumed: true)
    }
}

/// River's main screen: Capacitor's bridge (the UI) plus the client core.
@objc(RiverBridgeViewController)
open class RiverBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RiverCorePlugin())
        CoreHost.shared.start(in: self)
        AppLock.shared.start(in: self)
    }
}
