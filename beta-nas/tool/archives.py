"""Outil « Décompresseur » : ouvre une archive (zip, rar, 7z, tar.gz…), liste son
contenu, puis extrait tout ou partie sur le NAS ou en téléchargement.

7-Zip gère zip/7z/rar/iso… ; les archives tar (.tar.gz, .tgz, .tar.xz…) passent
par bsdtar, qui les lit en une seule fois au lieu de deux niveaux."""

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import zipfile

from converter import ConvertError, WORK_DIR, error_tail, sanitize_name, unique_path
from downloader import safe_subfolder

UNZIP_DIR = os.environ.get("UNZIP_DIR", "/extracted")
MAX_EXTRACT = float(os.environ.get("MAX_EXTRACT_GB", "50")) * 1024 ** 3
JOB_TTL = float(os.environ.get("JOB_TTL_HOURS", "24")) * 3600
SEVEN = shutil.which("7zz") or shutil.which("7z") or "7z"
TAR_RE = re.compile(r"\.(tar|tgz|tbz2?|txz|tar\.(gz|bz2|xz|zst|lz4|lzma))$", re.I)
EXTENSIONS = ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "cab", "arj", "lzh", "wim", "cbz", "cbr"]

archives = {}
lock = threading.Lock()


class PasswordNeeded(Exception):
    pass


def is_tar(name):
    return bool(TAR_RE.search(name))


def norm(path):
    """Chemin tel que les outils l'extraient : sans « / » de tête ni « .. »."""
    return "/".join(p for p in path.replace("\\", "/").split("/") if p not in ("", ".", ".."))


