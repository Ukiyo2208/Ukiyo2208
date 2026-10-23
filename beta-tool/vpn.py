"""Outil « VPN » (administrateurs) : accès sécurisé à la maison depuis l'extérieur avec
WireGuard, via le conteneur open source wg-easy (profil « vpn » de docker-compose).

Bêta Tool pilote wg-easy par son API : création des appareils, QR code à scanner avec
l'appli WireGuard, activation, suppression, état de connexion."""

import json
import os
import re
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

from flask import Blueprint, Response, g, jsonify, request

bp = Blueprint("vpn", __name__)
INTERNAL = os.environ.get("VPN_INTERNAL_URL", "http://wg-easy:51821").rstrip("/")
PUBLIC = os.environ.get("VPN_URL", "").rstrip("/")
PASSWORD = os.environ.get("VPN_PASSWORD", "")
_jar = CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


@bp.before_request
def admins_only():
    if g.user["role"] != "admin":
        raise PermissionError("Réservé aux administrateurs")


def call(method, path, body=None, raw=False, retry=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(INTERNAL + path, data=data, method=method, headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with _opener.open(req, timeout=10) as r:
            content = r.read()
            return (content, r.headers.get("Content-Type", "")) if raw else (json.loads(content) if content.strip() else None)
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry and PASSWORD:
            login()
            return call(method, path, body, raw, retry=False)
        msg = e.read().decode("utf-8", "replace")[:200]
        raise ValueError(f"wg-easy a répondu {e.code} : {msg or e.reason}") from None
    except (urllib.error.URLError, OSError) as e:
        raise ValueError(f"Le VPN (wg-easy) ne répond pas : {getattr(e, 'reason', e)}") from None


def login():
    call("POST", "/api/session", {"password": PASSWORD}, retry=False)


def status():
    try:
        with urllib.request.urlopen(INTERNAL + "/api/session", timeout=4) as r:
            info = json.loads(r.read() or b"{}")
        return {"ready": True, "requires_password": info.get("requiresPassword", True)}
    except urllib.error.HTTPError:
        return {"ready": True, "requires_password": True}
    except (urllib.error.URLError, OSError, ValueError):
        return {"ready": False}


def clean_client(c):
    hs = c.get("latestHandshakeAt")
    return {"id": c.get("id"), "name": c.get("name"), "enabled": c.get("enabled", True), "address": c.get("address"),
            "created": c.get("createdAt"), "handshake": hs, "rx": c.get("transferRx") or 0, "tx": c.get("transferTx") or 0}


@bp.get("/api/vpn")
def overview():
    st = status()
    out = {**st, "configured": bool(PASSWORD), "public": PUBLIC, "clients": []}
    if st["ready"] and PASSWORD:
        try:
            out["clients"] = [clean_client(c) for c in call("GET", "/api/wireguard/client") or []]
        except ValueError as e:
            out["error"] = str(e)
    return jsonify(out)


@bp.post("/api/vpn/clients")
def add():
    name = str((request.get_json(silent=True) or {}).get("name") or "").strip()[:40]
    if not re.fullmatch(r"[\w .'’@-]{1,40}", name):
        raise ValueError("Donne un nom à l'appareil (ex. « Téléphone de Léa »)")
    call("POST", "/api/wireguard/client", {"name": name})
    clients = [clean_client(c) for c in call("GET", "/api/wireguard/client") or []]
    created = next((c for c in reversed(clients) if c["name"] == name), None)
    return jsonify(client=created, clients=clients)


@bp.delete("/api/vpn/clients/<cid>")
def delete(cid):
    call("DELETE", f"/api/wireguard/client/{cid}")
    return jsonify(ok=True)


@bp.post("/api/vpn/clients/<cid>/<action>")
def toggle(cid, action):
    if action not in ("enable", "disable"):
        raise ValueError("Action inconnue")
    call("POST", f"/api/wireguard/client/{cid}/{action}")
    return jsonify(ok=True)


@bp.get("/api/vpn/clients/<cid>/qrcode.svg")
def qrcode(cid):
    content, ctype = call("GET", f"/api/wireguard/client/{cid}/qrcode.svg", raw=True)
    return Response(content, mimetype="image/svg+xml", headers={"Cache-Control": "no-store"})


@bp.get("/api/vpn/clients/<cid>/configuration")
def configuration(cid):
    content, _ = call("GET", f"/api/wireguard/client/{cid}/configuration", raw=True)
    name = re.sub(r"[^\w-]+", "-", request.args.get("name") or "appareil").strip("-")[:30] or "appareil"
    return Response(content, mimetype="text/plain", headers={"Content-Disposition": f'attachment; filename="vpn-{name}.conf"',
                                                             "Cache-Control": "no-store"})

