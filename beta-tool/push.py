"""Notifications push sur l'appli (Web Push) : le téléphone ou l'ordinateur reçoit
une notification même quand Bêta Tool est fermé (appli installée, ou navigateur).

Implémentation autonome des normes Web Push : clés VAPID (RFC 8292) et chiffrement
aes128gcm (RFC 8188 / 8291), avec la bibliothèque cryptography. Les abonnements des
appareils et les préférences de chacun sont dans DATA_DIR/push.json."""

import base64
import hashlib
import hmac
import json
import os
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("push", __name__)
_lock = threading.Lock()
CONTACT = os.environ.get("PUSH_CONTACT", "mailto:admin@beta-tool.local")


def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# --- Clés VAPID (identité du serveur auprès des services de push) --------------

_vapid = None


def vapid():
    global _vapid
    if _vapid:
        return _vapid
    with _lock:
        pem_path = store.path("vapid.pem")
        if not os.path.exists(pem_path):
            key = ec.generate_private_key(ec.SECP256R1())
            os.makedirs(os.path.dirname(pem_path), exist_ok=True)
            with open(pem_path, "wb") as f:
                f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
            os.chmod(pem_path, 0o600)
        with open(pem_path, "rb") as f:
            key = serialization.load_pem_private_key(f.read(), None)
        public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        _vapid = (key, b64u(public))
    return _vapid


def vapid_header(endpoint):
    key, public = vapid()
    url = urllib.parse.urlsplit(endpoint)
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64u(json.dumps({"aud": f"{url.scheme}://{url.netloc}", "exp": int(time.time()) + 12 * 3600,
                              "sub": CONTACT}).encode())
    r, s = decode_dss_signature(key.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    token = f"{head}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    return f"vapid t={token}, k={public}"


# --- Chiffrement du message (aes128gcm) -----------------------------------------

def _hkdf(salt, ikm, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def encrypt(payload, p256dh, auth, salt=None, server_key=None):
    ua_public = unb64u(p256dh)
    secret = unb64u(auth)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = server_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = server_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))
    ikm = _hkdf(secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack(">IB", 4096, len(as_public)) + as_public + body


# --- Abonnements et préférences -------------------------------------------------

def data():
    return store.load("push", {"subs": [], "prefs": {}})


def prefs(user):
    return {"off": [], **data()["prefs"].get(user, {})}


def send_to(sub, message, ttl=86400):
    body = encrypt(json.dumps(message, ensure_ascii=False).encode(), sub["keys"]["p256dh"], sub["keys"]["auth"])
    req = urllib.request.Request(sub["endpoint"], data=body, method="POST", headers={
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": str(ttl),
        "Urgency": "normal", "Authorization": vapid_header(sub["endpoint"])})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


def _deliver(user, message, tool, skip=None):
    d = data()
    gone = []
    for sub in d["subs"]:
        if user not in ("*", sub["user"]) or sub["endpoint"] == skip:
            continue
        if tool and tool in d["prefs"].get(sub["user"], {}).get("off", []):
            continue
        if send_to(sub, message) in (404, 410):  # appareil désabonné
            gone.append(sub["endpoint"])
    if gone:
        store.update("push", {"subs": [], "prefs": {}}, lambda d: d.update(subs=[s for s in d["subs"] if s["endpoint"] not in gone]))


def notify(user, title, body, url="/", tool=None, tag=None, image=None, icon=None, skip=None):
    """Envoie une notification à tous les appareils de `user` ("*" = tout le monde), en arrière-plan."""
    if not data()["subs"]:
        return
    message = {"title": title, "body": body, "url": url, "tag": tag or tool or "beta-tool", "tool": tool}
    if image:
        message["image"] = image
    if icon:
        message["icon"] = icon
    threading.Thread(target=_deliver, args=(user, message, tool, skip), daemon=True).start()


# --- Routes -------------------------------------------------------------------

@bp.get("/api/push")
def status():
    d = data()
    endpoint = request.args.get("endpoint", "")
    mine = [s for s in d["subs"] if s["user"] == g.user["name"]]
    return jsonify(key=vapid()[1], devices=[{"name": s.get("name", "Appareil"), "created": s["created"], "this": s["endpoint"] == endpoint}
                                           for s in mine], subscribed=any(s["endpoint"] == endpoint for s in mine),
                   prefs=prefs(g.user["name"]))


@bp.post("/api/push/subscribe")
def subscribe():
    sub = request.get_json(silent=True) or {}
    keys = sub.get("keys") or {}
    endpoint = str(sub.get("endpoint") or "")
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("Abonnement invalide")

    def go(d):
        d["subs"] = [s for s in d["subs"] if s["endpoint"] != endpoint]
        d["subs"].append({"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
                          "user": g.user["name"], "name": str(sub.get("name") or "Appareil")[:60], "created": time.time()})
    store.update("push", {"subs": [], "prefs": {}}, go)
    return jsonify(ok=True)


@bp.post("/api/push/unsubscribe")
def unsubscribe():
    endpoint = (request.get_json(silent=True) or {}).get("endpoint")
    store.update("push", {"subs": [], "prefs": {}}, lambda d: d.update(
        subs=[s for s in d["subs"] if not (s["endpoint"] == endpoint and s["user"] == g.user["name"])]))
    return jsonify(ok=True)


@bp.put("/api/push/prefs")
def set_prefs():
    off = [str(t)[:40] for t in (request.get_json(silent=True) or {}).get("off", [])][:100]
    store.update("push", {"subs": [], "prefs": {}}, lambda d: d["prefs"].__setitem__(g.user["name"], {"off": off}))
    return jsonify(prefs(g.user["name"]))


@bp.post("/api/push/test")
def test():
    subs = [s for s in data()["subs"] if s["user"] == g.user["name"]]
    if not subs:
        raise ValueError("Aucun appareil abonné : active d'abord les notifications sur cet appareil")
    results = [send_to(s, {"title": "Bêta Tool", "body": "Les notifications fonctionnent 🎉", "url": "/#/reglages/notifications",
                           "tag": "test"}) for s in subs]
    ok = sum(1 for r in results if 200 <= r < 300)
    if not ok:
        raise ValueError("Le service de notifications n'a pas répondu : vérifie que le NAS a accès à Internet")
    return jsonify(sent=ok, total=len(subs))
