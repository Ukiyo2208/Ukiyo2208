"""Outil « Album photo » : les photos de PHOTOS_DIR rangées par date de prise de vue
(EXIF), avec un index gardé dans DATA_DIR pour ne relire que les nouvelles photos."""

import os
import threading
import time
from datetime import datetime

from flask import Blueprint, g, jsonify, request
from PIL import Image

import roots
import store
from converter import sanitize_name, unique_path

bp = Blueprint("photos", __name__)
EXTS = {"jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tiff", "tif", "avif", "mp4", "mov", "m4v"}
VIDEO = {"mp4", "mov", "m4v"}
_state = {"scanning": False, "done": 0, "total": 0}
_lock = threading.Lock()


def photo_info(full, st):
    info = {"taken": st.st_mtime, "camera": None, "w": None, "h": None}
    if os.path.splitext(full)[1].lower().lstrip(".") in VIDEO:
        return info
    try:
        with Image.open(full) as im:
            info["w"], info["h"] = im.size
            exif = im.getexif()
            sub = exif.get_ifd(0x8769) if exif else {}
            raw = sub.get(36867) or sub.get(36868) or exif.get(306)  # DateTimeOriginal / Digitized / DateTime
            if raw:
                info["taken"] = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S").timestamp()
            make, model = exif.get(271), exif.get(272)
            if model:
                info["camera"] = (model if make and str(make).split()[0] in str(model) else f"{make or ''} {model}").strip()
            if exif.get(274) in (5, 6, 7, 8):  # photo pivotée : on inverse largeur et hauteur
                info["w"], info["h"] = info["h"], info["w"]
    except Exception:
        pass
    return info


def rebuild():
    """Met l'index à jour (ne relit que les fichiers nouveaux ou modifiés)."""
    try:
        base = os.path.realpath(roots.get("photos")["path"])
    except ValueError:
        return []
    old = {p["path"]: p for p in store.load("photos-index", [])}
    found = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if not d.startswith((".", "@"))]  # @eaDir des Synology
        for n in filenames:
            if not n.startswith(".") and os.path.splitext(n)[1].lower().lstrip(".") in EXTS:
                found.append(os.path.join(dirpath, n))
    _state.update(total=len(found), done=0)
    index = []
    for i, full in enumerate(found):
        rel = os.path.relpath(full, base).replace(os.sep, "/")
        try:
            st = os.stat(full)
        except OSError:
            continue
        prev = old.get(rel)
        if prev and prev.get("mtime") == st.st_mtime and prev.get("size") == st.st_size:
            index.append(prev)
        else:
            index.append({"path": rel, "mtime": st.st_mtime, "size": st.st_size, "album": rel.split("/")[0] if "/" in rel else "",
                          "video": os.path.splitext(rel)[1].lower().lstrip(".") in VIDEO, **photo_info(full, st)})
        _state["done"] = i + 1
    index.sort(key=lambda p: -p["taken"])
    store.save("photos-index", index)
    return index


def scan_async():
    with _lock:
        if _state["scanning"]:
            return
        _state["scanning"] = True

    def go():
        try:
            rebuild()
        finally:
            _state["scanning"] = False
    threading.Thread(target=go, daemon=True).start()


@bp.get("/api/photos")
def list_photos():
    try:
        roots.get("photos")
    except ValueError:
        return jsonify(available=False, photos=[], scanning=False)
    if request.args.get("refresh") or not os.path.exists(store.path("photos-index.json")):
        scan_async()
    return jsonify(available=True, photos=store.load("photos-index", []), **_state)


@bp.post("/api/photos/upload")
def upload():
    base = roots.resolve("photos")
    saved = 0
    for f in request.files.getlist("file"):
        month = time.strftime("%Y-%m")
        folder = os.path.join(base, "Import", month)
        os.makedirs(folder, exist_ok=True)
        f.save(unique_path(folder, sanitize_name(f.filename)))
        saved += 1
    scan_async()
    return jsonify(saved=saved)


def start():
    try:
        roots.get("photos")
        scan_async()  # au démarrage, rattrape les photos ajoutées entre-temps
    except ValueError:
        pass
