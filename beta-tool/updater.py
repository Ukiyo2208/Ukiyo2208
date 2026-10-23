"""Mises à jour depuis les Réglages : un paquet .zip (manifest.json + dossier app/)
téléversé ou téléchargé depuis un lien, installé dans DATA_DIR/versions, puis le
lanceur redémarre le site sur la nouvelle version. Retour arrière possible.

Le paquet ne contient que le code du site : une mise à jour qui demande de
nouveaux logiciels système (manifest "rebuild": true) doit passer par une
reconstruction de l'image Docker."""

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile

import store

APP_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.environ.get("BETA_BASE_DIR", APP_DIR)
VERSIONS = store.path("versions")
PYLIBS = store.path("pylibs")
MAX_SIZE = 300 * 1024 * 1024


def vtuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0")[:3])


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return None


def current_version():
    return _read(os.path.join(APP_DIR, "VERSION")) or "0"


def builtin_version():
    return _read(os.path.join(BASE_DIR, "VERSION")) or "0"


def history():
    return store.load("versions/history", [])


def info():
    installed = sorted((d for d in os.listdir(VERSIONS) if os.path.isfile(os.path.join(VERSIONS, d, "app", "app.py")))
                       if os.path.isdir(VERSIONS) else [], key=vtuple, reverse=True)
    return {"current": current_version(), "builtin": builtin_version(), "installed": installed,
            "history": history()[-15:][::-1], "launcher": os.environ.get("BETA_LAUNCHER") == "1",
            "bad": store.load("versions/bad", [])}


def restart(delay=1.2):
    """Quitte avec le code 3 : le lanceur relance le site (sur la version choisie)."""
    def go():
        if os.environ.get("BETA_LAUNCHER") == "1":
            os._exit(3)
        os.execv(sys.executable, [sys.executable, *sys.argv])  # sans lanceur (développement)
    threading.Timer(delay, go).start()


def install(data, expected_sha=None, force=False):
    if expected_sha and hashlib.sha256(data).hexdigest() != expected_sha.lower():
        raise ValueError("Le fichier téléchargé ne correspond pas à l'empreinte annoncée (sha256)")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(z.read("manifest.json"))
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise ValueError("Ce fichier n'est pas une mise à jour Bêta Tool valide") from None
    version = str(manifest.get("version", ""))
    if manifest.get("name") != "beta-tool" or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Ce fichier n'est pas une mise à jour Bêta Tool valide")
    if not force and vtuple(version) <= vtuple(current_version()):
        raise ValueError(f"Tu as déjà la version {current_version()} (le paquet contient la {version})")
    if manifest.get("rebuild"):
        raise ValueError("Cette mise à jour demande de reconstruire l'image Docker : "
                         "lance « docker compose build --pull && docker compose up -d » sur le serveur")
    if vtuple(manifest.get("min_builtin", "0")) > vtuple(builtin_version()):
        raise ValueError(f"Cette mise à jour demande une image Docker {manifest['min_builtin']} ou plus récente : reconstruis d'abord l'image")

    dest = os.path.join(VERSIONS, version)
    tmp = dest + ".installation"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    for member in z.infolist():
        name = member.filename
        if not name.startswith("app/") or member.is_dir():
            continue
        parts = name.split("/")
        if ".." in parts or name.startswith("/") or "\\" in name:
            raise ValueError("Paquet refusé : chemin suspect « %s »" % name)
        target = os.path.join(tmp, *parts)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(member) as src, open(target, "wb") as out:
            shutil.copyfileobj(src, out)
    if not os.path.isfile(os.path.join(tmp, "app", "app.py")):
        shutil.rmtree(tmp, ignore_errors=True)
        raise ValueError("Paquet incomplet (app/app.py manquant)")
    if manifest.get("pip"):
        proc = subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--upgrade", "--target", PYLIBS,
                               *manifest["pip"]], capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ValueError("Échec de l'installation des dépendances : " + proc.stderr.strip().splitlines()[-1][:300])
    shutil.rmtree(dest, ignore_errors=True)
    os.replace(tmp, dest)
    use(version, restart_now=False)
    store.update("versions/history", [], lambda h: h.append({
        "version": version, "date": time.strftime("%Y-%m-%d %H:%M"), "notes": manifest.get("notes", [])[:30]}))
    restart()
    return {"version": version, "notes": manifest.get("notes", [])}


def install_url(url, expected_sha=None, force=False):
    if not re.match(r"^https?://", url or ""):
        raise ValueError("Lien invalide")
    req = urllib.request.Request(url, headers={"User-Agent": "Beta-Tool-Updater"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read(MAX_SIZE + 1)
    if len(data) > MAX_SIZE:
        raise ValueError("Fichier trop volumineux")
    if data[:1] == b"{":  # un lien vers un manifeste « latest.json »
        latest = json.loads(data)
        return install_url(urllib.parse.urljoin(url, latest["url"]), latest.get("sha256"), force)
    return install(data, expected_sha, force)


def check(url):
    """Lit un manifeste latest.json : {version, url, notes, sha256}."""
    if not url:
        raise ValueError("Aucune adresse de vérification configurée")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Beta-Tool-Updater"}), timeout=20) as r:
        latest = json.loads(r.read(1024 * 1024))
    latest["url"] = urllib.parse.urljoin(url, latest.get("url", ""))
    return {**latest, "available": vtuple(latest.get("version")) > vtuple(current_version()), "current": current_version()}


def use(version, restart_now=True):
    """Choisit la version lancée : un numéro installé, ou "builtin" (celle de l'image)."""
    if version != "builtin" and not os.path.isfile(os.path.join(VERSIONS, version, "app", "app.py")):
        raise ValueError("Version introuvable")
    os.makedirs(VERSIONS, exist_ok=True)
    store.save("versions/current", {"version": None if version == "builtin" else version})
    store.update("versions/bad", [], lambda bad: bad.remove(version) if version in bad else None)
    if restart_now:
        restart()


def update_ytdlp():
    """Met yt-dlp à jour sans reconstruire l'image (dans DATA_DIR/pylibs, prioritaire au démarrage)."""
    proc = subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--upgrade", "--target", PYLIBS,
                           "yt-dlp[default]"], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise ValueError("Échec : " + (proc.stderr.strip().splitlines() or ["?"])[-1][:300])
    restart()
    return True


def ytdlp_version():
    try:
        import yt_dlp.version
        return yt_dlp.version.__version__
    except Exception:
        return None
