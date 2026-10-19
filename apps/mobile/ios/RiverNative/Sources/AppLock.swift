import LocalAuthentication
import UIKit

/// Settings → System → Lock River: River asks for Face ID, Touch ID or the
/// passcode whenever it comes back to the front. A cover hides River until
/// then (also in the app switcher). The setting is kept in UserDefaults so the
/// lock applies before the client core has started.
final class AppLock {
    static let shared = AppLock()
    private let key = "river.appLock"
    private var cover: UIView?
    private var unlocked = false
    private var prompting = false
    weak var host: UIViewController?

    var enabled: Bool { UserDefaults.standard.bool(forKey: key) }

    var available: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Returns whether the phone can do it (a passcode is set).
    func setEnabled(_ on: Bool) -> Bool {
        let can = available
        let was = enabled
        UserDefaults.standard.set(on && can, forKey: key)
        if !on || !can {
            unlocked = true
            hide()
        } else if !was {
            // Switched on just now, by someone using River: no need to ask straight away.
            unlocked = true
        }
        return can
    }

    func start(in controller: UIViewController) {
        host = controller
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(resign), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(active), name: UIApplication.didBecomeActiveNotification, object: nil)
        if enabled {
            show()
            prompt()
        }
    }

    @objc private func resign() {
        if enabled && !prompting { show() }
    }

    @objc private func background() {
        if enabled { unlocked = false }
    }

    @objc private func active() {
        guard enabled else { return }
        if unlocked {
            hide()
        } else {
            show()
            prompt()
        }
    }

    private func prompt() {
        guard !prompting else { return }
        prompting = true
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: NSLocalizedString("Unlock River", comment: "Face ID / passcode prompt")) { ok, _ in
            DispatchQueue.main.async {
                self.prompting = false
                if ok {
                    self.unlocked = true
                    self.hide()
                }
            }
        }
    }

    private func show() {
        guard cover == nil, let view = host?.view else { return }
        let box = UIView(frame: view.bounds)
        box.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        box.backgroundColor = UIColor(red: 0x0B / 255, green: 0x12 / 255, blue: 0x22 / 255, alpha: 1)
        let button = UIButton(type: .system)
        button.setTitle(NSLocalizedString("Unlock River", comment: "Lock screen button"), for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .title3)
        button.addTarget(self, action: #selector(tap), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(button)
        NSLayoutConstraint.activate([
            button.centerXAnchor.constraint(equalTo: box.centerXAnchor),
            button.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        ])
        // Covered is not enough (2.18): VoiceOver reads only the cover (not River's interface
        // under it), and a keyboard no longer types into a focused message box.
        box.accessibilityViewIsModal = true
        view.endEditing(true)
        view.addSubview(box)
        cover = box
        UIAccessibility.post(notification: .screenChanged, argument: button)
    }

    @objc private func tap() { prompt() }

    private func hide() {
        cover?.removeFromSuperview()
        cover = nil
    }
}
