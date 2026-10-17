import AVFoundation
import Foundation
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

/// Where the core's replies and events go (the UI's plugin).
public protocol CoreListener: AnyObject {
    func coreReply(id: Int, payload: String)
    func coreEvent(payload: String)
    /// The core's page was reloaded (its web process ended): calls still waiting get no reply.
    func coreRestarted()
}

/// Runs River's client core in its own, invisible WKWebView: the only one with
/// the native interface. The UI's WebView reaches it through RiverCorePlugin;
/// replies and events come back the same way. This keeps the desktop's split:
/// the UI is untrusted and never sees keys, the core validates every call.
///
/// The native interface must be synchronous (the shared core uses synchronous
/// SQLite and crypto). WebKit's only synchronous path from page to app is the
/// prompt() panel, so `RiverNative.call` is a prompt the app answers itself.
public final class CoreHost: NSObject {
    public static let shared = CoreHost()

    /// Set in both WebViews before any script runs: an iPad's WebView reports a Mac user agent.
    public static let platformScript = "window.__riverPlatform = 'ios';"
    private static let promptPrefix = "river-native:"
    private static let coreURL = URL(string: "capacitor://localhost/core/index.html")!
    /// Notifications whose answer the core still waits for; older ones are answered "dismissed".
    private static let maxPendingNotifications = 32
    private var web: WKWebView?
    private var native: RiverNativeInterface?
    private var ready = false
    private var queue: [String] = []
    private var notificationAsks: [String: Int] = [:]
    /// Notification identifiers in the order they were posted (oldest first).
    private var notificationOrder: [String] = []
    /// Which page of the core is running: an answer that comes later only goes to the one that asked.
    private var generation = 0
    private var crashes: [Date] = []
    /// "Save to Files" sheets that are open, and the export each offers.
    private var exportPickers: [ObjectIdentifier: (generation: Int, id: Int, url: URL)] = [:]
    /** In a call on the earpiece the screen turns off at your ear (2.10.2). */
    private var inCall = false
    private var earpiece = false

    private func updateProximity() {
        let on = inCall && earpiece
        DispatchQueue.main.async { UIDevice.current.isProximityMonitoringEnabled = on }
    }
    public weak var listener: CoreListener?
    private weak var presenter: UIViewController?

    // MARK: start

    public func start(in controller: UIViewController) {
        guard web == nil else { return }
        NSLog("[River] starting the client core")
        presenter = controller
        do {
            native = try RiverNativeInterface()
        } catch {
            fatal("River could not open its storage: \(error)")
            return
        }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        // The core is served at capacitor://localhost/core/: an origin River's servers already allow.
        config.setURLSchemeHandler(CoreFiles(), forURLScheme: "capacitor")
        let bridge = """
            \(CoreHost.platformScript)
            window.RiverNative = { call: function (m, a) { return prompt('\(CoreHost.promptPrefix)' + m, a); } };
            window.RiverHost = { post: function (h, p) { window.webkit.messageHandlers.riverHost.postMessage([h, p]); } };
            window.addEventListener('error', function (e) {
              window.RiverHost.post('{"t":"log"}', 'error: ' + e.message + ' @ ' + e.filename + ':' + e.lineno);
            });
            ['error', 'warn'].forEach(function (level) {
              var original = console[level];
              console[level] = function () {
                try {
                  window.RiverHost.post('{"t":"log"}', level + ': ' + Array.prototype.map.call(arguments, String).join(' '));
                } catch (_) {}
                return original.apply(console, arguments);
              };
            });
            window.addEventListener('unhandledrejection', function (e) {
              window.RiverHost.post('{"t":"log"}', 'unhandled: ' + (e.reason && e.reason.stack || e.reason));
            });
            """
        config.userContentController.addUserScript(
            WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(WeakMessageHandler(self), name: "riverHost")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        view.isHidden = true
        view.uiDelegate = self
        view.navigationDelegate = self
        #if DEBUG
            if #available(iOS 16.4, *) { view.isInspectable = true }
        #endif
        controller.view.addSubview(view)
        web = view
        view.load(URLRequest(url: CoreHost.coreURL))
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(CoreHost.categories())
        let events = NotificationCenter.default
        events.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        events.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        // The core starts in the background; River may already be in front.
        if UIApplication.shared.applicationState == .active { foreground() }
    }

    @objc private func foreground() { run("__riverCore.lifecycle('foreground')") }
    @objc private func background() { run("__riverCore.lifecycle('background')") }

    /// The core's web process ended (a crash, or iOS reclaiming memory): load a new core.
    private func restartAfterCrash() {
        guard let web = web else { return }
        generation += 1
        ready = false
        queue = []
        // The old page's databases may hold a transaction open: close them before the new page opens.
        native?.closeDatabases()
        // Its notifications answered asks of the old page; the new page's asks start again at 1.
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: notificationOrder)
        notificationAsks = [:]
        notificationOrder = []
        inCall = false
        earpiece = false
        updateProximity()
        listener?.coreRestarted()
        let now = Date()
        crashes = crashes.filter { now.timeIntervalSince($0) < 60 } + [now]
        if crashes.count > 3 {
            fatal("River's core stopped several times in a row. Close River and open it again.")
            return
        }
        // The new page asks for its settings again (app lock, …) as it starts.
        web.load(URLRequest(url: CoreHost.coreURL))
        if UIApplication.shared.applicationState == .active { foreground() }
    }

