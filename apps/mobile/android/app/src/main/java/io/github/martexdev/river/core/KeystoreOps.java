package io.github.martexdev.river.core;

import static io.github.martexdev.river.core.SignalOps.b;
import static io.github.martexdev.river.core.SignalOps.s;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.ByteBuffer;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * The Android Keystore protects the key of River's local database, as DPAPI or
 * the macOS Keychain do on computers. A non-exportable AES-256 key in the
 * keystore wraps the database key (AES-GCM); the wrapped key is useless off
 * this device.
 */
final class KeystoreOps {
  private static final String PROVIDER = "AndroidKeyStore";
  private static final String ALIAS = "river-database-key-wrap";
  private static final byte[] AAD = "river-db-key-wrap-v1".getBytes(java.nio.charset.StandardCharsets.UTF_8);

  private SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance(PROVIDER);
    ks.load(null);
    KeyStore.Entry entry = ks.getEntry(ALIAS, null);
    if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
    KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
    gen.init(
        new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
    return gen.generateKey();
  }

  Object call(String method, JSONObject a) throws Exception {
    switch (method) {
      case "keystore.usable":
        try {
          key();
          return true;
        } catch (Exception e) {
          return false;
        }
      case "keystore.name":
        return "Android Keystore";
      case "keystore.wrap":
        {
          Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
          c.init(Cipher.ENCRYPT_MODE, key());
          c.updateAAD(AAD);
          byte[] iv = c.getIV();
          byte[] body = c.doFinal(b(a.getString("data")));
          return s(ByteBuffer.allocate(1 + iv.length + body.length).put((byte) iv.length).put(iv).put(body).array());
        }
      case "keystore.unwrap":
        {
          byte[] wrapped = b(a.getString("data"));
          int ivLength = wrapped[0] & 0xff;
          if (ivLength < 12 || ivLength > 16 || wrapped.length < 1 + ivLength + 16) {
            throw new SignalOps.Failure("not a wrapped key", null);
          }
          Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
          c.init(
              Cipher.DECRYPT_MODE,
              key(),
              new GCMParameterSpec(128, java.util.Arrays.copyOfRange(wrapped, 1, 1 + ivLength)));
          c.updateAAD(AAD);
          return s(c.doFinal(wrapped, 1 + ivLength, wrapped.length - 1 - ivLength));
        }
      default:
        throw new SignalOps.Failure("unknown native method " + method, null);
    }
  }
}
