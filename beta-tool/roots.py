"""Dossiers visibles dans l'explorateur, la médiathèque, la recherche…

Chaque outil a le sien ; EXTRA_ROOTS ajoute d'autres dossiers du NAS
(ex. « Films=/media/films;Musique=/media/musique », montés dans docker-compose)."""

import os
import re
import unicodedata

BUILTIN = [
    ("telechargements", "Téléchargements", "DOWNLOAD_DIR", "/downloads", "download"),
    ("conversions", "Conversions", "CONVERT_DIR", "/converted", "convert"),
    ("pdf", "PDF", "PDF_DIR", "/pdf", "pdf"),
    ("decompresses", "Décompressés", "UNZIP_DIR", "/extracted", "archive"),
    ("documents", "Documents (Bêta Work)", "DOCS_DIR", "/documents", "briefcase"),
    ("photos", "Photos", "PHOTOS_DIR", "/photos", "image"),
    ("depots", "Fichiers reçus", "RECEIVE_DIR", "/depots", "inbox"),
    ("sauvegardes", "Sauvegardes", "BACKUP_DIR", "/backup", "save"),
    ("telephones", "Téléphones", "PHONES_DIR", "/phones", "phone"),
]


def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "dossier"


def all_roots():
    out = [{"id": rid, "label": label, "path": os.environ.get(env, default), "icon": ic}
           for rid, label, env, default, ic in BUILTIN]
    for item in filter(None, os.environ.get("EXTRA_ROOTS", "").split(";")):
        if "=" in item:
            label, path = item.split("=", 1)
            out.append({"id": "x-" + slug(label), "label": label.strip(), "path": path.strip(), "icon": "folder"})
    return [r for r in out if os.path.isdir(r["path"])]


def get(root_id):
    r = next((r for r in all_roots() if r["id"] == root_id), None)
    if not r:
        raise ValueError("Dossier inconnu")
    return r


def resolve(root_id, rel="", must_exist=True):
    """(racine, chemin relatif) → chemin absolu, en refusant tout ce qui sort de la racine."""
    base = os.path.realpath(get(root_id)["path"])
    parts = [p for p in str(rel or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if ".." in parts:
        raise ValueError("Chemin invalide")
    path = os.path.realpath(os.path.join(base, *parts))
    if path != base and not path.startswith(base + os.sep):
        raise ValueError("Chemin invalide")
    if must_exist and not os.path.exists(path):
        raise ValueError("Introuvable : " + (rel or "/"))
    return path


def relative(root_id, path):
    rel = os.path.relpath(path, os.path.realpath(get(root_id)["path"])).replace(os.sep, "/")
    return "" if rel == "." else rel