    // MARK: UI → core

    func invoke(id: Int, json: String) { run("__riverCore.invoke(\(id), \(quote(json)))") }
    func send(json: String) { run("__riverCore.send(\(quote(json)))") }
    public func deepLink(_ url: URL) { run("__riverCore.deepLink(\(quote(url.absoluteString)))") }

    private func quote(_ s: String) -> String {
        // A JSON string literal is a valid JavaScript string literal.
        let data = try? JSONSerialization.data(withJSONObject: [s], options: [.fragmentsAllowed])
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(text.dropFirst().dropLast())
    }

    private func run(_ js: String) {
        DispatchQueue.main.async {
            guard let web = self.web else { return }
            if !self.ready {
                self.queue.append(js)
                return
            }
            web.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func answer(_ id: Int, value: Any?) {
        let payload = Json.encode(["ok": true, "value": value ?? NSNull()] as [String: Any])
        run("__riverCore.answer(\(id), \(quote(payload)))")
    }

    /// An answer that comes later (a dialog, a sheet): only for the page of the core that asked.
    private func answer(_ id: Int, value: Any?, generation gen: Int) {
        DispatchQueue.main.async {
            guard gen == self.generation else { return }
            self.answer(id, value: value)
        }
    }

    private func answerError(_ id: Int, _ message: String) {
        run("__riverCore.answer(\(id), \(quote(Json.encode(["ok": false, "error": message] as [String: Any]))))")
    }

    // MARK: core → UI and shell

    fileprivate func post(header: String, payload: String) {
        let h = Json.decode(header)
        switch h["t"] as? String {
        case "ready":
            ready = true
            let pending = queue
            queue = []
            for js in pending { web?.evaluateJavaScript(js, completionHandler: nil) }
            NSLog("[River] client core ready")
            #if DEBUG
                // CI's simulator test: report the local storage status once the core is up.
                if ProcessInfo.processInfo.arguments.contains("-RiverSelfTest") {
                    let call = Json.encode(["channel": "river:storage:status", "args": []] as [String: Any])
                    web?.evaluateJavaScript("__riverCore.invoke(-1, \(quote(call)))", completionHandler: nil)
                }
            #endif
        case "reply":
            let id = (h["id"] as? NSNumber)?.intValue ?? 0
            if id == -1 {
                NSLog("[River] self-test storage: %@", payload)
                return
            }
            listener?.coreReply(id: id, payload: payload)
        case "event":
            if payload.hasPrefix("{\"channel\":\"core:fatal\"") {
                let args = Json.decode(payload)["args"] as? [Any]
                fatal(args?.first as? String ?? "unknown error")
            }
            listener?.coreEvent(payload: payload)
        case "ask":
            ask(id: (h["id"] as? NSNumber)?.intValue ?? 0, kind: h["kind"] as? String ?? "", payload: payload)
        case "log":
            NSLog("[River] core: %@", String(payload.prefix(2000)))
        default:
            break
        }
    }

    private func ask(id: Int, kind: String, payload: String) {
        let a = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] ?? [:]
        switch kind {
        case "messageBox":
            messageBox(id: id, a)
        case "openUrl":
            if let s = a["url"] as? String, let url = URL(string: s), ["https", "http"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
            }
            answer(id, value: nil)
        case "clipboard":
            UIPasteboard.general.string = a["text"] as? String ?? ""
            answer(id, value: nil)
        case "saveFile":
            // A private path to write to. Once written, the core asks "exportFile": iOS's "Save
            // to Files" sheet offers it, and that sheet's answer is whether it was saved.
            let name = a["name"] as? String ?? "River file"
            guard let path = native?.files.exportTarget(name: name) else {
                answer(id, value: ["canceled": true] as [String: Any])
                return
            }
            answer(id, value: ["canceled": false, "filePath": path, "export": true] as [String: Any])
        case "exportFile":
            exportFile(id: id, path: a["path"] as? String ?? "")
        case "notify":
            notify(
                id: id, title: a["title"] as? String ?? "River", body: a["body"] as? String ?? "",
                reply: (a["reply"] as? Bool) ?? false, call: (a["call"] as? Bool) ?? false,
                tag: a["tag"] as? String)
        case "notifyClose":
            // An incoming call stopped ringing: its notification goes (2.11.3).
            if let tag = a["tag"] as? String, !tag.isEmpty {
                let center = UNUserNotificationCenter.current()
                center.removeDeliveredNotifications(withIdentifiers: [tag])
                center.removePendingNotificationRequests(withIdentifiers: [tag])
                if let ask = takeNotification(tag) { answer(ask, value: "dismissed") }
            }
            answer(id, value: nil)
        case "callState":
            inCall = (a["active"] as? Bool) == true
            if !inCall { earpiece = false }
            updateProximity()
            answer(id, value: nil)
        case "speaker":
            earpiece = (a["on"] as? Bool) != true
            updateProximity()
            let session = AVAudioSession.sharedInstance()
            let port: AVAudioSession.PortOverride = (a["on"] as? Bool) == true ? .speaker : AVAudioSession.PortOverride.none
            try? session.overrideOutputAudioPort(port)
            answer(id, value: nil)
        case "callAudio":
            // A 1:1 call ended or failed before it was ever on: no loudspeaker left set (2.11.3).
            if !inCall {
                earpiece = false
                updateProximity()
                try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
            }
            answer(id, value: nil)
        case "haptic":
            let kind = (a["kind"] as? String) ?? "tap"
            DispatchQueue.main.async {
                switch kind {
                case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
                case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
                case "select": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
            answer(id, value: nil)
        case "appLock":
            let available = AppLock.shared.setEnabled((a["enabled"] as? Bool) ?? false)
            answer(id, value: ["available": available] as [String: Any])
        default:
            answerError(id, "not available on this phone")
        }
    }

    private func messageBox(id: Int, _ a: [String: Any]) {
        let gen = generation
        let buttons = (a["buttons"] as? [String] ?? ["OK"]).prefix(3)
        let cancelId = (a["cancelId"] as? NSNumber)?.intValue ?? -1
        let detail = a["detail"] as? String ?? ""
        let message = (a["message"] as? String ?? "") + (detail.isEmpty ? "" : "\n\n\(detail)")
        let alert = UIAlertController(title: a["title"] as? String ?? "River", message: message, preferredStyle: .alert)
        for (i, title) in buttons.enumerated() {
            alert.addAction(
                UIAlertAction(title: title, style: i == cancelId ? .cancel : .default) { [weak self] _ in
                    self?.answer(id, value: ["response": i] as [String: Any], generation: gen)
                })
        }
        guard let top = top() else {
            // No screen to ask on: the safe answer is "cancel".
            answer(id, value: ["response": cancelId < 0 ? max(0, buttons.count - 1) : cancelId] as [String: Any])
            return
        }
        top.present(alert, animated: true)
    }

    // MARK: notifications

    private static let replyCategory = "river.reply"
    private static let plainCategory = "river.plain"
    private static let replyAction = "river.reply.text"

    /// Every River notification has a category that reports being swiped away (customDismissAction).
    private static func categories() -> Set<UNNotificationCategory> {
        // Reply from the notification: the text goes to the core, which sends it encrypted.
        let action = UNTextInputNotificationAction(
            identifier: replyAction, title: "Reply", options: [],
            textInputButtonTitle: "Send", textInputPlaceholder: "Reply")
        return [
            UNNotificationCategory(
                identifier: replyCategory, actions: [action], intentIdentifiers: [], options: [.customDismissAction]),
            UNNotificationCategory(
                identifier: plainCategory, actions: [], intentIdentifiers: [], options: [.customDismissAction]),
        ]
    }

    private func notify(id: Int, title: String, body: String, reply: Bool, call: Bool, tag: String? = nil) {
        let gen = generation
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async {
                guard gen == self.generation else { return }
                guard granted else {
                    self.answer(id, value: "denied")
                    return
                }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                content.categoryIdentifier = reply ? CoreHost.replyCategory : CoreHost.plainCategory
                // An incoming call makes a sound; other notifications stay quiet, as on computers.
                if call { content.sound = .default }
                // A named notification (an incoming call's) can be taken away again by its name.
                let identifier = (tag?.isEmpty == false) ? tag! : UUID().uuidString
                if let earlier = self.takeNotification(identifier) {
                    self.answer(earlier, value: "dismissed")
                }
                // Only so many notifications wait for an answer; the oldest stops waiting.
                while self.notificationOrder.count >= CoreHost.maxPendingNotifications {
                    let oldest = self.notificationOrder.removeFirst()
                    if let ask = self.notificationAsks.removeValue(forKey: oldest) {
                        self.answer(ask, value: "dismissed")
                    }
                }
                self.notificationAsks[identifier] = id
                self.notificationOrder.append(identifier)
                center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
            }
        }
    }

    /// The core's ask for a notification, which no longer waits.
    private func takeNotification(_ identifier: String) -> Int? {
        notificationOrder.removeAll { $0 == identifier }
        return notificationAsks.removeValue(forKey: identifier)
    }

    /// A reply that could not be sent (River's core no longer waits for it): say so.
    private func replyFailed() {
        let content = UNMutableNotificationContent()
        content.title = "Reply not sent"
        content.body = "Open River to send it."
        content.categoryIdentifier = CoreHost.plainCategory
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    // MARK: saving files

    private func exportFile(id: Int, path: String) {
        let gen = generation
        guard let files = native?.files, let url = files.takeExport(path: path) else {
            answer(id, value: ["saved": false] as [String: Any])
            return
        }
        guard let top = top() else {
            files.discardExport(url)
            answer(id, value: ["saved": false] as [String: Any])
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        exportPickers[ObjectIdentifier(picker)] = (generation: gen, id: id, url: url)
        top.present(picker, animated: true)
        // Swiped down instead of Cancel: answered as cancelled too.
        picker.presentationController?.delegate = self
    }

    private func exportClosed(_ picker: UIViewController, saved: Bool) {
        guard let e = exportPickers.removeValue(forKey: ObjectIdentifier(picker)) else { return }
        // The plaintext copy in Caches goes as soon as the sheet closes.
        native?.files.discardExport(e.url)
        answer(e.id, value: ["saved": saved] as [String: Any], generation: e.generation)
    }

    private func top() -> UIViewController? {
        var vc = presenter
        while let next = vc?.presentedViewController { vc = next }
        return vc
    }

    private func fatal(_ details: String) {
        NSLog("[River] the client core failed to start: %@", String(details.prefix(2000)))
        DispatchQueue.main.async {
            let alert = UIAlertController(title: "River could not start", message: details, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            self.top()?.present(alert, animated: true)
        }
    }
}

extension CoreHost: UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        exportClosed(controller, saved: !urls.isEmpty)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        exportClosed(controller, saved: false)
    }

    public func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        exportClosed(presentationController.presentedViewController, saved: false)
    }
}

extension CoreHost: WKUIDelegate, WKNavigationDelegate {
    /// RiverNative.call, answered synchronously.
    public func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
    ) {
        guard webView === web, frame.isMainFrame, prompt.hasPrefix(CoreHost.promptPrefix), let native = native else {
            completionHandler(nil)
            return
        }
        let method = String(prompt.dropFirst(CoreHost.promptPrefix.count))
        completionHandler(native.call(method: method, argsJson: defaultText ?? "{}"))
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        NSLog("[River] core page loaded")
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[River] core page failed: %@", error.localizedDescription)
    }

    public func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) {
        NSLog("[River] core page failed to load: %@", error.localizedDescription)
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === web else { return }
        NSLog("[River] the core's web process ended: starting it again")
        restartAfterCrash()
    }

