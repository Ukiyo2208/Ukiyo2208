"""Outil « Bêta Drop » : partager des fichiers par un lien (/d/<code>), avec
expiration, mot de passe et nombre de téléchargements limité — ou ouvrir un
« dépôt » où n'importe qui peut t'envoyer des fichiers (rangés dans RECEIVE_DIR)."""

import hashlib
import hmac
import os
import secrets
import shutil
import tempfile
import time
import zipfile

from flask import Blueprint, g, jsonify, request, send_file, session

import activity
import roots
import store
from converter import sanitize_name, unique_path

bp = Blueprint("drop", __name__)
FILES = store.path("drop")
RECEIVE_DIR = os.environ.get("RECEIVE_DIR", "/depots")


def _hash(password, token):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), token.encode(), 100_000).hex()


def shares():
    return store.load("shares", {})


def state(s):
    """« actif », « expiré » ou « épuisé »."""
    if s.get("expires") and time.time() > s["expires"]:
        return "expire"
    if s.get("max_downloads") and s.get("downloads", 0) >= s["max_downloads"]:
        return "epuise"
    return "actif"


def mine(s):
    return s["owner"] == g.user["name"] or g.user["role"] == "admin"


def summary(s):
    return {k: s.get(k) for k in ("token", "kind", "title", "message", "created", "expires", "max_downloads", "downloads",
                                  "received", "folder", "owner")} | {
        "files": [{"name": f["name"], "size": f["size"]} for f in s["items"]], "state": state(s),
        "password": bool(s.get("password"))}


# --- Gestion (connecté) ------------------------------------------------------

@bp.get("/api/drop")
def list_shares():
    out = [summary(s) for s in shares().values() if mine(s)]
    return jsonify(sorted(out, key=lambda s: -s["created"]))


@bp.post("/api/drop")
def create():
    """Multipart (fichiers envoyés) ou JSON (fichiers déjà sur le NAS : items=[{root, path}])."""
    data = request.get_json(silent=True) if request.is_json else request.form
    kind = data.get("kind", "send")
    token = secrets.token_urlsafe(8)
    title = str(data.get("title") or "").strip()[:120]
    items = []
    if kind == "send":
        if request.files:
            folder = os.path.join(FILES, token)
            os.makedirs(folder)
            for f in request.files.getlist("file"):
                dest = unique_path(folder, sanitize_name(f.filename))
                f.save(dest)
                items.append({"name": os.path.basename(dest), "size": os.path.getsize(dest), "src": "upload", "path": dest})
        for ref in (data.get("items") or []) if request.is_json else []:
            path = roots.resolve(ref.get("root"), ref.get("path"))
            if os.path.isfile(path):
                items.append({"name": os.path.basename(path), "size": os.path.getsize(path), "src": "ref",
                              "root": ref["root"], "rel": ref["path"]})
        if not items:
            raise ValueError("Ajoute au moins un fichier")
        title = title or (items[0]["name"] if len(items) == 1 else f"{len(items)} fichiers")
    elif kind == "receive":
        title = title or "Dépôt de fichiers"
    else:
        raise ValueError("Type de partage inconnu")
    days = float(data.get("expires_days") or 0)
    share = {"token": token, "kind": kind, "owner": g.user["name"], "title": title,
             "message": str(data.get("message") or "").strip()[:1000], "created": time.time(),
             "expires": time.time() + days * 86400 if days > 0 else None,
             "max_downloads": int(data.get("max_downloads") or 0) or None, "downloads": 0, "received": 0,
             "password": _hash(data["password"], token) if data.get("password") else None, "items": items,
             "folder": sanitize_name(title) if kind == "receive" else None}
    store.update("shares", {}, lambda all_: all_.__setitem__(token, share))
    return jsonify(summary(share))


@bp.delete("/api/drop/<token>")
def remove(token):
    def go(all_):
        s = all_.get(token)
        if not s or not mine(s):
            raise ValueError("Partage introuvable")
        del all_[token]
    store.update("shares", {}, go)
    shutil.rmtree(os.path.join(FILES, token), ignore_errors=True)
    return jsonify(ok=True)


# --- Pages publiques (sans connexion) ------------------------------------------

@bp.get("/d/<token>")
def public_page(token):
    from flask import current_app
    return current_app.send_static_file("drop.html")


def public_share(token):
    s = shares().get(token)
    if not s:
        raise ValueError("Ce lien n'existe pas ou a été supprimé")
    return s


def unlocked(s):
    return not s.get("password") or token_ok(s["token"])


