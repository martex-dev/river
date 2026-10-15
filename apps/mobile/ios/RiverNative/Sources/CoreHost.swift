import Foundation
import UIKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

/// Where the core's replies and events go (the UI's plugin).
public protocol CoreListener: AnyObject {
    func coreReply(id: Int, payload: String)
    func coreEvent(payload: String)
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

    private static let promptPrefix = "river-native:"
    private var web: WKWebView?
    private var native: RiverNativeInterface?
    private var ready = false
    private var queue: [String] = []
    private var notificationAsks: [String: Int] = [:]
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
        native?.files.onExported = { [weak self] url in
            DispatchQueue.main.async { self?.export(url) }
        }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        // The core is served at capacitor://localhost/core/: an origin River's servers already allow.
        config.setURLSchemeHandler(CoreFiles(), forURLScheme: "capacitor")
        let bridge = """
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
        view.load(URLRequest(url: URL(string: "capacitor://localhost/core/index.html")!))
        UNUserNotificationCenter.current().delegate = self
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }

    @objc private func foreground() { run("__riverCore.lifecycle('foreground')") }
    @objc private func background() { run("__riverCore.lifecycle('background')") }

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
            let name = a["name"] as? String ?? "River file"
            guard let path = native?.files.exportTarget(name: name) else {
                answer(id, value: ["canceled": true] as [String: Any])
                return
            }
            answer(id, value: ["canceled": false, "filePath": path] as [String: Any])
        case "notify":
            notify(
                id: id, title: a["title"] as? String ?? "River", body: a["body"] as? String ?? "",
                reply: (a["reply"] as? Bool) ?? false)
        case "appLock":
            let available = AppLock.shared.setEnabled((a["enabled"] as? Bool) ?? false)
            answer(id, value: ["available": available] as [String: Any])
        default:
            answerError(id, "not available on this phone")
        }
    }

    private func messageBox(id: Int, _ a: [String: Any]) {
        let buttons = (a["buttons"] as? [String] ?? ["OK"]).prefix(3)
        let cancelId = (a["cancelId"] as? NSNumber)?.intValue ?? -1
        let detail = a["detail"] as? String ?? ""
        let message = (a["message"] as? String ?? "") + (detail.isEmpty ? "" : "\n\n\(detail)")
        let alert = UIAlertController(title: a["title"] as? String ?? "River", message: message, preferredStyle: .alert)
        for (i, title) in buttons.enumerated() {
            alert.addAction(
                UIAlertAction(title: title, style: i == cancelId ? .cancel : .default) { [weak self] _ in
                    self?.answer(id, value: ["response": i] as [String: Any])
                })
        }
        top()?.present(alert, animated: true)
    }

    private static let replyCategory = "river.reply"
    private static let replyAction = "river.reply.text"

    private func notify(id: Int, title: String, body: String, reply: Bool) {
        let center = UNUserNotificationCenter.current()
        if reply {
            // Reply from the notification: the text goes to the core, which sends it encrypted.
            let action = UNTextInputNotificationAction(
                identifier: CoreHost.replyAction, title: "Reply", options: [],
                textInputButtonTitle: "Send", textInputPlaceholder: "Reply")
            center.setNotificationCategories([
                UNNotificationCategory(
                    identifier: CoreHost.replyCategory, actions: [action], intentIdentifiers: [], options: [])
            ])
        }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else {
                self.answer(id, value: "denied")
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            if reply { content.categoryIdentifier = CoreHost.replyCategory }
            let identifier = UUID().uuidString
            DispatchQueue.main.async { self.notificationAsks[identifier] = id }
            center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
        }
    }

    private func export(_ url: URL) {
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        top()?.present(picker, animated: true)
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
        NSLog("[River] the core's web process ended")
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
        if let id = notificationAsks.removeValue(forKey: response.notification.request.identifier) {
            if let text = (response as? UNTextInputNotificationResponse)?.userText
                .trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty
            {
                answer(id, value: ["reply": String(text.prefix(4000))] as [String: Any])
            } else {
                answer(id, value: "clicked")
            }
        }
        completionHandler()
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
