"""Outil « Médiathèque » : liste les vidéos et la musique des dossiers du NAS
(lecture via /api/fs/raw, qui gère la lecture en continu et l'avance rapide)."""

import os
import re
import threading
import time

from flask import Blueprint, jsonify, request

import roots
from files import KINDS

bp = Blueprint("media", __name__)
SKIP_ROOTS = {"documents", "pdf", "sauvegardes"}
_cache = {"at": 0, "data": None}
_lock = threading.Lock()


def scan():
    videos, music = [], []
    for r in roots.all_roots():
        if r["id"] in SKIP_ROOTS:
            continue
        base = os.path.realpath(r["path"])
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            folder = os.path.relpath(dirpath, base).replace(os.sep, "/")
            folder = "" if folder == "." else folder
            for n in filenames:
                ext = os.path.splitext(n)[1].lower().lstrip(".")
                if n.startswith(".") or (ext not in KINDS["video"] and ext not in KINDS["audio"]):
                    continue
                full = os.path.join(dirpath, n)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                item = {"root": r["id"], "path": f"{folder}/{n}".lstrip("/"), "name": os.path.splitext(n)[0],
                        "size": st.st_size, "mtime": st.st_mtime, "folder": folder or r["label"], "ext": ext}
                if ext in KINDS["video"]:
                    videos.append(item)
                else:
                    # « Artiste - Titre [id].mp3 » (Téléchargeur) ou dossier = album
                    title = re.sub(r"\s*\[[\w-]{6,}\]$", "", item["name"])
                    artist, _, rest = title.partition(" - ")
                    item.update(title=rest or title, artist=artist if rest else "", album=os.path.basename(folder) if folder else "")
                    music.append(item)
    videos.sort(key=lambda v: -v["mtime"])
    music.sort(key=lambda m: (m["artist"].lower(), m["album"].lower(), m["title"].lower()))
    return {"videos": videos, "music": music}


@bp.get("/api/media/library")
def library():
    with _lock:
        if request.args.get("refresh") or not _cache["data"] or time.time() - _cache["at"] > 60:
            _cache.update(data=scan(), at=time.time())
        return jsonify(_cache["data"])


def search(q, user):
    with _lock:
        data = _cache["data"] or scan()
    out = []
    for v in data["videos"]:
        if q in v["name"].lower():
            out.append({"type": "media", "title": v["name"], "sub": "Médiathèque · vidéo", "link": f"#/medias/video?root={v['root']}&path={v['path']}", "icon": "film"})
    for m in data["music"]:
        if q in m["name"].lower():
            out.append({"type": "media", "title": m["title"], "sub": "Médiathèque · " + (m["artist"] or "musique"), "link": "#/medias/musique", "icon": "music"})
    return out[:8]
