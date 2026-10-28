"""Comptes utilisateurs et rôles.

Trois modes, choisis automatiquement :
- « open »     : aucun compte ni APP_PASSWORD → tout le monde est administrateur (réseau local) ;
- « password » : APP_PASSWORD défini, pas de comptes → un mot de passe unique, administrateur ;
- « accounts » : des comptes existent (créés dans Réglages) → identifiant + mot de passe, rôles admin/membre."""

import base64
import hashlib
import hmac
import os
import re
import secrets
import struct
import time
import urllib.parse

from flask import session

import store

APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
NAME_RE = re.compile(r"^[\w .@-]{2,32}$")


def _hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def users():
    return store.load("users", {"users": []})["users"]


def mode():
    return "accounts" if users() else "password" if APP_PASSWORD else "open"


def find(name):
    return next((u for u in users() if u["name"].lower() == str(name or "").lower()), None)


def public(u):
    return {"name": u["name"], "role": u["role"], "created": u.get("created"), "twofa": bool(u.get("totp"))}


def current():
    """Utilisateur de la requête : {"name", "role"} ou None s'il faut se connecter."""
    m = mode()
    if m == "open":
        return {"name": "local", "role": "admin"}
    if m == "password":
        return {"name": "admin", "role": "admin"} if session.get("user") == "admin" else None
    u = find(session.get("user"))
    return {"name": u["name"], "role": u["role"]} if u else None


def check_password(name, password):
    u = find(name)
    return bool(u) and hmac.compare_digest(_hash(password or "", u["salt"]), u["hash"])


def login(name, password):
    """Renvoie "ok" (connecté), "code" (mot de passe bon, code de double authentification attendu) ou False."""
    m = mode()
    if m == "password":
        ok = hmac.compare_digest(password or "", APP_PASSWORD)
        name = "admin"
    elif m == "accounts":
        u = find(name)
        ok = check_password(name, password)
        name = u["name"] if u else name
        if ok and u.get("totp"):
            session["pending"] = {"name": name, "ts": time.time()}
            return "code"
    else:
        ok = True
    if not ok:
        time.sleep(.6)  # freine les essais en série
        return False
    session.permanent = True
    session["user"] = name
    return "ok"


# --- Double authentification (codes à 6 chiffres d'une appli : Google Authenticator, Authy…) ---

def totp(secret, t=None, step=30, digits=6):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", int((t or time.time()) // step)), hashlib.sha1).digest()
    o = digest[-1] & 15
    return str((struct.unpack(">I", digest[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** digits).zfill(digits)


def _code_ok(secret, code):
    code = re.sub(r"\s", "", str(code or ""))
    now = time.time()
    return any(hmac.compare_digest(totp(secret, now + d * 30), code) for d in (-1, 0, 1))


def _recovery_hash(code):
    return hashlib.sha256(re.sub(r"[\s-]", "", code.lower()).encode()).hexdigest()


def login_code(code):
    """Deuxième étape de la connexion : code de l'appli ou code de secours (à usage unique)."""
    pending = session.get("pending")
    if not pending or time.time() - pending["ts"] > 300:
        session.pop("pending", None)
        return False
    used = {}

    def go(data):
        u = next((u for u in data["users"] if u["name"] == pending["name"]), None)
        if not u or not u.get("totp"):
            return False
        if _code_ok(u["totp"], code):
            return True
        h = _recovery_hash(str(code or ""))
        if h in u.get("recovery", []):
            u["recovery"].remove(h)
            used["left"] = len(u["recovery"])
            return True
        return False
    ok = store.update("users", {"users": []}, go)
    if not ok:
        time.sleep(.8)
        return False
    session.pop("pending", None)
    session.permanent = True
    session["user"] = pending["name"]
    return used.get("left", True)


def twofa_setup(name, issuer):
    """Prépare un secret (pas encore actif) et renvoie l'adresse otpauth:// à scanner."""
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")

    def go(data):
        u = next(u for u in data["users"] if u["name"] == name)
        u["totp_pending"] = secret
    store.update("users", {"users": []}, go)
    label = urllib.parse.quote(f"{issuer}:{name}")
    return {"secret": secret, "uri": f"otpauth://totp/{label}?secret={secret}&issuer={urllib.parse.quote(issuer)}&digits=6&period=30"}


def twofa_enable(name, code):
    codes = ["-".join(secrets.token_hex(2) for _ in range(2)) for _ in range(10)]

    def go(data):
        u = next(u for u in data["users"] if u["name"] == name)
        if not u.get("totp_pending") or not _code_ok(u["totp_pending"], code):
            raise ValueError("Code incorrect : vérifie l'heure du téléphone et réessaie")
        u["totp"] = u.pop("totp_pending")
        u["recovery"] = [_recovery_hash(c) for c in codes]
    store.update("users", {"users": []}, go)
    return codes


def twofa_disable(name):
    def go(data):
        u = next((u for u in data["users"] if u["name"] == name), None)
        if not u:
            raise ValueError("Compte introuvable")
        for k in ("totp", "totp_pending", "recovery"):
            u.pop(k, None)
    store.update("users", {"users": []}, go)


def twofa_status(name):
    u = find(name) or {}
    return {"enabled": bool(u.get("totp")), "recovery_left": len(u.get("recovery", []))}


def _check(name, password):
    if not NAME_RE.match(name or ""):
        raise ValueError("Identifiant invalide (2 à 32 lettres, chiffres, espaces, . _ - @)")
    if len(password or "") < 6:
        raise ValueError("Le mot de passe doit faire au moins 6 caractères")


def add(name, password, role="member"):
    name = (name or "").strip()
    _check(name, password)
    if role not in ("admin", "member", "child"):
        raise ValueError("Rôle inconnu")

    def go(data):
        if any(u["name"].lower() == name.lower() for u in data["users"]):
            raise ValueError("Cet identifiant existe déjà")
        if not data["users"]:
            role_ = "admin"  # le premier compte est forcément administrateur
        else:
            role_ = role
        salt = secrets.token_hex(16)
        data["users"].append({"name": name, "role": role_, "salt": salt, "hash": _hash(password, salt),
                              "created": time.strftime("%Y-%m-%d %H:%M")})
        return role_
    return store.update("users", {"users": []}, go)


def _admins(data):
    return [u for u in data["users"] if u["role"] == "admin"]


def set_password(name, password):
    _check(name, password)

    def go(data):
        u = next((u for u in data["users"] if u["name"] == name), None)
        if not u:
            raise ValueError("Compte introuvable")
        u["salt"] = secrets.token_hex(16)
        u["hash"] = _hash(password, u["salt"])
    store.update("users", {"users": []}, go)


def set_role(name, role):
    if role not in ("admin", "member", "child"):
        raise ValueError("Rôle inconnu")

    def go(data):
        u = next((u for u in data["users"] if u["name"] == name), None)
        if not u:
            raise ValueError("Compte introuvable")
        if u["role"] == "admin" and role != "admin" and len(_admins(data)) == 1:
            raise ValueError("Il faut garder au moins un administrateur")
        u["role"] = role
    store.update("users", {"users": []}, go)


def delete(name):
    def go(data):
        u = next((u for u in data["users"] if u["name"] == name), None)
        if not u:
            raise ValueError("Compte introuvable")
        if u["role"] == "admin" and len(_admins(data)) == 1:
            raise ValueError("Impossible de supprimer le dernier administrateur")
        data["users"].remove(u)
    store.update("users", {"users": []}, go)
