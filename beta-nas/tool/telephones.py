"""Outil « Sauvegarde téléphones » : chaque compte a son dossier WebDAV sur le NAS
(https://<adresse>/webdav/<compte>/) où les applis du téléphone envoient photos, vidéos,
documents et sauvegardes de SMS (PhotoSync, FolderSync, SMS Backup & Restore…).

On y retrouve ensuite les fichiers dans Fichiers (dossier « Téléphones ») et on peut relire
ses SMS et son journal d'appels sauvegardés, sans rien envoyer dans un cloud."""

import os
import re
import threading
import time
import xml.etree.ElementTree as ET

from flask import Blueprint, g, jsonify, request

import auth
import settings

bp = Blueprint("telephones", __name__)
ROOT = os.environ.get("PHONES_DIR", "/phones")
_cache = {}
_lock = threading.Lock()


def root():
    if not os.path.isdir(ROOT):
        import store
        alt = store.path("telephones")
        os.makedirs(alt, exist_ok=True)
        return alt
    return ROOT


def safe_name(name):
    return re.sub(r"[^\w .@-]", "_", name).strip() or "compte"


def user_dir(user):
    p = os.path.join(root(), safe_name(user))
    os.makedirs(p, exist_ok=True)
    return p


# --- Serveur WebDAV (WsgiDAV) ------------------------------------------------------------------------------

def webdav_app():
    """Application WSGI montée sur /webdav, ou None si WsgiDAV n'est pas installé."""
    try:
        from wsgidav.dc.base_dc import BaseDomainController
        from wsgidav.fs_dav_provider import FilesystemProvider
        from wsgidav.wsgidav_app import WsgiDAVApp
    except ImportError:
        return None

    class DC(BaseDomainController):
        """Identifiant et mot de passe Bêta Tool ; chacun ne voit que son dossier /webdav/<compte>/."""
        def __init__(self, wsgidav_app, config):
            super().__init__(wsgidav_app, config)

        def get_domain_realm(self, path_info, environ):
            return "Bêta Tool"

        def require_authentication(self, realm, environ):
            return True

        def supports_http_digest_auth(self):
            return False

        def basic_auth_user(self, realm, user_name, password, environ):
            if not settings.enabled("sauvegarde-tel") or auth.mode() != "accounts":
                return False
            u = auth.find(user_name)
            if not u or u["role"] == "child" or not auth.check_password(u["name"], password):
                time.sleep(.6)
                return False
            mine = "/" + safe_name(u["name"])
            paths = [environ.get("PATH_INFO", "")]
            dest = environ.get("HTTP_DESTINATION")
            if dest:
                from urllib.parse import unquote, urlparse
                paths.append(unquote(urlparse(dest).path).split("/webdav", 1)[-1])
            if not all(p == mine or p.startswith(mine + "/") for p in paths):
                return False
            user_dir(u["name"])
            return True

        def digest_auth_user(self, realm, user_name, environ):
            return False

    config = {
        "provider_mapping": {"/": FilesystemProvider(root(), readonly=False)},
        "http_authenticator": {"domain_controller": DC, "accept_basic": True, "accept_digest": False, "default_to_digest": False, "trusted_auth_header": None},
        "simple_dc": {"user_mapping": {}},
        "verbose": 1,
        "logging": {"enable_loggers": []},
        "property_manager": True,
        "lock_storage": True,
        "dir_browser": {"enable": True, "response_trailer": "Bêta Tool"},
        "mount_path": "/webdav",
    }
    return WsgiDAVApp(config)


# --- Contenu du dossier ------------------------------------------------------------------------------------

def scan(user):
    base = user_dir(user)
    devices = []
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        if not os.path.isdir(p) or name.startswith("."):
            continue
        n, size, last = 0, 0, 0
        for dp, _, files in os.walk(p):
            for f in files:
                try:
                    st = os.stat(os.path.join(dp, f))
                except OSError:
                    continue
                n += 1
                size += st.st_size
                last = max(last, st.st_mtime)
        devices.append({"name": name, "files": n, "size": size, "last": last or None})
    return devices


def backups(user):
    """Fichiers de « SMS Backup & Restore » : sms-AAAAMMJJ….xml et calls-….xml (le plus récent de chaque)."""
    base = user_dir(user)
    found = {"sms": [], "calls": []}
    for dp, _, files in os.walk(base):
        for f in files:
            m = re.match(r"(sms|calls)-.*\.xml$", f, re.I)
            if m:
                p = os.path.join(dp, f)
                found[m[1].lower()].append((os.path.getmtime(p), p))
    return {k: max(v)[1] if v else None for k, v in found.items()}


