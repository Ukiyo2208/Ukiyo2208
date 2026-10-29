"""Clés d'accès (passkeys / WebAuthn) : se connecter avec l'empreinte, le visage ou le code du
téléphone ou de l'ordinateur, sans mot de passe.

Le navigateur n'autorise les clés d'accès que sur une adresse sécurisée : https:// avec un nom
(ex. https://nas.maison.lan, https://beta.mondomaine.fr) ou http://localhost, jamais avec une
adresse IP en http. La clé est liée à ce nom : si l'adresse change, il faut en créer une nouvelle.

La clé privée ne quitte jamais l'appareil ; le NAS ne garde que la clé publique."""

import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import urlparse

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from flask import Blueprint, g, jsonify, request, session

import activity
import auth
import store

bp = Blueprint("passkeys", __name__)
TIMEOUT = 120  # secondes pour répondre au défi


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    s = str(s or "")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# --- CBOR (juste ce qu'il faut pour WebAuthn) -------------------------------------------------------------

def cbor_decode(data, pos=0):
    """Renvoie (valeur, position suivante)."""
    ib = data[pos]
    major, info = ib >> 5, ib & 31
    pos += 1
    if info < 24:
        val = info
    elif info in (24, 25, 26, 27):
        n = 1 << (info - 24)
        val = int.from_bytes(data[pos:pos + n], "big")
        pos += n
    else:
        raise ValueError("CBOR non pris en charge")
    if major == 0:
        return val, pos
    if major == 1:
        return -1 - val, pos
    if major == 2:
        return bytes(data[pos:pos + val]), pos + val
    if major == 3:
        return bytes(data[pos:pos + val]).decode(), pos + val
    if major == 4:
        out = []
        for _ in range(val):
            v, pos = cbor_decode(data, pos)
            out.append(v)
        return out, pos
    if major == 5:
        out = {}
        for _ in range(val):
            k, pos = cbor_decode(data, pos)
            v, pos = cbor_decode(data, pos)
            out[k] = v
        return out, pos
    if major == 7:
        return {20: False, 21: True, 22: None}.get(info), pos
    raise ValueError("CBOR non pris en charge")


def parse_auth_data(ad):
    """authenticatorData → {rp_hash, flags, count, cred_id?, cose?}"""
    if len(ad) < 37:
        raise ValueError("Réponse de l'appareil incomplète")
    out = {"rp_hash": ad[:32], "flags": ad[32], "count": struct.unpack(">I", ad[33:37])[0]}
    if out["flags"] & 0x40:  # données de la clé créée
        n = struct.unpack(">H", ad[53:55])[0]
        out["cred_id"] = ad[55:55 + n]
        out["cose"], _ = cbor_decode(ad, 55 + n)
    return out


def public_key(cose):
    """Clé COSE → (alg, clé publique sérialisable)."""
    kty, alg = cose.get(1), cose.get(3)
    if kty == 2 and alg == -7:  # EC2 P-256, ES256
        return {"alg": -7, "x": b64u(cose[-2]), "y": b64u(cose[-3])}
    if kty == 3 and alg == -257:  # RSA, RS256
        return {"alg": -257, "n": b64u(cose[-1]), "e": b64u(cose[-2])}
    raise ValueError("Type de clé non pris en charge par Bêta Tool")


def verify_sig(pub, signature, signed):
    if pub["alg"] == -7:
        key = ec.EllipticCurvePublicNumbers(int.from_bytes(unb64u(pub["x"]), "big"), int.from_bytes(unb64u(pub["y"]), "big"), ec.SECP256R1()).public_key()
        key.verify(signature, signed, ec.ECDSA(hashes.SHA256()))
    else:
        key = rsa.RSAPublicNumbers(int.from_bytes(unb64u(pub["e"]), "big"), int.from_bytes(unb64u(pub["n"]), "big")).public_key()
        key.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())


# --- Contexte : nom du site et origine ----------------------------------------------------------------------

def origin():
    """Origine vue par le navigateur (derrière un proxy HTTPS : en-têtes X-Forwarded-*)."""
    proto = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    host = request.headers.get("X-Forwarded-Host", request.host).split(",")[0].strip()
    return f"{proto}://{host}"


def rp_id():
    return urlparse(origin()).hostname


def secure_ok():
    o = urlparse(origin())
    return o.scheme == "https" or o.hostname in ("localhost", "127.0.0.1")


def _check_client(client_json, kind, challenge):
    c = json.loads(client_json)
    if c.get("type") != kind:
        raise ValueError("Réponse inattendue de l'appareil")
    if not challenge or not hmac.compare_digest(c.get("challenge", ""), challenge["value"]) or time.time() - challenge["at"] > TIMEOUT:
        raise ValueError("Le délai est dépassé, recommence")
    if c.get("origin") != origin():
        raise ValueError(f"Adresse inattendue ({c.get('origin')})")


def _creds():
    """{id: (nom d'utilisateur, clé)} pour tous les comptes."""
    out = {}
    for u in auth.users():
        for k in u.get("passkeys", []):
            out[k["id"]] = (u["name"], k)
    return out


# --- Enregistrer une clé ----------------------------------------------------------------------------------------

@bp.get("/api/me/passkeys")
def my_keys():
    u = auth.find(g.user["name"]) or {}
    return jsonify(keys=[{k: v for k, v in p.items() if k in ("id", "name", "created", "used")} for p in u.get("passkeys", [])],
                   secure=secure_ok(), origin=origin(), accounts=auth.mode() == "accounts")


