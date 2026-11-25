"""Outil « Bêta Work » : traitement de texte, tableur et présentations dans le
navigateur, propulsé par ONLYOFFICE Docs (conteneur séparé).

Bêta Tool gère les fichiers (dossier DOCS_DIR) et fabrique la configuration de
l'éditeur ; ONLYOFFICE récupère le fichier via une URL signée et renvoie la
version modifiée par un « callback ». Les échanges sont signés en JWT avec un
secret partagé (ONLYOFFICE_JWT_SECRET)."""

import base64
import hashlib
import hmac
import json
import os
import shutil
import time
import urllib.parse
import urllib.request

from converter import sanitize_name, unique_path

DOCS_DIR = os.environ.get("DOCS_DIR", "/documents")
SECRET = os.environ.get("ONLYOFFICE_JWT_SECRET", "")
PUBLIC_URL = os.environ.get("ONLYOFFICE_URL", "").rstrip("/")             # vu par le navigateur (vide = même hôte, port 8081)
INTERNAL_URL = os.environ.get("ONLYOFFICE_INTERNAL_URL", "http://onlyoffice").rstrip("/")  # vu par Bêta Tool
SELF_URL = os.environ.get("BETA_INTERNAL_URL", "http://beta-tool:8080").rstrip("/")         # Bêta Tool vu par ONLYOFFICE
TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")

TYPES = {
    "word": ["docx", "doc", "odt", "rtf", "txt", "docm", "dotx"],
    "cell": ["xlsx", "xls", "ods", "csv", "xlsm"],
    "slide": ["pptx", "ppt", "odp", "ppsx"],
    "pdf": ["pdf"],
}
EDITABLE = {"docx", "docm", "odt", "rtf", "txt", "xlsx", "xlsm", "ods", "csv", "pptx", "odp", "pdf"}
NEW = {"word": ("vierge.docx", "Nouveau document.docx"), "cell": ("vierge.xlsx", "Nouveau tableur.xlsx"),
       "slide": ("vierge.pptx", "Nouvelle présentation.pptx")}


# --- JWT (HS256) ------------------------------------------------------------

def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def jwt_encode(payload):
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{b64(sig)}"


