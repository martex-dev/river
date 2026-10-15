import Foundation
import LibSignalClient

/// libsignal for River's client core (the "sig.*" methods of the native
/// contract). Keys and records arrive serialised; session operations run over
/// stores built for the call, which trust every identity (River's trust rules
/// run in JavaScript before anything is stored) and report what libsignal
/// saved, used or asked for. The same design as Android's SignalOps.java.
final class SignalOps {
    private var kems: [Int: KEMKeyPair] = [:]
    private var nextKem = 1

    private struct CallContext: StoreContext {}

    static func failure(_ error: Error) -> NativeFailure? {
        guard let e = error as? SignalError else { return nil }
        let message = String(describing: e)
        switch e {
        case .untrustedIdentity: return NativeFailure(message, code: "UntrustedIdentity")
        case .duplicatedMessage: return NativeFailure(message, code: "DuplicatedMessage")
        case .sessionNotFound, .invalidSession: return NativeFailure(message, code: "InvalidSession")
        case .invalidKeyIdentifier: return NativeFailure(message, code: "InvalidKeyId")
        case .invalidKey: return NativeFailure(message, code: "InvalidKey")
        case .invalidMessage: return NativeFailure(message, code: "InvalidMessage")
        case .verificationFailed: return NativeFailure(message, code: "VerificationFailed")
        default: return NativeFailure(message)
        }
    }

