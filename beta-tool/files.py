"""Outil « Fichiers » : explorateur des dossiers du NAS (voir roots.py).

/api/fs/*    : lecture (aperçu, miniatures), partagée avec la médiathèque et l'album photo ;
/api/files/* : gestion (envoyer, créer, renommer, déplacer, corbeille, « ouvrir avec »)."""

import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import time
import zipfile

from flask import Blueprint, g, jsonify, request, send_file
from PIL import Image, ImageOps

import archives
import converter
import roots
import store
import work
from converter import LocalFile, sanitize_name, unique_path

bp = Blueprint("files", __name__)
THUMBS = store.path("thumbs")
TRASH = ".corbeille"

KINDS = {
    "image": {"jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif", "svg"},
    "video": {"mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "3gp"},
    "audio": {"mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "aiff", "alac"},
    "pdf": {"pdf"},
    "doc": {"doc", "docx", "odt", "rtf"},
    "sheet": {"xls", "xlsx", "ods", "csv"},
    "slide": {"ppt", "pptx", "odp"},
    "archive": {"zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso"},
    "text": {"txt", "md", "json", "xml", "yml", "yaml", "ini", "cfg", "conf", "log", "csv", "srt", "vtt", "py", "js", "html", "css", "sh"},
}


def kind_of(name):
    ext = os.path.splitext(name)[1].lower().lstrip(".")
    return next((k for k, exts in KINDS.items() if ext in exts), "file")


def entry(root_id, path):
    st = os.stat(path)
    is_dir = os.path.isdir(path)
    out = {"name": os.path.basename(path), "path": roots.relative(root_id, path), "dir": is_dir,
           "size": None if is_dir else st.st_size, "mtime": st.st_mtime, "kind": "folder" if is_dir else kind_of(path)}
    if is_dir:
        try:
            out["count"] = sum(1 for n in os.listdir(path) if not n.startswith("."))
        except OSError:
            out["count"] = 0
    return out


# --- Lecture ------------------------------------------------------------------

@bp.get("/api/files/roots")
def list_roots():
    out = []
    for r in roots.all_roots():
        try:
            u = shutil.disk_usage(r["path"])
            out.append({"id": r["id"], "label": r["label"], "icon": r["icon"], "free": u.free, "total": u.total})
        except OSError:
            pass
    return jsonify(out)


@bp.get("/api/files/list")
def list_dir():
    root_id, rel = request.args.get("root"), request.args.get("path", "")
    path = roots.resolve(root_id, rel)
    if not os.path.isdir(path):
        raise ValueError("Ce n'est pas un dossier")
    in_trash = rel.split("/")[0] == TRASH
    names = [n for n in os.listdir(path) if in_trash or not n.startswith(".")]
    entries = []
    for n in names:
        try:
            entries.append(entry(root_id, os.path.join(path, n)))
        except OSError:
            pass
    entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
    trash = os.path.join(roots.resolve(root_id), TRASH)
    return jsonify(root=root_id, path=roots.relative(root_id, path), entries=entries,
                   trash=os.path.isdir(trash) and bool(os.listdir(trash)))


@bp.get("/api/fs/raw")
def raw():
    path = roots.resolve(request.args.get("root"), request.args.get("path"))
    if os.path.isdir(path):
        raise ValueError("C'est un dossier")
    return send_file(path, conditional=True, as_attachment=request.args.get("dl") == "1",
                     download_name=os.path.basename(path))


@bp.get("/api/fs/thumb")
def thumb():
    path = roots.resolve(request.args.get("root"), request.args.get("path"))
    size = max(64, min(2048, int(request.args.get("s", 320))))
    st = os.stat(path)
    key = hashlib.sha1(f"{path}:{st.st_mtime_ns}:{st.st_size}:{size}".encode()).hexdigest()
    cached = os.path.join(THUMBS, key[:2], key + ".jpg")
    if not os.path.exists(cached):
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        if not make_thumb(path, cached, size):
            return "", 404
    resp = send_file(cached, mimetype="image/jpeg", max_age=7 * 86400)
    return resp


def make_thumb(src, dest, size):
    kind = kind_of(src)
    tmp = dest + ".tmp.jpg"
    try:
        if kind == "image" and not src.lower().endswith(".svg"):
            with Image.open(src) as im:
                im.draft("RGB", (size * 2, size * 2))  # décodage JPEG réduit : beaucoup plus rapide
                im = ImageOps.exif_transpose(im)
                im.thumbnail((size, size))
                im.convert("RGB").save(tmp, "JPEG", quality=82)
        elif kind == "video":
            dur = probe_duration(src)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(min(dur * .1, 30) if dur else 1), "-i", src, "-frames:v", "1",
                            "-vf", f"scale='min({size},iw)':-2", tmp], capture_output=True, timeout=60)
        elif kind == "pdf":
            base = tmp[:-4]
            subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-jpeg", "-scale-to", str(size), src, base],
                           capture_output=True, timeout=60)
        if os.path.exists(tmp) and os.path.getsize(tmp):
            os.replace(tmp, dest)
            return True
    except Exception as e:  # fichier abîmé, format exotique… : pas de miniature
        print("miniature", src, e)
    return False