def _parse(path, kind):
    """Lecture en flux (les sauvegardes avec MMS peuvent peser des centaines de Mo)."""
    key = (path, os.path.getmtime(path))
    with _lock:
        if key in _cache:
            return _cache[key]
    out = []
    for _, el in ET.iterparse(path, events=("end",)):
        tag = el.tag
        if kind == "sms" and tag == "sms":
            out.append({"addr": el.get("address", ""), "name": el.get("contact_name") or "", "date": int(el.get("date", "0")) / 1000,
                        "out": el.get("type") == "2", "text": el.get("body") or ""})
        elif kind == "sms" and tag == "mms":
            text = " ".join(p.get("text", "") for p in el.iter("part") if (p.get("ct") or "").startswith("text/plain")).strip()
            pics = sum(1 for p in el.iter("part") if (p.get("ct") or "").startswith("image/"))
            addr = el.get("address", "").split("~")[0]
            out.append({"addr": addr, "name": el.get("contact_name") or "", "date": int(el.get("date", "0")) / (1 if len(el.get("date", "0")) <= 10 else 1000),
                        "out": el.get("msg_box") == "2", "text": text + (f" [{pics} photo{'s' if pics > 1 else ''}]" if pics else "")})
        elif kind == "calls" and tag == "call":
            out.append({"addr": el.get("number", ""), "name": el.get("contact_name") or "", "date": int(el.get("date", "0")) / 1000,
                        "duration": int(el.get("duration", "0") or 0), "type": {"1": "entrant", "2": "sortant", "3": "manqué", "5": "refusé", "6": "bloqué"}.get(el.get("type"), "autre")})
        if tag in ("sms", "mms", "call"):
            el.clear()
    out.sort(key=lambda x: x["date"])
    with _lock:
        _cache.clear()
        _cache[key] = out
    return out


def _norm(num):
    d = re.sub(r"\D", "", num or "")
    return "0" + d[2:] if d.startswith("33") and len(d) == 11 else d or num


# --- Routes -------------------------------------------------------------------------------------------------

@bp.get("/api/phones")
def overview():
    user = g.user["name"]
    b = backups(user)
    host = request.headers.get("X-Forwarded-Host", request.host)
    proto = request.headers.get("X-Forwarded-Proto", request.scheme)
    return jsonify(devices=scan(user), url=f"{proto}://{host}/webdav/{safe_name(user)}/", user=user, accounts=auth.mode() == "accounts",
                   sms=bool(b["sms"]), calls=bool(b["calls"]), sms_date=os.path.getmtime(b["sms"]) if b["sms"] else None,
                   https=proto == "https")


@bp.get("/api/phones/sms")
def sms_threads():
    b = backups(g.user["name"])
    if not b["sms"]:
        return jsonify(threads=[])
    msgs = _parse(b["sms"], "sms")
    threads = {}
    for m in msgs:
        t = threads.setdefault(_norm(m["addr"]), {"addr": m["addr"], "name": "", "count": 0, "last": 0, "preview": ""})
        t["count"] += 1
        t["name"] = m["name"] if m["name"] and m["name"] != "(Unknown)" else t["name"]
        if m["date"] >= t["last"]:
            t["last"], t["preview"] = m["date"], m["text"][:120]
    q = (request.args.get("q") or "").lower()
    out = sorted(threads.values(), key=lambda t: -t["last"])
    if q:
        hits = {_norm(m["addr"]) for m in msgs if q in m["text"].lower()}
        out = [t for t in out if q in (t["name"] + t["addr"]).lower() or _norm(t["addr"]) in hits]
    return jsonify(threads=out[:500], total=len(msgs))


@bp.get("/api/phones/sms/<path:addr>")
def sms_thread(addr):
    b = backups(g.user["name"])
    if not b["sms"]:
        return jsonify(messages=[])
    key = _norm(addr)
    return jsonify(messages=[m for m in _parse(b["sms"], "sms") if _norm(m["addr"]) == key][-2000:])


@bp.get("/api/phones/calls")
def calls():
    b = backups(g.user["name"])
    if not b["calls"]:
        return jsonify(calls=[])
    return jsonify(calls=list(reversed(_parse(b["calls"], "calls")))[:1000])