    func call(_ method: String, _ a: [String: Any]) throws -> Any {
        switch method {
        case "sig.keyPair":
            let pair = IdentityKeyPair.generate()
            return ["priv": pair.privateKey.serialize().b64, "pub": pair.publicKey.serialize().b64] as [String: Any]
        case "sig.publicOf":
            return try PrivateKey(try a.bytes("priv")).publicKey.serialize().b64
        case "sig.checkPublic":
            return try PublicKey(try a.bytes("pub")).serialize().b64
        case "sig.checkPrivate":
            return try PrivateKey(try a.bytes("priv")).serialize().b64
        case "sig.sign":
            return try PrivateKey(try a.bytes("priv")).generateSignature(message: try a.bytes("data")).b64
        case "sig.verify":
            guard let key = try? PublicKey(try a.bytes("pub")) else { return false }
            return (try? key.verifySignature(message: try a.bytes("data"), signature: try a.bytes("sig"))) ?? false
        case "sig.kemKeyPair":
            let pair = KEMKeyPair.generate()
            let handle = nextKem
            nextKem += 1
            kems[handle] = pair
            return ["handle": handle, "pub": pair.publicKey.serialize().b64] as [String: Any]
        case "sig.checkKemPublic":
            return try KEMPublicKey(try a.bytes("pub")).serialize().b64
        case "sig.preKeyRecord":
            return try PreKeyRecord(
                id: UInt32(try a.int("id")), publicKey: try PublicKey(try a.bytes("pub")),
                privateKey: try PrivateKey(try a.bytes("priv"))
            ).serialize().b64
        case "sig.signedPreKeyRecord":
            return try SignedPreKeyRecord(
                id: UInt32(try a.int("id")), timestamp: UInt64(try a.int("ts")),
                privateKey: try PrivateKey(try a.bytes("priv")), signature: try a.bytes("sig")
            ).serialize().b64
        case "sig.kyberPreKeyRecord":
            guard let pair = kems.removeValue(forKey: try a.int("handle")) else {
                throw NativeFailure("unknown KEM key pair")
            }
            return try KyberPreKeyRecord(
                id: UInt32(try a.int("id")), timestamp: UInt64(try a.int("ts")), keyPair: pair,
                signature: try a.bytes("sig")
            ).serialize().b64
        case "sig.recordInfo":
            let record = try a.bytes("record")
            switch try a.string("kind") {
            case "prekey":
                let r = try PreKeyRecord(bytes: record)
                return ["id": Int(r.id), "pub": try r.publicKey().serialize().b64, "sig": NSNull()] as [String: Any]
            case "signed":
                let r = try SignedPreKeyRecord(bytes: record)
                return ["id": Int(r.id), "pub": try r.publicKey().serialize().b64, "sig": r.signature.b64] as [String: Any]
            case "kyber":
                let r = try KyberPreKeyRecord(bytes: record)
                return ["id": Int(r.id), "pub": try r.publicKey().serialize().b64, "sig": r.signature.b64] as [String: Any]
            default:
                throw NativeFailure("unknown record kind")
            }
        case "sig.sessionInfo":
            let r = try SessionRecord(bytes: try a.bytes("record"))
            return ["current": r.hasCurrentState, "remoteIdentity": NSNull()] as [String: Any]
        case "sig.fingerprint":
            let fp = try NumericFingerprintGenerator(iterations: try a.int("iterations")).create(
                version: try a.int("version"),
                localIdentifier: try a.bytes("localId"),
                localKey: try PublicKey(try a.bytes("localKey")),
                remoteIdentifier: try a.bytes("remoteId"),
                remoteKey: try PublicKey(try a.bytes("remoteKey")))
            return ["display": fp.displayable.formatted, "scannable": fp.scannable.encoding.b64] as [String: Any]
        case "sig.processBundle":
            let st = try stores(a)
            let w = try a.object("bundle")
            let identity = IdentityKey(publicKey: try PublicKey(try w.bytes("identityKey")))
            let bundle: PreKeyBundle
            if let preKeyId = w.optionalInt("preKeyId"), let preKey = try w.optionalBytes("preKey") {
                bundle = try PreKeyBundle(
                    registrationId: UInt32(try w.int("registrationId")), deviceId: UInt32(try w.int("deviceId")),
                    prekeyId: UInt32(preKeyId), prekey: try PublicKey(preKey),
                    signedPrekeyId: UInt32(try w.int("signedPreKeyId")), signedPrekey: try PublicKey(try w.bytes("signedPreKey")),
                    signedPrekeySignature: try w.bytes("signedPreKeySignature"), identity: identity,
                    kyberPrekeyId: UInt32(try w.int("kyberPreKeyId")), kyberPrekey: try KEMPublicKey(try w.bytes("kyberPreKey")),
                    kyberPrekeySignature: try w.bytes("kyberPreKeySignature"))
            } else {
                bundle = try PreKeyBundle(
                    registrationId: UInt32(try w.int("registrationId")), deviceId: UInt32(try w.int("deviceId")),
                    signedPrekeyId: UInt32(try w.int("signedPreKeyId")), signedPrekey: try PublicKey(try w.bytes("signedPreKey")),
                    signedPrekeySignature: try w.bytes("signedPreKeySignature"), identity: identity,
                    kyberPrekeyId: UInt32(try w.int("kyberPreKeyId")), kyberPrekey: try KEMPublicKey(try w.bytes("kyberPreKey")),
                    kyberPrekeySignature: try w.bytes("kyberPreKeySignature"))
            }
            try processPreKeyBundle(
                bundle, for: try remote(a), ourAddress: try local(a), sessionStore: st, identityStore: st,
                context: CallContext())
            guard let session = st.session else { throw NativeFailure("no session was made") }
            return ["session": session.serialize().b64] as [String: Any]
        case "sig.encrypt":
            let st = try stores(a)
            let msg = try signalEncrypt(
                message: try a.bytes("data"), for: try remote(a), localAddress: try local(a), sessionStore: st,
                identityStore: st, context: CallContext())
            guard let session = st.session, let identity = st.remoteIdentity else { throw NativeFailure("no session") }
            return [
                "type": Int(msg.messageType.rawValue), "body": msg.serialize().b64, "session": session.serialize().b64,
                "remoteIdentity": identity.serialize().b64,
            ] as [String: Any]
        case "sig.decrypt":
            let st = try stores(a)
            let data = try signalDecrypt(
                message: try SignalMessage(bytes: try a.bytes("data")), from: try remote(a), to: try local(a),
                sessionStore: st, identityStore: st, context: CallContext())
            guard let session = st.session, let identity = st.remoteIdentity else { throw NativeFailure("no session") }
            return ["data": data.b64, "session": session.serialize().b64, "remoteIdentity": identity.serialize().b64] as [String: Any]
        case "sig.decryptPreKey":
            let st = try stores(a)
            for case let r as [String: Any] in a.array("records") {
                st.records["\(try r.string("kind")):\(try r.int("id"))"] = try r.bytes("record")
            }
            for case let m as [String: Any] in a.array("missing") {
                st.missing.insert("\(try m.string("kind")):\(try m.int("id"))")
            }
            let data: Data
            do {
                data = try signalDecryptPreKey(
                    message: try PreKeySignalMessage(bytes: try a.bytes("data")), from: try remote(a),
                    localAddress: try local(a), sessionStore: st, identityStore: st, preKeyStore: st,
                    signedPreKeyStore: st, kyberPreKeyStore: st, context: CallContext())
            } catch {
                if let need = st.need { return ["need": need] as [String: Any] }
                throw error
            }
            guard let session = st.session, let identity = st.remoteIdentity else { throw NativeFailure("no session") }
            return [
                "data": data.b64, "session": session.serialize().b64, "remoteIdentity": identity.serialize().b64,
                "usedPreKey": st.usedPreKey.map { Int($0) as Any } ?? NSNull(),
                "usedKyberPreKey": st.usedKyber ?? NSNull(),
            ] as [String: Any]
        default:
            throw NativeFailure("unknown native method \(method)")
        }
    }