def probe_duration(src):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                             capture_output=True, text=True, timeout=30).stdout
        return float(out.strip())
    except (ValueError, subprocess.SubprocessError):
        return 0


@bp.get("/api/files/text")
def read_text():
    path = roots.resolve(request.args.get("root"), request.args.get("path"))
    with open(path, "rb") as f:
        data = f.read(512 * 1024)
    return jsonify(text=data.decode("utf-8", "replace"), truncated=os.path.getsize(path) > len(data))


@bp.post("/api/files/text")
def write_text():
    d = request.get_json(silent=True) or {}
    path = roots.resolve(d.get("root"), d.get("path"))
    if os.path.getsize(path) > 512 * 1024:
        raise ValueError("Fichier trop gros pour être modifié ici")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        f.write(d.get("text", ""))
    os.replace(path + ".tmp", path)
    return jsonify(ok=True)


@bp.get("/api/files/download")
def download():
    """Un fichier tel quel ; un dossier ou plusieurs éléments en .zip."""
    root_id = request.args.get("root")
    paths = [roots.resolve(root_id, p) for p in request.args.getlist("p")]
    if not paths:
        raise ValueError("Rien à télécharger")
    if len(paths) == 1 and os.path.isfile(paths[0]):
        return send_file(paths[0], as_attachment=True, download_name=os.path.basename(paths[0]))
    name = (os.path.basename(paths[0]) if len(paths) == 1 else "fichiers") + ".zip"
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False, dir=store.path())
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for p in paths:
            base = os.path.dirname(p)
            if os.path.isfile(p):
                z.write(p, os.path.basename(p))
            for dirpath, dirnames, filenames in os.walk(p):
                dirnames[:] = [d for d in dirnames if not d.startswith(".")]
                for f in filenames:
                    full = os.path.join(dirpath, f)
                    z.write(full, os.path.relpath(full, base))
    tmp.close()
    f = open(tmp.name, "rb")
    os.unlink(tmp.name)  # le fichier reste lisible tant qu'il est ouvert
    return send_file(f, as_attachment=True, download_name=name, mimetype="application/zip")


# --- Gestion ------------------------------------------------------------------

@bp.post("/api/files/upload")
def upload():
    root_id, rel = request.form.get("root"), request.form.get("path", "")
    folder = roots.resolve(root_id, rel)
    relpaths = request.form.getlist("relpath")
    saved = []
    for i, f in enumerate(request.files.getlist("file")):
        # Envoi d'un dossier entier : on recrée ses sous-dossiers
        sub = [sanitize_name(p) for p in (relpaths[i] if i < len(relpaths) else "").split("/")[:-1] if p not in ("", ".", "..")]
        target_dir = os.path.join(folder, *sub)
        roots.resolve(root_id, roots.relative(root_id, folder) + "/" + "/".join(sub), must_exist=False)
        os.makedirs(target_dir, exist_ok=True)
        dest = unique_path(target_dir, sanitize_name(f.filename))
        f.save(dest)
        saved.append(os.path.basename(dest))
    return jsonify(saved=saved)


@bp.post("/api/files/mkdir")
def mkdir():
    d = request.get_json(silent=True) or {}
    folder = roots.resolve(d.get("root"), d.get("path", ""))
    dest = unique_path(folder, sanitize_name(d.get("name") or "Nouveau dossier"))
    os.makedirs(dest)
    return jsonify(entry(d["root"], dest))


@bp.post("/api/files/rename")
def rename():
    d = request.get_json(silent=True) or {}
    path = roots.resolve(d.get("root"), d.get("path"))
    if path == roots.resolve(d.get("root")):
        raise ValueError("Impossible de renommer la racine")
    dest = os.path.join(os.path.dirname(path), sanitize_name(d.get("name")))
    if os.path.exists(dest):
        raise ValueError("Un élément porte déjà ce nom")
    os.rename(path, dest)
    return jsonify(entry(d["root"], dest))


