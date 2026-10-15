package io.github.martexdev.river.core;

import android.util.Base64;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.signal.libsignal.protocol.DuplicateMessageException;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.IdentityKeyPair;
import org.signal.libsignal.protocol.InvalidKeyException;
import org.signal.libsignal.protocol.InvalidKeyIdException;
import org.signal.libsignal.protocol.InvalidMessageException;
import org.signal.libsignal.protocol.NoSessionException;
import org.signal.libsignal.protocol.SessionBuilder;
import org.signal.libsignal.protocol.SessionCipher;
import org.signal.libsignal.protocol.SignalProtocolAddress;
import org.signal.libsignal.protocol.UntrustedIdentityException;
import org.signal.libsignal.protocol.ecc.ECKeyPair;
import org.signal.libsignal.protocol.ecc.ECPrivateKey;
import org.signal.libsignal.protocol.ecc.ECPublicKey;
import org.signal.libsignal.protocol.fingerprint.Fingerprint;
import org.signal.libsignal.protocol.fingerprint.NumericFingerprintGenerator;
import org.signal.libsignal.protocol.kem.KEMKeyPair;
import org.signal.libsignal.protocol.kem.KEMKeyType;
import org.signal.libsignal.protocol.kem.KEMPublicKey;
import org.signal.libsignal.protocol.message.CiphertextMessage;
import org.signal.libsignal.protocol.message.PreKeySignalMessage;
import org.signal.libsignal.protocol.message.SignalMessage;
import org.signal.libsignal.protocol.state.IdentityKeyStore;
import org.signal.libsignal.protocol.state.KyberPreKeyRecord;
import org.signal.libsignal.protocol.state.KyberPreKeyStore;
import org.signal.libsignal.protocol.state.PreKeyBundle;
import org.signal.libsignal.protocol.state.PreKeyRecord;
import org.signal.libsignal.protocol.state.PreKeyStore;
import org.signal.libsignal.protocol.state.SessionRecord;
import org.signal.libsignal.protocol.state.SessionStore;
import org.signal.libsignal.protocol.state.SignedPreKeyRecord;
import org.signal.libsignal.protocol.state.SignedPreKeyStore;

/**
 * libsignal for River's client core (the "sig.*" methods of the native contract,
 * apps/mobile/core/native.ts). Keys and records arrive serialised; session
 * operations run over stores built for the call, which trust every identity
 * (River's trust rules run in JavaScript before anything is stored) and report
 * what libsignal saved, used or asked for.
 */
final class SignalOps {
  private final Map<Integer, KEMKeyPair> kems = new HashMap<>();
  private int nextKem = 1;

  static byte[] b(String s) {
    return Base64.decode(s, Base64.NO_WRAP);
  }

