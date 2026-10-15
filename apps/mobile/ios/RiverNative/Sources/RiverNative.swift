import Foundation

/// The native interface of River's client core (apps/mobile/core/native.ts):
/// `RiverNative.call(method, argsJson) → {"v": value} | {"e": message, "code"}`.
/// Answered synchronously for the core's own WebView only (see CoreHost).
final class RiverNativeInterface {
    private let crypto = CryptoOps()
    private let signal = SignalOps()
    private let keychain = KeychainOps()
    private let db = DbOps()
    let files: FileOps

    init() throws {
        files = try FileOps()
    }

    func call(method: String, argsJson: String) -> String {
        do {
            let parsed = try JSONSerialization.jsonObject(with: Data(argsJson.utf8), options: [.fragmentsAllowed])
            let args = parsed as? [String: Any] ?? [:]
            let value: Any
            if method.hasPrefix("sig.") {
                value = try signal.call(method, args)
            } else if method.hasPrefix("fs.") {
                value = try files.call(method, args)
            } else if method.hasPrefix("db.") {
                value = try db.call(method, args)
            } else if method.hasPrefix("keystore.") {
                value = try keychain.call(method, args)
            } else {
                value = try crypto.call(method, args)
            }
            return Json.encode(["v": value] as [String: Any])
        } catch {
            let failure = NativeFailure.from(error)
            // Never log arguments: they carry keys and message contents.
            NSLog("[River] native %@ failed: %@", method, failure.code ?? "error")
            var out: [String: Any] = ["e": failure.message] as [String: Any]
            if let code = failure.code { out["code"] = code }
            return Json.encode(out)
        }
    }
}

/// A failure reported to JavaScript; `code` mirrors libsignal / errno names.
struct NativeFailure: Error {
    let message: String
    let code: String?

    init(_ message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }

    static func from(_ error: Error) -> NativeFailure {
        if let f = error as? NativeFailure { return f }
        if let signal = SignalOps.failure(error) { return signal }
        return NativeFailure(String(describing: error))
    }
}

enum Json {
    static func encode(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else { return "{\"e\":\"result could not be encoded\"}" }
        return text
    }

    static func decode(_ text: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
    }
}

/// Argument helpers: bytes travel as standard base64.
extension Dictionary where Key == String, Value == Any {
    func string(_ key: String) throws -> String {
        guard let v = self[key] as? String else { throw NativeFailure("missing \(key)") }
        return v
    }

    func bytes(_ key: String) throws -> Data {
        guard let v = self[key] as? String, let d = Data(base64Encoded: v) else {
            throw NativeFailure("missing or bad bytes: \(key)")
        }
        return d
    }

    func optionalBytes(_ key: String) throws -> Data? {
        if self[key] == nil || self[key] is NSNull { return nil }
        return try bytes(key)
    }

    func int(_ key: String) throws -> Int {
        if let n = self[key] as? NSNumber { return n.intValue }
        throw NativeFailure("missing \(key)")
    }

    func optionalInt(_ key: String) -> Int? {
        (self[key] as? NSNumber)?.intValue
    }

    func bool(_ key: String) -> Bool {
        (self[key] as? NSNumber)?.boolValue ?? false
    }

    func object(_ key: String) throws -> [String: Any] {
        guard let v = self[key] as? [String: Any] else { throw NativeFailure("missing \(key)") }
        return v
    }

    func array(_ key: String) -> [Any] {
        self[key] as? [Any] ?? []
    }
}

extension Data {
    var b64: String { base64EncodedString() }
}