@bp.post("/api/me/passkeys/options")
def register_options():
    if auth.mode() != "accounts":
        raise ValueError("Les clés d'accès demandent des comptes (Réglages › Comptes)")
    if not secure_ok():
        raise ValueError("Les clés d'accès ne marchent qu'avec une adresse sécurisée (https:// avec un nom). Voir Réglages › Accès sécurisé.")
    u = auth.find(g.user["name"])
    if not u.get("uid"):
        def go(d):
            x = next(x for x in d["users"] if x["name"] == u["name"])
            x["uid"] = x.get("uid") or b64u(secrets.token_bytes(16))
        store.update("users", {"users": []}, go)
        u = auth.find(g.user["name"])
    ch = b64u(secrets.token_bytes(32))
    session["pk_reg"] = {"value": ch, "at": time.time()}
    return jsonify(challenge=ch, rp={"id": rp_id(), "name": "Bêta Tool"}, user={"id": u["uid"], "name": u["name"], "displayName": u["name"]},
                   pubKeyCredParams=[{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -257}], timeout=TIMEOUT * 1000,
                   excludeCredentials=[{"type": "public-key", "id": p["id"]} for p in u.get("passkeys", [])],
                   authenticatorSelection={"residentKey": "required", "userVerification": "required"}, attestation="none")


@bp.post("/api/me/passkeys")
def register():
    f = request.get_json(force=True)
    client = unb64u(f["clientDataJSON"])
    _check_client(client, "webauthn.create", session.pop("pk_reg", None))
    att, _ = cbor_decode(unb64u(f["attestationObject"]))
    ad = parse_auth_data(att["authData"])
    if ad["rp_hash"] != hashlib.sha256(rp_id().encode()).digest():
        raise ValueError("La clé n'a pas été créée pour cette adresse")
    if not ad["flags"] & 0x01 or "cred_id" not in ad:
        raise ValueError("L'appareil n'a pas confirmé")
    key = {"id": b64u(ad["cred_id"]), "pub": public_key(ad["cose"]), "count": ad["count"], "rp": rp_id(),
           "name": str(f.get("name") or "Appareil")[:60], "created": time.time(), "used": None}

    def go(d):
        x = next(x for x in d["users"] if x["name"] == g.user["name"])
        x.setdefault("passkeys", []).append(key)
    store.update("users", {"users": []}, go)
    activity.log(g.user["name"], "reglages", f"Nouvelle clé d'accès : {key['name']}", "#/reglages/profil")
    return jsonify(ok=True, id=key["id"])


@bp.put("/api/me/passkeys/<kid>")
def rename(kid):
    name = str((request.get_json(force=True) or {}).get("name") or "")[:60]

    def go(d):
        x = next(x for x in d["users"] if x["name"] == g.user["name"])
        for p in x.get("passkeys", []):
            if p["id"] == kid and name:
                p["name"] = name
    store.update("users", {"users": []}, go)
    return jsonify(ok=True)


@bp.delete("/api/me/passkeys/<kid>")
def remove(kid):
    def go(d):
        x = next(x for x in d["users"] if x["name"] == g.user["name"])
        x["passkeys"] = [p for p in x.get("passkeys", []) if p["id"] != kid]
    store.update("users", {"users": []}, go)
    return jsonify(ok=True)


# --- Se connecter avec une clé (routes publiques) ---------------------------------------------------------------

@bp.post("/api/auth/passkey/options")
def login_options():
    if auth.mode() != "accounts" or not secure_ok():
        return jsonify(available=False)
    ch = b64u(secrets.token_bytes(32))
    session["pk_login"] = {"value": ch, "at": time.time()}
    return jsonify(available=True, challenge=ch, rpId=rp_id(), timeout=TIMEOUT * 1000, userVerification="required", allowCredentials=[])


@bp.post("/api/auth/passkey")
def login():
    f = request.get_json(force=True)
    client = unb64u(f["clientDataJSON"])
    try:
        _check_client(client, "webauthn.get", session.pop("pk_login", None))
        found = _creds().get(f.get("id"))
        if not found:
            raise ValueError("Cette clé d'accès n'est pas (ou plus) enregistrée sur Bêta Tool")
        name, key = found
        raw_ad = unb64u(f["authenticatorData"])
        ad = parse_auth_data(raw_ad)
        if ad["rp_hash"] != hashlib.sha256(key.get("rp", rp_id()).encode()).digest() or key.get("rp", rp_id()) != rp_id():
            raise ValueError("Clé créée pour une autre adresse")
        if not ad["flags"] & 0x01 or not ad["flags"] & 0x04:
            raise ValueError("L'appareil n'a pas vérifié que c'est bien toi")
        try:
            verify_sig(key["pub"], unb64u(f["signature"]), raw_ad + hashlib.sha256(client).digest())
        except InvalidSignature:
            raise ValueError("Signature invalide")
        if ad["count"] and key["count"] and ad["count"] <= key["count"]:
            raise ValueError("Cette clé semble avoir été copiée : elle est refusée")
    except ValueError as e:
        time.sleep(.6)
        return jsonify(error=str(e)), 401

    def go(d):
        x = next(x for x in d["users"] if x["name"] == name)
        for p in x.get("passkeys", []):
            if p["id"] == key["id"]:
                p["count"], p["used"] = ad["count"], time.time()
    store.update("users", {"users": []}, go)
    session.permanent = True
    session["user"] = name  # une clé d'accès vaut déjà deux facteurs (l'appareil + l'empreinte ou le code)
    return jsonify(ok=True)