@bp.post("/api/files/move")
def move():
    d = request.get_json(silent=True) or {}
    src_root, dest_root = d.get("root"), d.get("dest_root") or d.get("root")
    dest = roots.resolve(dest_root, d.get("dest_path", ""))
    if not os.path.isdir(dest):
        raise ValueError("La destination n'est pas un dossier")
    done = 0
    for rel in d.get("paths", []):
        src = roots.resolve(src_root, rel)
        if dest == src or dest.startswith(src + os.sep):
            raise ValueError("Impossible de déplacer un dossier dans lui-même")
        target = unique_path(dest, os.path.basename(src))
        if d.get("copy"):
            shutil.copytree(src, target) if os.path.isdir(src) else shutil.copy2(src, target)
        else:
            shutil.move(src, target)
        done += 1
    return jsonify(done=done)


@bp.post("/api/files/delete")
def delete():
    """Met à la corbeille (dossier .corbeille de la racine) ; depuis la corbeille, supprime pour de bon."""
    d = request.get_json(silent=True) or {}
    root_id = d.get("root")
    trash = roots.resolve(root_id, TRASH, must_exist=False)
    for rel in d.get("paths", []):
        path = roots.resolve(root_id, rel)
        if path == roots.resolve(root_id) or path == trash:
            raise ValueError("Impossible de supprimer ce dossier")
        if path.startswith(trash + os.sep):
            shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
        else:
            os.makedirs(trash, exist_ok=True)
            shutil.move(path, unique_path(trash, os.path.basename(path)))
    return jsonify(ok=True)


@bp.post("/api/files/empty-trash")
def empty_trash():
    trash = roots.resolve((request.get_json(silent=True) or {}).get("root"), TRASH, must_exist=False)
    shutil.rmtree(trash, ignore_errors=True)
    return jsonify(ok=True)


# --- « Ouvrir avec » : envoie un fichier du NAS vers un autre outil -------------

@bp.post("/api/files/convert")
def to_converter():
    d = request.get_json(silent=True) or {}
    path = roots.resolve(d.get("root"), d.get("path"))
    return jsonify(id=converter.submit(LocalFile(path), d.get("target", ""), d.get("nas", True), d.get("subfolder"), g.user["name"]))


@bp.post("/api/files/extract")
def to_archive():
    d = request.get_json(silent=True) or {}
    return jsonify(archives.inspect(LocalFile(roots.resolve(d.get("root"), d.get("path")))))


@bp.post("/api/files/to-work")
def to_work():
    """Ouvre dans Bêta Work : directement s'il est déjà dans les documents, sinon une copie y est faite."""
    d = request.get_json(silent=True) or {}
    path = roots.resolve(d.get("root"), d.get("path"))
    docs = os.path.realpath(work.DOCS_DIR)
    if not path.startswith(docs + os.sep):
        if not work.kind_of(path):
            raise ValueError("Format non pris en charge par Bêta Work")
        dest = unique_path(docs, os.path.basename(path))
        shutil.copy2(path, dest)
        path = dest
    return jsonify(id=work.doc_id(os.path.relpath(path, docs)))


# --- Recherche par nom ----------------------------------------------------------

_index = {"at": 0, "items": []}
_index_lock = threading.Lock()


def file_index():
    """Liste des fichiers de toutes les racines, rafraîchie au plus toutes les 5 minutes."""
    with _index_lock:
        if time.time() - _index["at"] < 300:
            return _index["items"]
        items = []
        for r in roots.all_roots():
            base = os.path.realpath(r["path"])
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [x for x in dirnames if not x.startswith(".")]
                rel_dir = os.path.relpath(dirpath, base).replace(os.sep, "/")
                rel_dir = "" if rel_dir == "." else rel_dir
                for n in dirnames:
                    items.append((n.lower(), r["id"], r["label"], f"{rel_dir}/{n}".lstrip("/"), True))
                for n in filenames:
                    if not n.startswith("."):
                        items.append((n.lower(), r["id"], r["label"], f"{rel_dir}/{n}".lstrip("/"), False))
                if len(items) > 300000:
                    break
        _index.update(at=time.time(), items=items)
        return items


def search(q, user):
    out = []
    for low, rid, label, rel, is_dir in file_index():
        if q in low:
            parent = os.path.dirname(rel)
            link = f"#/fichiers/{rid}/{rel}" if is_dir else f"#/fichiers/{rid}/{parent}?voir={os.path.basename(rel)}"
            out.append({"type": "folder" if is_dir else "file", "title": os.path.basename(rel), "sub": f"{label} / {parent}".rstrip(" /"),
                        "link": link, "icon": "folder" if is_dir else {"image": "image", "video": "film", "audio": "music", "pdf": "pdf"}.get(kind_of(rel), "file")})
            if len(out) >= 12:
                break
    return out


def invalidate():
    _index["at"] = 0


@bp.after_app_request
def _after(resp):
    if request.method != "GET" and request.path.startswith(("/api/files/", "/api/drop", "/api/photos/upload")):
        invalidate()
    return resp


def start():
    os.makedirs(THUMBS, exist_ok=True)