def token_ok(token):
    return token in session.get("drops", [])


@bp.get("/api/public/drop/<token>")
def public_info(token):
    s = public_share(token)
    st = state(s)
    info = {"title": s["title"], "message": s["message"], "kind": s["kind"], "state": st, "expires": s.get("expires"),
            "locked": not unlocked(s), "owner": s["owner"] if s["owner"] not in ("local", "admin") else None}
    if st == "actif" and unlocked(s):
        info["files"] = [{"name": f["name"], "size": f["size"]} for f in s["items"]]
    return jsonify(info)


@bp.post("/api/public/drop/<token>/unlock")
def public_unlock(token):
    s = public_share(token)
    pw = (request.get_json(silent=True) or {}).get("password", "")
    if not s.get("password") or not hmac.compare_digest(_hash(pw, token), s["password"]):
        time.sleep(.8)
        raise ValueError("Mot de passe incorrect")
    session["drops"] = [*session.get("drops", [])[-50:], token]
    return jsonify(ok=True)


def file_path(s, f):
    return f["path"] if f["src"] == "upload" else roots.resolve(f["root"], f["rel"])


def count_download(token):
    def go(all_):
        if token in all_:
            all_[token]["downloads"] = all_[token].get("downloads", 0) + 1
            all_[token]["last"] = time.time()
    store.update("shares", {}, go)


def check_access(token):
    s = public_share(token)
    if s["kind"] != "send":
        raise PermissionError("Ce lien sert à envoyer des fichiers")
    if state(s) != "actif":
        raise PermissionError("Ce partage a expiré")
    if not unlocked(s):
        raise PermissionError("Mot de passe requis")
    return s


@bp.get("/api/public/drop/<token>/file/<int:i>")
def public_file(token, i):
    s = check_access(token)
    if not 0 <= i < len(s["items"]):
        raise ValueError("Fichier introuvable")
    f = s["items"][i]
    count_download(token)
    if s["downloads"] == 0:
        activity.log(s["owner"], "drop", f"Premier téléchargement de « {s['title']} »", "#/drop")
    return send_file(file_path(s, f), as_attachment=True, download_name=f["name"])


@bp.get("/api/public/drop/<token>/all")
def public_all(token):
    s = check_access(token)
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False, dir=store.path())
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for f in s["items"]:
            z.write(file_path(s, f), f["name"])
    tmp.close()
    fh = open(tmp.name, "rb")
    os.unlink(tmp.name)
    count_download(token)
    return send_file(fh, as_attachment=True, download_name=sanitize_name(s["title"]) + ".zip", mimetype="application/zip")


@bp.post("/api/public/drop/<token>/upload")
def public_upload(token):
    s = public_share(token)
    if s["kind"] != "receive" or state(s) != "actif":
        raise PermissionError("Ce dépôt n'accepte plus de fichiers")
    if not unlocked(s):
        raise PermissionError("Mot de passe requis")
    sender = sanitize_name(request.form.get("sender") or "")[:60]
    folder = os.path.join(RECEIVE_DIR, s["folder"] or "Dépôt", sender) if sender else os.path.join(RECEIVE_DIR, s["folder"] or "Dépôt")
    os.makedirs(folder, exist_ok=True)
    names = []
    for f in request.files.getlist("file"):
        dest = unique_path(folder, sanitize_name(f.filename))
        f.save(dest)
        names.append(os.path.basename(dest))
    if not names:
        raise ValueError("Aucun fichier reçu")
    store.update("shares", {}, lambda all_: all_[token].__setitem__("received", all_[token].get("received", 0) + len(names)))
    who = f" de {sender}" if sender else ""
    activity.log(s["owner"], "drop", f"{len(names)} fichier{'s' if len(names) > 1 else ''} reçu{'s' if len(names) > 1 else ''}{who} via « {s['title']} »",
                 "#/fichiers/depots")
    return jsonify(received=names)


# --- Recherche / tableau de bord --------------------------------------------

def search(q, user):
    return [{"type": "share", "title": s["title"], "sub": "Bêta Drop · " + ("dépôt" if s["kind"] == "receive" else f"{len(s['items'])} fichier(s)"),
             "link": "#/drop"} for s in shares().values() if s["owner"] == user and q in s["title"].lower()][:6]


def count(user):
    return sum(1 for s in shares().values() if s["owner"] == user and state(s) == "actif")


def start():
    os.makedirs(FILES, exist_ok=True)
    os.makedirs(RECEIVE_DIR, exist_ok=True)
