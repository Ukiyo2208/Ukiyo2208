"""Comptes utilisateurs et rôles.

Trois modes, choisis automatiquement :
- « open »     : aucun compte ni APP_PASSWORD → tout le monde est administrateur (réseau local) ;
- « password » : APP_PASSWORD défini, pas de comptes → un mot de passe unique, administrateur ;
- « accounts » : des comptes existent (créés dans Réglages) → identifiant + mot de passe, rôles admin/membre."""

import hashlib
import hmac
import os
import re
import secrets
import time

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
    return {"name": u["name"], "role": u["role"], "created": u.get("created")}


def current():
    """Utilisateur de la requête : {"name", "role"} ou None s'il faut se connecter."""
    m = mode()
    if m == "open":
        return {"name": "local", "role": "admin"}
    if m == "password":
        return {"name": "admin", "role": "admin"} if session.get("user") == "admin" else None
    u = find(session.get("user"))
    return {"name": u["name"], "role": u["role"]} if u else None


def login(name, password):
    m = mode()
    if m == "password":
        ok = hmac.compare_digest(password or "", APP_PASSWORD)
        name = "admin"
    elif m == "accounts":
        u = find(name)
        ok = bool(u) and hmac.compare_digest(_hash(password or "", u["salt"]), u["hash"])
        name = u["name"] if u else name
    else:
        ok = True
    if not ok:
        time.sleep(.6)  # freine les essais en série
        return False
    session.permanent = True
    session["user"] = name
    return True


def _check(name, password):
    if not NAME_RE.match(name or ""):
        raise ValueError("Identifiant invalide (2 à 32 lettres, chiffres, espaces, . _ - @)")
    if len(password or "") < 6:
        raise ValueError("Le mot de passe doit faire au moins 6 caractères")


def add(name, password, role="member"):
    name = (name or "").strip()
    _check(name, password)
    if role not in ("admin", "member"):
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
    if role not in ("admin", "member"):
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