def jwt_decode(token):
    head, body, sig = token.split(".")
    good = hmac.new(SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(good, unb64(sig)):
        raise ValueError("Signature invalide")
    return json.loads(unb64(body))


def sign_url(doc_id, ttl=6 * 3600):
    exp = int(time.time()) + ttl
    sig = hmac.new(SECRET.encode(), f"{doc_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"exp={exp}&sig={sig}"


def check_url(doc_id, exp, sig):
    good = hmac.new(SECRET.encode(), f"{doc_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(good, sig or "") and int(exp or 0) > time.time()


# --- Fichiers ---------------------------------------------------------------

def ext_of(name):
    return os.path.splitext(name)[1].lower().lstrip(".")


def kind_of(name):
    ext = ext_of(name)
    return next((k for k, exts in TYPES.items() if ext in exts), None)


def doc_id(rel):
    return b64(rel.encode())


def resolve(doc):
    """id → chemin absolu, en refusant tout ce qui sort de DOCS_DIR."""
    try:
        rel = unb64(doc).decode()
    except Exception:
        raise ValueError("Document inconnu") from None
    path = os.path.realpath(os.path.join(DOCS_DIR, rel))
    if not path.startswith(os.path.realpath(DOCS_DIR) + os.sep) or not os.path.isfile(path):
        raise ValueError("Document introuvable")
    return path, rel


def info(path):
    rel = os.path.relpath(path, DOCS_DIR)
    st = os.stat(path)
    return {"id": doc_id(rel), "name": os.path.basename(path), "folder": os.path.dirname(rel), "kind": kind_of(path),
            "ext": ext_of(path), "size": st.st_size, "modified": st.st_mtime, "editable": ext_of(path) in EDITABLE}


def list_docs():
    docs = []
    for root, dirs, files in os.walk(DOCS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        docs += [info(os.path.join(root, f)) for f in files if not f.startswith(".") and kind_of(f)]
    return sorted(docs, key=lambda d: -d["modified"])


def create(kind, name):
    if kind not in NEW:
        raise ValueError("Type de document inconnu")
    template, default = NEW[kind]
    ext = os.path.splitext(template)[1]
    name = sanitize_name(name or default)
    if not name.lower().endswith(ext):
        name += ext
    dest = unique_path(DOCS_DIR, name)
    shutil.copy(os.path.join(TEMPLATES, template), dest)
    return info(dest)


def upload(file):
    name = sanitize_name(file.filename)
    if not kind_of(name):
        raise ValueError("Format non pris en charge par Bêta Work")
    dest = unique_path(DOCS_DIR, name)
    file.save(dest)
    return info(dest)


def rename(doc, new_name):
    path, _ = resolve(doc)
    new_name = sanitize_name(new_name)
    if ext_of(new_name) != ext_of(path):
        new_name += "." + ext_of(path)
    dest = unique_path(os.path.dirname(path), new_name)
    os.rename(path, dest)
    return info(dest)


def delete(doc):
    """Déplace dans une corbeille (.corbeille) plutôt que de supprimer pour de bon."""
    path, rel = resolve(doc)
    trash = os.path.join(DOCS_DIR, ".corbeille")
    os.makedirs(trash, exist_ok=True)
    shutil.move(path, unique_path(trash, os.path.basename(path)))


# --- ONLYOFFICE -------------------------------------------------------------

def status():
    if not SECRET:
        return {"ready": False, "reason": "secret"}
    try:
        with urllib.request.urlopen(INTERNAL_URL + "/healthcheck", timeout=3) as r:
            ok = r.read().strip() == b"true"
    except Exception:
        ok = False
    return {"ready": ok, "reason": None if ok else "offline", "public_url": PUBLIC_URL}


def editor_config(doc, user_name, theme, mobile):
    path, rel = resolve(doc)
    st = os.stat(path)
    ext = ext_of(path)
    key = hashlib.sha1(f"{rel}:{st.st_mtime_ns}:{st.st_size}".encode()).hexdigest()[:20]
    user = (user_name or "Invité").strip()[:40]
    config = {
        "type": "mobile" if mobile else "desktop",
        "documentType": kind_of(path),
        "document": {
            "fileType": ext, "key": key, "title": os.path.basename(path),
            "url": f"{SELF_URL}/api/work/{doc}/raw?{sign_url(doc)}",
            "permissions": {"edit": ext in EDITABLE, "download": True, "print": True, "review": True, "comment": True},
        },
        "editorConfig": {
            "mode": "edit" if ext in EDITABLE else "view",
            "lang": "fr", "region": "fr-FR",
            "callbackUrl": f"{SELF_URL}/api/work/{doc}/callback?{sign_url(doc, 30 * 24 * 3600)}",
            "user": {"id": hashlib.sha1(user.encode()).hexdigest()[:12], "name": user},
            "customization": {
                "uiTheme": "theme-dark" if theme == "dark" else "theme-light",
                "compactHeader": True, "compactToolbar": False, "toolbarHideFileName": True,
                "autosave": True, "forcesave": True, "feedback": False, "help": True,
                "hideRightMenu": False,
                "features": {"spellcheck": {"mode": True}},
            },
        },
    }
    config["token"] = jwt_encode(config)
    return config


def callback(doc, body, auth_header):
    """Reçoit l'état du document depuis ONLYOFFICE ; enregistre la nouvelle version (statuts 2 et 6)."""
    path, _ = resolve(doc)
    token = body.get("token") or (auth_header or "").removeprefix("Bearer ").strip()
    data = jwt_decode(token)
    data = data.get("payload", data)
    if data.get("status") in (2, 6) and data.get("url"):
        tmp = path + ".enregistrement"
        url = data["url"]
        try:
            fetch(url, tmp)
        except Exception:
            # L'URL peut désigner l'adresse publique : on retente par le réseau interne Docker
            parts = urllib.parse.urlsplit(url)
            fetch(INTERNAL_URL + parts.path + ("?" + parts.query if parts.query else ""), tmp)
        os.replace(tmp, path)
    return {"error": 0}


def fetch(url, dest):
    with urllib.request.urlopen(url, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def start():
    os.makedirs(DOCS_DIR, exist_ok=True)