    private func remote(_ a: [String: Any]) throws -> ProtocolAddress {
        let r = try a.object("remote")
        return try ProtocolAddress(name: try r.string("name"), deviceId: UInt32(try r.int("deviceId")))
    }

    private func local(_ a: [String: Any]) throws -> ProtocolAddress {
        let l = try a.object("local")
        return try ProtocolAddress(name: try l.string("name"), deviceId: UInt32(try l.int("deviceId")))
    }

    private func stores(_ a: [String: Any]) throws -> CallStores {
        let l = try a.object("local")
        let pair = IdentityKeyPair(
            publicKey: try PublicKey(try l.bytes("pub")), privateKey: try PrivateKey(try l.bytes("priv")))
        let session = try a.optionalBytes("session").map { try SessionRecord(bytes: $0) }
        return CallStores(identity: pair, registrationId: UInt32(try l.int("regId")), session: session)
    }
}

/// One remote session plus our identity, as libsignal sees them during one call.
private final class CallStores: SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore {
    let identity: IdentityKeyPair
    let registrationId: UInt32
    var session: SessionRecord?
    var remoteIdentity: IdentityKey?
    var records: [String: Data] = [:]
    var missing = Set<String>()
    var need: [String: Any]?
    var usedPreKey: UInt32?
    var usedKyber: [String: Any]?

    init(identity: IdentityKeyPair, registrationId: UInt32, session: SessionRecord?) {
        self.identity = identity
        self.registrationId = registrationId
        self.session = session
    }

    private func fetch(_ kind: String, _ id: UInt32) throws -> Data {
        if let r = records["\(kind):\(id)"] { return r }
        if !missing.contains("\(kind):\(id)") { need = ["kind": kind, "id": Int(id)] as [String: Any] }
        throw SignalError.invalidKeyIdentifier("no \(kind) prekey \(id)")
    }

    // SessionStore
    func loadSession(for address: ProtocolAddress, context: StoreContext) throws -> SessionRecord? { session }
    func loadExistingSessions(for addresses: [ProtocolAddress], context: StoreContext) throws -> [SessionRecord] {
        guard let s = session else { throw SignalError.sessionNotFound("no session") }
        return [s]
    }
    func storeSession(_ record: SessionRecord, for address: ProtocolAddress, context: StoreContext) throws {
        session = record
    }

    // IdentityKeyStore
    func identityKeyPair(context: StoreContext) throws -> IdentityKeyPair { identity }
    func localRegistrationId(context: StoreContext) throws -> UInt32 { registrationId }
    func saveIdentity(_ identity: IdentityKey, for address: ProtocolAddress, context: StoreContext) throws -> IdentityChange {
        remoteIdentity = identity
        return .newOrUnchanged
    }
    func isTrustedIdentity(
        _ identity: IdentityKey, for address: ProtocolAddress, direction: Direction, context: StoreContext
    ) throws -> Bool {
        remoteIdentity = identity
        return true
    }
    func identity(for address: ProtocolAddress, context: StoreContext) throws -> IdentityKey? { remoteIdentity }

    // PreKeyStore
    func loadPreKey(id: UInt32, context: StoreContext) throws -> PreKeyRecord {
        try PreKeyRecord(bytes: try fetch("prekey", id))
    }
    func storePreKey(_ record: PreKeyRecord, id: UInt32, context: StoreContext) throws {}
    func removePreKey(id: UInt32, context: StoreContext) throws { usedPreKey = id }

    // SignedPreKeyStore
    func loadSignedPreKey(id: UInt32, context: StoreContext) throws -> SignedPreKeyRecord {
        try SignedPreKeyRecord(bytes: try fetch("signed", id))
    }
    func storeSignedPreKey(_ record: SignedPreKeyRecord, id: UInt32, context: StoreContext) throws {}

    // KyberPreKeyStore
    func loadKyberPreKey(id: UInt32, context: StoreContext) throws -> KyberPreKeyRecord {
        try KyberPreKeyRecord(bytes: try fetch("kyber", id))
    }
    func storeKyberPreKey(_ record: KyberPreKeyRecord, id: UInt32, context: StoreContext) throws {}
    func markKyberPreKeyUsed(id: UInt32, signedPreKeyId: UInt32, baseKey: PublicKey, context: StoreContext) throws {
        usedKyber = ["id": Int(id), "signedPreKeyId": Int(signedPreKeyId), "baseKey": baseKey.serialize().b64] as [String: Any]
    }
}
