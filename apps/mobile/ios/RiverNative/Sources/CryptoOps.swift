import CommonCrypto
import CryptoKit
import Foundation
import Security

/// Platform cryptography for the client core: CryptoKit (AES-GCM, HMAC-SHA256,
/// SHA-256/512, HKDF), CommonCrypto (AES-CBC), Apple's zlib deflate for gzip.
/// The same algorithms and byte layouts as Node's crypto on the desktop.
final class CryptoOps {
    func call(_ method: String, _ a: [String: Any]) throws -> Any {
        switch method {
        case "random":
            let n = try a.int("n")
            if n == 0 { return "" }
            var out = Data(count: n)
            let status = out.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!) }
            guard status == errSecSuccess else { throw NativeFailure("no randomness") }
            return out.b64
        case "digest":
            let data = try a.bytes("data")
            switch try a.string("alg") {
            case "sha256": return Data(SHA256.hash(data: data)).b64
            case "sha512": return Data(SHA512.hash(data: data)).b64
            default: throw NativeFailure("digest not supported")
            }
        case "hmac":
            guard try a.string("alg") == "sha256" else { throw NativeFailure("hash not supported") }
            var key = try a.bytes("key")
            // HMAC pads keys with zeros: an empty key and one zero byte are the same key.
            if key.isEmpty { key = Data([0]) }
            let mac = HMAC<SHA256>.authenticationCode(for: try a.bytes("data"), using: SymmetricKey(data: key))
            return Data(mac).b64
        case "hkdf":
            guard try a.string("alg") == "sha256" else { throw NativeFailure("hash not supported") }
            let key = HKDF<SHA256>.deriveKey(
                inputKeyMaterial: SymmetricKey(data: try a.bytes("ikm")),
                salt: try a.bytes("salt"),
                info: try a.bytes("info"),
                outputByteCount: try a.int("length"))
            return key.withUnsafeBytes { Data($0) }.b64
        case "aesGcmSeal":
            let box = try AES.GCM.seal(
                try a.bytes("data"),
                using: SymmetricKey(data: try a.bytes("key")),
                nonce: try AES.GCM.Nonce(data: try a.bytes("iv")),
                authenticating: try a.bytes("aad"))
            return (box.ciphertext + box.tag).b64
        case "aesGcmOpen":
            let data = try a.bytes("data")
            guard data.count >= 16 else { throw NativeFailure("authentication failed", code: "auth") }
            do {
                let box = try AES.GCM.SealedBox(
                    nonce: try AES.GCM.Nonce(data: try a.bytes("iv")),
                    ciphertext: data.prefix(data.count - 16),
                    tag: data.suffix(16))
                return try AES.GCM.open(box, using: SymmetricKey(data: try a.bytes("key")), authenticating: try a.bytes("aad")).b64
            } catch {
                throw NativeFailure("authentication failed", code: "auth")
            }
        case "aesCbc":
            return try aesCbc(encrypt: a.bool("encrypt"), key: try a.bytes("key"), iv: try a.bytes("iv"), data: try a.bytes("data")).b64
        case "gzip":
            return try Gzip.compress(try a.bytes("data")).b64
        case "gunzip":
            return try Gzip.decompress(try a.bytes("data"), max: try a.int("max")).b64
        default:
            throw NativeFailure("unknown native method \(method)")
        }
    }

    private func aesCbc(encrypt: Bool, key: Data, iv: Data, data: Data) throws -> Data {
        guard key.count == 32, iv.count == 16 else { throw NativeFailure("bad key or IV") }
        var out = Data(count: data.count + kCCBlockSizeAES128)
        var moved = 0
        let outCount = out.count
        let status = out.withUnsafeMutableBytes { o in
            data.withUnsafeBytes { d in
                key.withUnsafeBytes { k in
                    iv.withUnsafeBytes { v in
                        CCCrypt(
                            CCOperation(encrypt ? kCCEncrypt : kCCDecrypt), CCAlgorithm(kCCAlgorithmAES),
                            CCOptions(kCCOptionPKCS7Padding), k.baseAddress, key.count, v.baseAddress,
                            d.baseAddress, data.count, o.baseAddress, outCount, &moved)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw NativeFailure("AES-CBC failed") }
        return out.prefix(moved)
    }
}

/// gzip (RFC 1952) around Apple's raw deflate, for River's encrypted backups.
enum Gzip {
    private static let table: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    private static func le32(_ v: UInt32) -> Data {
        Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)])
    }

    static func compress(_ data: Data) throws -> Data {
        guard let deflated = try? (data as NSData).compressed(using: .zlib) as Data else {
            throw NativeFailure("compression failed")
        }
        var out = Data([0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xFF])
        out.append(deflated)
        out.append(le32(crc32(data)))
        out.append(le32(UInt32(truncatingIfNeeded: data.count)))
        return out
    }

    static func decompress(_ data: Data, max: Int) throws -> Data {
        let bytes = [UInt8](data)
        guard bytes.count >= 18, bytes[0] == 0x1F, bytes[1] == 0x8B, bytes[2] == 0x08 else {
            throw NativeFailure("not gzip data")
        }
        let flags = bytes[3]
        var i = 10
        if flags & 0x04 != 0 {
            guard i + 2 <= bytes.count else { throw NativeFailure("bad gzip header") }
            i += 2 + Int(bytes[i]) + Int(bytes[i + 1]) << 8
        }
        if flags & 0x08 != 0 { while i < bytes.count && bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 0x10 != 0 { while i < bytes.count && bytes[i] != 0 { i += 1 }; i += 1 }
        if flags & 0x02 != 0 { i += 2 }
        guard i < bytes.count - 8 else { throw NativeFailure("bad gzip header") }
        let body = Data(bytes[i..<(bytes.count - 8)])
        guard let inflated = try? (body as NSData).decompressed(using: .zlib) as Data else {
            throw NativeFailure("decompression failed")
        }
        guard inflated.count <= max else { throw NativeFailure("decompressed data is too large", code: "too_large") }
        let tail = bytes.suffix(8).map { UInt32($0) }
        let crc = tail[0] | tail[1] << 8 | tail[2] << 16 | tail[3] << 24
        guard crc == crc32(inflated) else { throw NativeFailure("gzip checksum mismatch") }
        return inflated
    }
}
