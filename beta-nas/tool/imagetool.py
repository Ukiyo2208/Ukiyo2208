"""Outil « Studio Image », partie serveur : le détourage (retrait de
l'arrière-plan) avec rembg. Le reste (recadrage, retouches, traitement par lot)
se fait dans le navigateur. Le modèle est téléchargé au premier usage."""

import io
import os
import threading

from flask import Blueprint, jsonify, request, send_file

import store

bp = Blueprint("image", __name__)
MODEL = os.environ.get("REMBG_MODEL", "isnet-general-use")
os.environ.setdefault("U2NET_HOME", store.path("models", "rembg"))
_session, _lock = {}, threading.Lock()


def session():
    from rembg import new_session  # import tardif : lourd
    with _lock:
        if MODEL not in _session:
            _session[MODEL] = new_session(MODEL)
        return _session[MODEL]


@bp.get("/api/image/status")
def status():
    try:
        import rembg  # noqa: F401
        ok = True
    except ImportError:
        ok = False
    downloaded = any(MODEL + ".onnx" in files for _, _, files in os.walk(os.environ["U2NET_HOME"]))
    return jsonify(removebg=ok, model=MODEL, downloaded=downloaded)


@bp.post("/api/image/removebg")
def remove_background():
    from PIL import Image, ImageOps
    from rembg import remove
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucune image reçue")
    with Image.open(f.stream) as im:
        im = ImageOps.exif_transpose(im).convert("RGBA")
        im.thumbnail((3000, 3000))
        out = remove(im, session=session(), alpha_matting=request.form.get("fine") == "1")
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    buf.seek(0)
    return send_file(buf, mimetype="image/png", download_name="detoure.png")


def start():
    os.makedirs(os.environ["U2NET_HOME"], exist_ok=True)
