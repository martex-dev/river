import Capacitor
import Foundation
import UIKit
import WebKit

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
    /// What a call gets when the core was reloaded before it answered (bridge.ts makes it an Error).
    private static let restarted = "{\"ok\":false,\"error\":\"River restarted its core. Try again.\"}"
    /// Call ids for the app's lifetime (the core outlives a screen), so an old reply never resolves a new call.
    private static var next = 1
    private static let idLock = NSLock()
    private var calls: [Int: CAPPluginCall] = [:]
    private let lock = NSLock()

    override public func load() {
        CoreHost.shared.listener = self
    }

    @objc func invoke(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing call")
            return
        }
        RiverCorePlugin.idLock.lock()
        let id = RiverCorePlugin.next
        RiverCorePlugin.next += 1
        RiverCorePlugin.idLock.unlock()
        lock.lock()
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

    public func coreRestarted() {
        lock.lock()
        let waiting = calls
        calls = [:]
        lock.unlock()
        for call in waiting.values { call.resolve(["json": RiverCorePlugin.restarted] as [String: Any]) }
    }
}

/// River's main screen: Capacitor's bridge (the UI) plus the client core.
@objc(RiverBridgeViewController)
open class RiverBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // The interface learns it runs on iOS (window.__riverPlatform) before its scripts run:
        // an iPad's WebView reports a Mac user agent. The page loads after this (viewDidLoad).
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: CoreHost.platformScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        bridge?.registerPluginInstance(RiverCorePlugin())
        CoreHost.shared.start(in: self)
        AppLock.shared.start(in: self)
    }
}