  static String s(byte[] bytes) {
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  /** A failure with a code the JavaScript side maps to libsignal's error codes. */
  static final class Failure extends Exception {
    final String code;

    Failure(String message, String code) {
      super(message);
      this.code = code;
    }
  }

  Object call(String method, JSONObject a) throws Exception {
    switch (method) {
      case "sig.keyPair":
        {
          ECKeyPair pair = ECKeyPair.generate();
          return new JSONObject()
              .put("priv", s(pair.getPrivateKey().serialize()))
              .put("pub", s(pair.getPublicKey().serialize()));
        }
      case "sig.publicOf":
        return s(new ECPrivateKey(b(a.getString("priv"))).publicKey().serialize());
      case "sig.checkPublic":
        return s(new ECPublicKey(b(a.getString("pub"))).serialize());
      case "sig.checkPrivate":
        return s(new ECPrivateKey(b(a.getString("priv"))).serialize());
      case "sig.sign":
        return s(new ECPrivateKey(b(a.getString("priv"))).calculateSignature(b(a.getString("data"))));
      case "sig.verify":
        try {
          return new ECPublicKey(b(a.getString("pub")))
              .verifySignature(b(a.getString("data")), b(a.getString("sig")));
        } catch (InvalidKeyException e) {
          return false;
        }
      case "sig.seal":
        return s(new ECPublicKey(b(a.getString("pub"))).seal(b(a.getString("data")), b(a.getString("info")), b(a.getString("aad"))));
      case "sig.open":
        return s(new ECPrivateKey(b(a.getString("priv"))).open(b(a.getString("data")), b(a.getString("info")), b(a.getString("aad"))));
      case "sig.kemKeyPair":
        {
          KEMKeyPair pair = KEMKeyPair.generate(KEMKeyType.KYBER_1024);
          int handle = nextKem++;
          kems.put(handle, pair);
          return new JSONObject().put("handle", handle).put("pub", s(pair.getPublicKey().serialize()));
        }
      case "sig.checkKemPublic":
        return s(new KEMPublicKey(b(a.getString("pub"))).serialize());
      case "sig.preKeyRecord":
        return s(
            new PreKeyRecord(
                    a.getInt("id"),
                    new ECKeyPair(
                        new ECPublicKey(b(a.getString("pub"))), new ECPrivateKey(b(a.getString("priv")))))
                .serialize());
      case "sig.signedPreKeyRecord":
        return s(
            new SignedPreKeyRecord(
                    a.getInt("id"),
                    a.getLong("ts"),
                    new ECKeyPair(
                        new ECPublicKey(b(a.getString("pub"))), new ECPrivateKey(b(a.getString("priv")))),
                    b(a.getString("sig")))
                .serialize());
      case "sig.kyberPreKeyRecord":
        {
          KEMKeyPair pair = kems.remove(a.getInt("handle"));
          if (pair == null) throw new Failure("unknown KEM key pair", null);
          return s(new KyberPreKeyRecord(a.getInt("id"), a.getLong("ts"), pair, b(a.getString("sig"))).serialize());
        }
      case "sig.recordInfo":
        return recordInfo(a.getString("kind"), b(a.getString("record")));
      case "sig.sessionInfo":
        {
          SessionRecord record = new SessionRecord(b(a.getString("record")));
          Object remote = JSONObject.NULL;
          try {
            remote = s(record.getRemoteIdentityKey().serialize());
          } catch (NoSessionException | RuntimeException e) {
            // no current session
          }
          return new JSONObject().put("current", record.hasSenderChain(Instant.now())).put("remoteIdentity", remote);
        }
      case "sig.fingerprint":
        {
          Fingerprint fp =
              new NumericFingerprintGenerator(a.getInt("iterations"))
                  .createFor(
                      a.getInt("version"),
                      b(a.getString("localId")),
                      new IdentityKey(b(a.getString("localKey"))),
                      b(a.getString("remoteId")),
                      new IdentityKey(b(a.getString("remoteKey"))));
          return new JSONObject()
              .put("display", fp.getDisplayableFingerprint().getDisplayText())
              .put("scannable", s(fp.getScannableFingerprint().getSerialized()));
        }
      case "sig.processBundle":
        return processBundle(a);
      case "sig.encrypt":
        return encrypt(a);
      case "sig.decrypt":
        return decrypt(a);
      case "sig.decryptPreKey":
        return decryptPreKey(a);
      default:
        throw new Failure("unknown native method " + method, null);
    }
  }

  private static JSONObject recordInfo(String kind, byte[] record) throws Exception {
    JSONObject out = new JSONObject();
    switch (kind) {
      case "prekey":
        {
          PreKeyRecord r = new PreKeyRecord(record);
          return out.put("id", r.getId()).put("pub", s(r.getKeyPair().getPublicKey().serialize())).put("sig", JSONObject.NULL);
        }
      case "signed":
        {
          SignedPreKeyRecord r = new SignedPreKeyRecord(record);
          return out.put("id", r.getId())
              .put("pub", s(r.getKeyPair().getPublicKey().serialize()))
              .put("sig", s(r.getSignature()));
        }
      case "kyber":
        {
          KyberPreKeyRecord r = new KyberPreKeyRecord(record);
          return out.put("id", r.getId())
              .put("pub", s(r.getKeyPair().getPublicKey().serialize()))
              .put("sig", s(r.getSignature()));
        }
      default:
        throw new Failure("unknown record kind " + kind, null);
    }
  }

  private static SignalProtocolAddress remote(JSONObject a) throws JSONException {
    JSONObject r = a.getJSONObject("remote");
    return new SignalProtocolAddress(r.getString("name"), r.getInt("deviceId"));
  }

  private static SignalProtocolAddress local(JSONObject a) throws JSONException {
    JSONObject l = a.getJSONObject("local");
    return new SignalProtocolAddress(l.getString("name"), l.getInt("deviceId"));
  }

  private static CallStores stores(JSONObject a) throws Exception {
    JSONObject l = a.getJSONObject("local");
    IdentityKeyPair identity =
        new IdentityKeyPair(new IdentityKey(b(l.getString("pub"))), new ECPrivateKey(b(l.getString("priv"))));
    SessionRecord session = a.isNull("session") ? null : new SessionRecord(b(a.getString("session")));
    return new CallStores(identity, l.getInt("regId"), session);
  }

  private static Object processBundle(JSONObject a) throws Exception {
    CallStores st = stores(a);
    JSONObject w = a.getJSONObject("bundle");
    PreKeyBundle bundle =
        new PreKeyBundle(
            w.getInt("registrationId"),
            w.getInt("deviceId"),
            w.isNull("preKeyId") ? PreKeyBundle.NULL_PRE_KEY_ID : w.getInt("preKeyId"),
            w.isNull("preKey") ? null : new ECPublicKey(b(w.getString("preKey"))),
            w.getInt("signedPreKeyId"),
            new ECPublicKey(b(w.getString("signedPreKey"))),
            b(w.getString("signedPreKeySignature")),
            new IdentityKey(b(w.getString("identityKey"))),
            w.getInt("kyberPreKeyId"),
            new KEMPublicKey(b(w.getString("kyberPreKey"))),
            b(w.getString("kyberPreKeySignature")));
    new SessionBuilder(st, st, st, st, remote(a), local(a)).process(bundle);
    return new JSONObject().put("session", s(st.session.serialize()));
  }

  private static Object encrypt(JSONObject a) throws Exception {
    CallStores st = stores(a);
    CiphertextMessage msg =
        new SessionCipher(st, st, st, st, st, local(a), remote(a)).encrypt(b(a.getString("data")));
    return new JSONObject()
        .put("type", msg.getType())
        .put("body", s(msg.serialize()))
        .put("session", s(st.session.serialize()))
        .put("remoteIdentity", s(st.remoteIdentity.serialize()));
  }

  private static Object decrypt(JSONObject a) throws Exception {
    CallStores st = stores(a);
    byte[] data =
        new SessionCipher(st, st, st, st, st, local(a), remote(a)).decrypt(new SignalMessage(b(a.getString("data"))));
    return new JSONObject()
        .put("data", s(data))
        .put("session", s(st.session.serialize()))
        .put("remoteIdentity", s(st.remoteIdentity.serialize()));
  }

  private static Object decryptPreKey(JSONObject a) throws Exception {
    CallStores st = stores(a);
    JSONArray records = a.getJSONArray("records");
    for (int i = 0; i < records.length(); i++) {
      JSONObject r = records.getJSONObject(i);
      st.records.put(r.getString("kind") + ":" + r.getInt("id"), b(r.getString("record")));
    }
    JSONArray missing = a.getJSONArray("missing");
    for (int i = 0; i < missing.length(); i++) {
      JSONObject m = missing.getJSONObject(i);
      st.missing.add(m.getString("kind") + ":" + m.getInt("id"));
    }
    byte[] data;
    try {
      data =
          new SessionCipher(st, st, st, st, st, local(a), remote(a))
              .decrypt(new PreKeySignalMessage(b(a.getString("data"))));
    } catch (InvalidKeyIdException | InvalidMessageException | RuntimeException e) {
      if (st.need != null) return new JSONObject().put("need", st.need);
      throw e;
    }
    JSONObject out =
        new JSONObject()
            .put("data", s(data))
            .put("session", s(st.session.serialize()))
            .put("remoteIdentity", s(st.remoteIdentity.serialize()))
            .put("usedPreKey", st.usedPreKey == null ? JSONObject.NULL : st.usedPreKey)
            .put("usedKyberPreKey", st.usedKyber == null ? JSONObject.NULL : st.usedKyber);
    return out;
  }

  /** Maps libsignal exceptions to the contract's error codes. */
  static String codeOf(Throwable e) {
    if (e instanceof Failure) return ((Failure) e).code;
    if (e instanceof UntrustedIdentityException) return "UntrustedIdentity";
    if (e instanceof DuplicateMessageException) return "DuplicatedMessage";
    if (e instanceof NoSessionException) return "InvalidSession";
    if (e instanceof InvalidKeyIdException) return "InvalidKeyId";
    if (e instanceof InvalidKeyException) return "InvalidKey";
    if (e instanceof InvalidMessageException) return "InvalidMessage";
    return null;
  }

  /**
   * One remote session and our identity, as libsignal sees them during a single
   * call. Trust is decided by River in JavaScript; this store records the
   * identity libsignal saw so the caller can check it before storing anything.
   */
  private static final class CallStores
      implements SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore {
    private final IdentityKeyPair identity;
    private final int registrationId;
    SessionRecord session;
    IdentityKey remoteIdentity;
    final Map<String, byte[]> records = new HashMap<>();
    final Set<String> missing = new HashSet<>();
    JSONObject need;
    Integer usedPreKey;
    JSONObject usedKyber;

    CallStores(IdentityKeyPair identity, int registrationId, SessionRecord session) {
      this.identity = identity;
      this.registrationId = registrationId;
      this.session = session;
    }

    private byte[] fetch(String kind, int id) throws InvalidKeyIdException {
      byte[] r = records.get(kind + ":" + id);
      if (r != null) return r;
      if (!missing.contains(kind + ":" + id)) {
        try {
          need = new JSONObject().put("kind", kind).put("id", id);
        } catch (JSONException e) {
          throw new IllegalStateException(e);
        }
      }
      throw new InvalidKeyIdException("no " + kind + " prekey " + id);
    }

    // SessionStore
    @Override
    public SessionRecord loadSession(SignalProtocolAddress address) {
      return session == null ? null : session;
    }

    @Override
    public List<SessionRecord> loadExistingSessions(List<SignalProtocolAddress> addresses) throws NoSessionException {
      List<SessionRecord> out = new ArrayList<>();
      if (session == null) throw new NoSessionException("no session");
      out.add(session);
      return out;
    }

    @Override
    public List<Integer> getSubDeviceSessions(String name) {
      return new ArrayList<>();
    }

    @Override
    public void storeSession(SignalProtocolAddress address, SessionRecord record) {
      session = record;
    }

    @Override
    public boolean containsSession(SignalProtocolAddress address) {
      return session != null;
    }

    @Override
    public void deleteSession(SignalProtocolAddress address) {
      session = null;
    }

    @Override
    public void deleteAllSessions(String name) {
      session = null;
    }

    // IdentityKeyStore
    @Override
    public IdentityKeyPair getIdentityKeyPair() {
      return identity;
    }

    @Override
    public int getLocalRegistrationId() {
      return registrationId;
    }

    @Override
    public IdentityChange saveIdentity(SignalProtocolAddress address, IdentityKey identityKey) {
      remoteIdentity = identityKey;
      return IdentityChange.NEW_OR_UNCHANGED;
    }

    @Override
    public boolean isTrustedIdentity(SignalProtocolAddress address, IdentityKey identityKey, Direction direction) {
      remoteIdentity = identityKey;
      return true;
    }

    @Override
    public IdentityKey getIdentity(SignalProtocolAddress address) {
      return remoteIdentity;
    }

    // PreKeyStore
    @Override
    public PreKeyRecord loadPreKey(int preKeyId) throws InvalidKeyIdException {
      try {
        return new PreKeyRecord(fetch("prekey", preKeyId));
      } catch (InvalidMessageException e) {
        throw new InvalidKeyIdException(e);
      }
    }

    @Override
    public void storePreKey(int preKeyId, PreKeyRecord record) {}

    @Override
    public boolean containsPreKey(int preKeyId) {
      return records.containsKey("prekey:" + preKeyId);
    }

    @Override
    public void removePreKey(int preKeyId) {
      usedPreKey = preKeyId;
    }

    // SignedPreKeyStore
    @Override
    public SignedPreKeyRecord loadSignedPreKey(int signedPreKeyId) throws InvalidKeyIdException {
      try {
        return new SignedPreKeyRecord(fetch("signed", signedPreKeyId));
      } catch (InvalidMessageException e) {
        throw new InvalidKeyIdException(e);
      }
    }

    @Override
    public List<SignedPreKeyRecord> loadSignedPreKeys() {
      return new ArrayList<>();
    }

    @Override
    public void storeSignedPreKey(int signedPreKeyId, SignedPreKeyRecord record) {}

    @Override
    public boolean containsSignedPreKey(int signedPreKeyId) {
      return records.containsKey("signed:" + signedPreKeyId);
    }

    @Override
    public void removeSignedPreKey(int signedPreKeyId) {}

    // KyberPreKeyStore
    @Override
    public KyberPreKeyRecord loadKyberPreKey(int kyberPreKeyId) throws InvalidKeyIdException {
      try {
        return new KyberPreKeyRecord(fetch("kyber", kyberPreKeyId));
      } catch (InvalidMessageException e) {
        throw new InvalidKeyIdException(e);
      }
    }

    @Override
    public List<KyberPreKeyRecord> loadKyberPreKeys() {
      return new ArrayList<>();
    }

    @Override
    public void storeKyberPreKey(int kyberPreKeyId, KyberPreKeyRecord record) {}

    @Override
    public boolean containsKyberPreKey(int kyberPreKeyId) {
      return records.containsKey("kyber:" + kyberPreKeyId);
    }

    @Override
    public void markKyberPreKeyUsed(int kyberPreKeyId, int signedPreKeyId, ECPublicKey baseKey) {
      try {
        usedKyber =
            new JSONObject()
                .put("id", kyberPreKeyId)
                .put("signedPreKeyId", signedPreKeyId)
                .put("baseKey", s(baseKey.serialize()));
      } catch (JSONException e) {
        throw new IllegalStateException(e);
      }
    }
  }
}
