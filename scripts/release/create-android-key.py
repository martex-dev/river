"""
Creates River for Android's release signing key and stores it for the Release workflow.

    python scripts/release/create-android-key.py

- Writes ~/.river-release-keys/river-android-release.p12 (PKCS12, alias "river",
  RSA 4096, self-signed, valid until 2080) and its password file, unless they exist.
- Sets the GitHub secrets RIVER_ANDROID_KEYSTORE (base64), RIVER_ANDROID_KEYSTORE_PASSWORD,
  RIVER_ANDROID_KEY_PASSWORD and RIVER_ANDROID_KEY_ALIAS with the GitHub CLI.

Run it once, by the maintainer. Keep an offline copy of the folder: Android only
installs updates signed with the same key, so losing it means everyone reinstalls.
Needs Python with the `cryptography` package and a signed-in `gh`.
"""

import base64
import datetime
import hashlib
import secrets
import subprocess
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

REPO = "martex-dev/river"
ALIAS = "river"
KEYS = Path.home() / ".river-release-keys"
STORE = KEYS / "river-android-release.p12"
PASSWORD = KEYS / "river-android-release.password.txt"


def create() -> None:
    KEYS.mkdir(exist_ok=True)
    if not PASSWORD.exists():
        PASSWORD.write_text(secrets.token_urlsafe(32), encoding="utf-8")
    password = PASSWORD.read_text(encoding="utf-8").strip().encode()
    key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "River"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "martex-dev"),
        ]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime(2080, 1, 1, tzinfo=datetime.timezone.utc))
        .sign(key, hashes.SHA256())
    )
    STORE.write_bytes(
        pkcs12.serialize_key_and_certificates(
            ALIAS.encode(), key, cert, None, serialization.BestAvailableEncryption(password)
        )
    )
    print(f"Created {STORE}")


def set_secret(name: str, value: str) -> None:
    subprocess.run(["gh", "secret", "set", name, "-R", REPO], input=value.encode(), check=True)
    print(f"Set GitHub secret {name}")


def main() -> int:
    if STORE.exists():
        print(f"Using the existing key {STORE}")
    else:
        create()
    password = PASSWORD.read_text(encoding="utf-8").strip()
    data = STORE.read_bytes()
    _, cert, _ = pkcs12.load_key_and_certificates(data, password.encode())
    assert cert is not None
    fingerprint = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest().upper()
    print("Certificate SHA-256:", ":".join(fingerprint[i : i + 2] for i in range(0, len(fingerprint), 2)))
    set_secret("RIVER_ANDROID_KEYSTORE", base64.b64encode(data).decode())
    set_secret("RIVER_ANDROID_KEYSTORE_PASSWORD", password)
    set_secret("RIVER_ANDROID_KEY_PASSWORD", password)
    set_secret("RIVER_ANDROID_KEY_ALIAS", ALIAS)
    print(f"Done. Copy {KEYS} to offline storage (a USB stick) and keep it safe.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