def run7(args, password, timeout=3600):
    # -p sans valeur ferait attendre une saisie : on passe toujours un mot de passe (éventuellement vide)
    proc = subprocess.run([SEVEN, *args, "-p" + (password or ""), "-y", "-sccUTF-8"], capture_output=True,
                          text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        if re.search(r"Wrong password|encrypted archive|Data Error in encrypted", out, re.I):
            raise PasswordNeeded()
        # 7-Zip signale les liens dangereux qu'il a ignorés : le reste est bien extrait
        errors = [l for l in out.splitlines() if l.startswith("ERROR:") and "Dangerous link path was ignored" not in l]
        if errors or proc.returncode > 2:
            raise ConvertError(error_tail(proc.stderr or proc.stdout))
    return proc.stdout


def list_entries(path, name, password):
    if is_tar(name):
        out = subprocess.run(["bsdtar", "-tvf", path], capture_output=True, text=True, timeout=600)
        if out.returncode != 0:
            raise ConvertError(error_tail(out.stderr))
        entries = []
        for line in out.stdout.splitlines():
            parts = line.split(None, 8)
            if len(parts) < 9:
                continue
            p = parts[8].split(" -> ")[0].rstrip("/")
            entries.append({"path": p, "size": int(parts[4]) if parts[4].isdigit() else 0,
                            "dir": line.startswith("d"), "enc": False, "link": line.startswith("l")})
        return entries
    entries, cur = [], {}
    for line in run7(["l", "-slt", "-ba", path], password).splitlines() + [""]:
        if not line.strip():
            if cur.get("Path"):
                entries.append({"path": cur["Path"].replace("\\", "/"), "size": int(cur.get("Size") or 0),
                                "dir": cur.get("Folder") == "+" or cur.get("Attributes", "").startswith("D"),
                                "enc": cur.get("Encrypted") == "+", "link": cur.get("Attributes", "").strip().startswith("l")})
            cur = {}
        elif " = " in line:
            k, v = line.split(" = ", 1)
            cur[k.strip()] = v
    return entries


def inspect(upload):
    name = sanitize_name(upload.filename)
    aid = uuid.uuid4().hex[:10]
    work = os.path.join(WORK_DIR, "arc-" + aid)
    os.makedirs(work)
    path = os.path.join(work, name)
    upload.save(path)
    with lock:
        archives[aid] = {"id": aid, "name": name, "path": path, "work": work, "password": "", "created": time.time()}
    return describe(aid, "")


def describe(aid, password):
    a = get(aid)
    try:
        entries = list_entries(a["path"], a["name"], password)
    except PasswordNeeded:
        return {"id": aid, "name": a["name"], "need_password": True, "wrong": bool(password)}
    a["password"] = password
    # Des fichiers chiffrés mais une liste lisible : il faudra le mot de passe pour extraire
    encrypted = any(e["enc"] for e in entries)
    files = [e for e in entries if not e["dir"]]
    return {"id": aid, "name": a["name"], "need_password": False, "encrypted": encrypted,
            "entries": entries, "count": len(files), "total": sum(e["size"] for e in files)}


def get(aid):
    with lock:
        a = archives.get(aid)
    if not a:
        raise ValueError("Archive expirée : renvoie-la")
    return a


def extract_all(a, password):
    out = os.path.join(a["work"], "out")
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    if is_tar(a["name"]):
        proc = subprocess.run(["bsdtar", "-xf", a["path"], "-C", out, "--no-same-owner", "--no-same-permissions"],
                              capture_output=True, text=True, timeout=3600)
        if proc.returncode != 0:
            raise ConvertError(error_tail(proc.stderr))
    else:
        run7(["x", a["path"], "-o" + out], password)
    # Sécurité : rien en dehors du dossier, pas de liens symboliques
    root = os.path.realpath(out)
    for dirpath, dirnames, filenames in os.walk(out):
        for n in dirnames + filenames:
            p = os.path.join(dirpath, n)
            if os.path.islink(p) or not os.path.realpath(p).startswith(root + os.sep):
                os.unlink(p) if os.path.islink(p) or os.path.isfile(p) else shutil.rmtree(p, ignore_errors=True)
    return out


def extract(aid, paths, dest, subfolder, password):
    a = get(aid)
    password = password if password is not None else a["password"]
    info = describe(aid, password)
    if info["need_password"]:
        raise ValueError("Mot de passe incorrect" if password else "Cette archive demande un mot de passe")
    wanted = {norm(p) for p in paths} if paths else None
    if wanted is not None and not wanted:
        raise ValueError("Aucun fichier sélectionné")
    total = sum(e["size"] for e in info["entries"] if not e["dir"])
    if total > MAX_EXTRACT:
        raise ValueError(f"Archive trop grosse une fois décompressée ({total / 1024 ** 3:.1f} Go, limite {MAX_EXTRACT / 1024 ** 3:.0f} Go)")
    if total > shutil.disk_usage(WORK_DIR).free * .9:
        raise ValueError("Pas assez d'espace disque pour décompresser cette archive")
    try:
        out = extract_all(a, password)
    except PasswordNeeded:
        raise ValueError("Mot de passe incorrect" if password else "Cette archive demande un mot de passe") from None
    # On ne travaille que sur ce qui a réellement été extrait dans `out`
    extracted = sorted(os.path.relpath(os.path.join(d, f), out).replace(os.sep, "/")
                       for d, _, fs in os.walk(out) for f in fs)
    chosen = [p for p in extracted if wanted is None or p in wanted or any(p.startswith(w + "/") for w in wanted)]
    if not chosen:
        shutil.rmtree(out, ignore_errors=True)
        raise ValueError("Aucun fichier sélectionné")
    stem = re.sub(TAR_RE.pattern + r"|\.[^.]+$", "", a["name"], flags=re.I) or "archive"

    if dest == "server":
        base = os.path.join(UNZIP_DIR, safe_subfolder(subfolder) if subfolder else "")
        os.makedirs(base, exist_ok=True)
        target = unique_path(base, sanitize_name(stem)) if not subfolder else base
        for rel in chosen:
            dst = os.path.join(target, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(os.path.join(out, rel), unique_path(os.path.dirname(dst), os.path.basename(dst)))
        shutil.rmtree(out, ignore_errors=True)
        return {"saved": os.path.relpath(target, UNZIP_DIR), "count": len(chosen)}

    # Téléchargement : un seul fichier tel quel, sinon un zip de la sélection
    if len(chosen) == 1:
        result = os.path.join(a["work"], os.path.basename(chosen[0]))
        shutil.move(os.path.join(out, chosen[0]), result)
    else:
        result = os.path.join(a["work"], stem + ".zip")
        with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            for rel in chosen:
                z.write(os.path.join(out, rel), rel)
    shutil.rmtree(out, ignore_errors=True)
    a["result"] = result
    return {"download": f"/api/archive/{aid}/file", "name": os.path.basename(result), "count": len(chosen),
            "size": os.path.getsize(result)}


def result_path(aid):
    with lock:
        a = archives.get(aid)
    return a and a.get("result")


def janitor():
    while True:
        time.sleep(1800)
        now = time.time()
        with lock:
            old = [a for a in archives.values() if now - a["created"] > JOB_TTL]
            for a in old:
                del archives[a["id"]]
        for a in old:
            shutil.rmtree(a["work"], ignore_errors=True)


def start():
    os.makedirs(UNZIP_DIR, exist_ok=True)
    threading.Thread(target=janitor, daemon=True).start()