    /// The core never navigates.
    public func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "capacitor" && url?.host == "localhost" ? .allow : .cancel)
    }
}

extension CoreHost: UNUserNotificationCenterDelegate {
    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let identifier = response.notification.request.identifier
        let text = (response as? UNTextInputNotificationResponse)?.userText
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let dismissed = response.actionIdentifier == UNNotificationDismissActionIdentifier
        DispatchQueue.main.async {
            if let id = self.takeNotification(identifier) {
                if dismissed {
                    self.answer(id, value: "dismissed")
                } else if !text.isEmpty {
                    self.answer(id, value: ["reply": String(text.prefix(4000))] as [String: Any])
                } else {
                    self.answer(id, value: "clicked")
                }
            } else if !text.isEmpty {
                // The core that posted it is gone: the reply is not dropped without a word.
                self.replyFailed()
            }
            completionHandler()
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

/// Holds the message handler weakly (WKUserContentController retains it).
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var host: CoreHost?

    init(_ host: CoreHost) { self.host = host }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let parts = message.body as? [String], parts.count == 2 else { return }
        host?.post(header: parts[0], payload: parts[1])
    }
}

/// Serves the client core bundle (RiverNative's "core" resource folder).
private final class CoreFiles: NSObject, WKURLSchemeHandler {
    private let root: URL? = Bundle(for: CoreHost.self).url(forResource: "core", withExtension: nil)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "localhost", url.path.hasPrefix("/core/"), let root = root else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let relative = String(url.path.dropFirst("/core/".count))
        let file = root.appendingPathComponent(relative).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime: String
        switch file.pathExtension {
        case "html": mime = "text/html"
        case "js", "mjs": mime = "text/javascript"
        case "css": mime = "text/css"
        case "wasm": mime = "application/wasm"
        case "json": mime = "application/json"
        default: mime = "application/octet-stream"
        }
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": mime, "Content-Length": String(data.count)])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
