package io.github.martexdev.river.core;

import static io.github.martexdev.river.core.SignalOps.b;
import static io.github.martexdev.river.core.SignalOps.s;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;
import org.signal.libsignal.protocol.kdf.HKDF;

/**
 * Platform cryptography for the client core: javax.crypto (AES-GCM, AES-CBC,
 * HMAC-SHA256), MessageDigest (SHA-256/512), libsignal's HKDF, java.util.zip.
 * The same algorithms and byte layouts as Node's crypto on the desktop.
 */
final class CryptoOps {
  private static final SecureRandom RANDOM = new SecureRandom();

  Object call(String method, JSONObject a) throws Exception {
    switch (method) {
      case "random":
        {
          byte[] out = new byte[a.getInt("n")];
          RANDOM.nextBytes(out);
          return s(out);
        }
      case "digest":
        return s(MessageDigest.getInstance(digestName(a.getString("alg"))).digest(b(a.getString("data"))));
      case "hmac":
        {
          requireSha256(a.getString("alg"));
          Mac mac = Mac.getInstance("HmacSHA256");
          byte[] key = b(a.getString("key"));
          // javax.crypto refuses empty keys; HMAC pads keys with zeros, so one zero byte is the same key.
          mac.init(new SecretKeySpec(key.length == 0 ? new byte[1] : key, "HmacSHA256"));
          return s(mac.doFinal(b(a.getString("data"))));
        }
      case "hkdf":
        requireSha256(a.getString("alg"));
        return s(
            HKDF.deriveSecrets(b(a.getString("ikm")), b(a.getString("salt")), b(a.getString("info")), a.getInt("length")));
      case "aesGcmSeal":
        {
          Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
          c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(b(a.getString("key")), "AES"), new GCMParameterSpec(128, b(a.getString("iv"))));
          c.updateAAD(b(a.getString("aad")));
          return s(c.doFinal(b(a.getString("data"))));
        }
      case "aesGcmOpen":
        {
          Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
          c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(b(a.getString("key")), "AES"), new GCMParameterSpec(128, b(a.getString("iv"))));
          c.updateAAD(b(a.getString("aad")));
          try {
            return s(c.doFinal(b(a.getString("data"))));
          } catch (AEADBadTagException e) {
            throw new SignalOps.Failure("authentication failed", "auth");
          }
        }
      case "aesCbc":
        {
          Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
          c.init(
              a.getBoolean("encrypt") ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE,
              new SecretKeySpec(b(a.getString("key")), "AES"),
              new IvParameterSpec(b(a.getString("iv"))));
          return s(c.doFinal(b(a.getString("data"))));
        }
      case "gzip":
        {
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            gz.write(b(a.getString("data")));
          }
          return s(out.toByteArray());
        }
      case "gunzip":
        {
          long max = a.getLong("max");
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(b(a.getString("data"))))) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = gz.read(buf)) > 0) {
              if (out.size() + (long) n > max) throw new SignalOps.Failure("decompressed data is too large", "too_large");
              out.write(buf, 0, n);
            }
          }
          return s(out.toByteArray());
        }
      default:
        throw new SignalOps.Failure("unknown native method " + method, null);
    }
  }

  private static String digestName(String alg) throws SignalOps.Failure {
    if (alg.equals("sha256")) return "SHA-256";
    if (alg.equals("sha512")) return "SHA-512";
    throw new SignalOps.Failure("digest not supported: " + alg, null);
  }

  private static void requireSha256(String alg) throws SignalOps.Failure {
    if (!alg.equals("sha256")) throw new SignalOps.Failure("hash not supported: " + alg, null);
  }
}
