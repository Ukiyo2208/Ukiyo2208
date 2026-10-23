"""Outil « Presse-papier » : copie un texte, un lien, une image ou un fichier sur un
appareil et retrouve-le aussitôt sur les autres (téléphone ↔ ordinateur).

Chaque compte a son propre presse-papier ; un élément peut aussi être partagé avec
tout le monde (« Pour tous »). Les éléments non épinglés expirent après 7 jours."""

import mimetypes
import os
import re
import threading
import time
import uuid

from flask import Blueprint, g, jsonify, request, send_file

import push
import store

bp = Blueprint("clipboard", __name__)
FILES = store.path("clipboard", "files")
TTL = 7 * 86400
MAX_ITEMS = 200
MAX_FILE = 200 * 1024 ** 2


def load():
    return store.load("clipboard/clips", {"clips": []})


def visible(c, user):
    return c["owner"] == user or c.get("shared")


def public(c):
    return {k: v for k, v in c.items() if k != "path"}


def add_clip(clip):
    def go(d):
        d["clips"].insert(0, clip)
        keep = [c for c in d["clips"] if c.get("pinned")] + [c for c in d["clips"] if not c.get("pinned")]
        for c in keep[MAX_ITEMS:]:
            _remove_file(c)
        d["clips"] = [c for c in d["clips"] if c in keep[:MAX_ITEMS]]
    store.update("clipboard/clips", {"clips": []}, go)
    preview = clip.get("text", "")[:120] if clip["kind"] in ("text", "link") else clip.get("name", "")
    label = {"text": "Texte", "link": "Lien", "image": "Image", "file": "Fichier"}[clip["kind"]]
    push.notify("*" if clip.get("shared") else clip["owner"], f"Presse-papier · {label} depuis {clip['device']}", preview or label,
                "/#/presse-papier", "presse-papier", tag="clip", skip=request.headers.get("X-Push-Endpoint"))
    return clip


def _remove_file(c):
    if c.get("path"):
        try:
            os.remove(os.path.join(FILES, c["path"]))
        except OSError:
            pass


def device():
    return str(request.headers.get("X-Device") or request.form.get("device") or "Appareil")[:40]


@bp.get("/api/clips")
def list_clips():
    user = g.user["name"]
    clips = [public(c) for c in load()["clips"] if visible(c, user)]
    return jsonify(clips=clips, latest=max((c["created"] for c in clips), default=0))


@bp.post("/api/clips")
def add_text():
    d = request.get_json(silent=True) or {}
    text = str(d.get("text") or "")
    if not text.strip():
        raise ValueError("Rien à copier")
    if len(text) > 200_000:
        raise ValueError("Texte trop long (200 000 caractères max.)")
    kind = "link" if re.fullmatch(r"https?://\S+", text.strip()) else "text"
    return jsonify(public(add_clip({"id": uuid.uuid4().hex[:10], "kind": kind, "text": text if kind == "text" else text.strip(),
                                    "owner": g.user["name"], "device": device(), "created": time.time(),
                                    "shared": bool(d.get("shared")), "pinned": False})))


@bp.post("/api/clips/file")
def add_file():
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    os.makedirs(FILES, exist_ok=True)
    cid = uuid.uuid4().hex[:10]
    name = os.path.basename(f.filename or "") or "presse-papier"
    ext = os.path.splitext(name)[1].lower()[:10]
    path = cid + ext
    f.save(os.path.join(FILES, path))
    size = os.path.getsize(os.path.join(FILES, path))
    if size > MAX_FILE:
        os.remove(os.path.join(FILES, path))
        raise ValueError("Fichier trop gros pour le presse-papier (200 Mo max.) : utilise plutôt Bêta Drop")
    mime = f.mimetype or mimetypes.guess_type(name)[0] or "application/octet-stream"
    kind = "image" if mime.startswith("image/") else "file"
    return jsonify(public(add_clip({"id": cid, "kind": kind, "name": name, "mime": mime, "size": size, "path": path,
                                    "owner": g.user["name"], "device": device(), "created": time.time(),
                                    "shared": request.form.get("shared") == "1", "pinned": False})))


def _get(cid):
    c = next((c for c in load()["clips"] if c["id"] == cid), None)
    if not c or not visible(c, g.user["name"]):
        raise ValueError("Élément introuvable")
    return c


@bp.get("/api/clips/<cid>/raw")
def raw(cid):
    c = _get(cid)
    if not c.get("path"):
        raise ValueError("Pas de fichier")
    return send_file(os.path.join(FILES, c["path"]), mimetype=c["mime"], download_name=c["name"],
                     as_attachment=request.args.get("dl") == "1")


@bp.put("/api/clips/<cid>")
def edit(cid):
    d = request.get_json(silent=True) or {}

    def go(data):
        c = next((c for c in data["clips"] if c["id"] == cid), None)
        if not c or (c["owner"] != g.user["name"] and g.user["role"] != "admin"):
            raise ValueError("Élément introuvable")
        for key in ("pinned", "shared"):
            if key in d:
                c[key] = bool(d[key])
        return public(c)
    return jsonify(store.update("clipboard/clips", {"clips": []}, go))


@bp.delete("/api/clips/<cid>")
def delete(cid):
    def go(data):
        c = next((c for c in data["clips"] if c["id"] == cid), None)
        if not c or (c["owner"] != g.user["name"] and g.user["role"] != "admin"):
            raise ValueError("Élément introuvable")
        _remove_file(c)
        data["clips"].remove(c)
    store.update("clipboard/clips", {"clips": []}, go)
    return jsonify(ok=True)


@bp.delete("/api/clips")
def clear():
    """Vide son presse-papier (sauf les éléments épinglés)."""
    def go(data):
        for c in [c for c in data["clips"] if c["owner"] == g.user["name"] and not c.get("pinned")]:
            _remove_file(c)
            data["clips"].remove(c)
    store.update("clipboard/clips", {"clips": []}, go)
    return jsonify(ok=True)


def janitor():
    while True:
        time.sleep(3600)
        now = time.time()

        def go(data):
            for c in [c for c in data["clips"] if not c.get("pinned") and now - c["created"] > TTL]:
                _remove_file(c)
                data["clips"].remove(c)
        store.update("clipboard/clips", {"clips": []}, go)


def start():
    os.makedirs(FILES, exist_ok=True)
    threading.Thread(target=janitor, daemon=True).start()


def search(q, user):
    return [{"type": "clip", "title": (c.get("text") or c.get("name") or "")[:80], "sub": f"Presse-papier · {c['device']}", "link": "#/presse-papier"}
            for c in load()["clips"] if visible(c, user) and q in (c.get("text") or c.get("name") or "").lower()][:5]
