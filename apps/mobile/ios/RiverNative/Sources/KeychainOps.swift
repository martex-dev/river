import CryptoKit
import Foundation
import Security

/// The iOS Keychain protects the key of River's local database, as DPAPI or the
/// Android Keystore do elsewhere. A random 256-bit wrapping key lives in the
/// Keychain (this device only, after first unlock, never synced to iCloud) and
/// wraps the database key with AES-GCM.
final class KeychainOps {
    private let service = "io.github.martexdev.river"
    private let account = "database-key-wrap"
    private let aad = Data("river-db-key-wrap-v1".utf8)

    private func wrappingKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let found = SecItemCopyMatching(query as CFDictionary, &item)
        if found == errSecSuccess, let data = item as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard found == errSecItemNotFound else { throw NativeFailure("Keychain unavailable (\(found))") }
        var key = Data(count: 32)
        let status = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess else { throw NativeFailure("no randomness") }
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: key,
        ]
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw NativeFailure("Keychain unavailable (\(added))") }
        return SymmetricKey(data: key)
    }

    func call(_ method: String, _ a: [String: Any]) throws -> Any {
        switch method {
        case "keystore.usable":
            return (try? wrappingKey()) != nil
        case "keystore.name":
            return "iOS Keychain"
        case "keystore.wrap":
            let box = try AES.GCM.seal(try a.bytes("data"), using: try wrappingKey(), authenticating: aad)
            guard let combined = box.combined else { throw NativeFailure("wrap failed") }
            return combined.b64
        case "keystore.unwrap":
            let box = try AES.GCM.SealedBox(combined: try a.bytes("data"))
            return try AES.GCM.open(box, using: try wrappingKey(), authenticating: aad).b64
        default:
            throw NativeFailure("unknown native method \(method)")
        }
    }
}
