"""Outil « Sauvegardes » (administrateurs) : copie planifiée de dossiers du NAS
vers BACKUP_DIR (disque USB, autre volume…) avec rsync.

- incrémental : un instantané daté par sauvegarde ; les fichiers inchangés sont
  des liens physiques vers l'instantané précédent (chaque version complète ne
  coûte que la place des fichiers modifiés) ; on garde les N derniers ;
- miroir : une seule copie à jour (les suppressions sont répercutées)."""

import os
import re
import secrets
import shutil
import subprocess
import threading
import time

from flask import Blueprint, g, jsonify, request

import activity
import roots
import store

bp = Blueprint("backup", __name__)
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backup")
SNAP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{4}$")
EXCLUDES = ["@eaDir", "#recycle", ".corbeille", "*.tmp", ".DS_Store", "Thumbs.db"]
running = {}
_run_lock = threading.Lock()


@bp.before_request
def admins_only():
    if g.user["role"] != "admin":
        raise PermissionError("Réservé aux administrateurs")


def jobs():
    return store.load("backups", {"jobs": []})["jobs"]


def target(job):
    return os.path.join(BACKUP_DIR, re.sub(r"[^\w .-]", "_", job["name"]).strip() or job["id"])


def snapshots(job):
    base = target(job)
    if not os.path.isdir(base):
        return []
    return sorted((d for d in os.listdir(base) if SNAP_RE.match(d)), reverse=True)


def rsync(src, dest, link_dest=None, delete=True):
    cmd = ["rsync", "-a", "--stats", "--human-readable", *[f"--exclude={e}" for e in EXCLUDES]]
    if delete:
        cmd.append("--delete")
    if link_dest:
        cmd.append(f"--link-dest={link_dest}")
    os.makedirs(dest, exist_ok=True)
    proc = subprocess.run([*cmd, src.rstrip("/") + "/", dest.rstrip("/") + "/"], capture_output=True, text=True, timeout=24 * 3600)
    if proc.returncode not in (0, 24):  # 24 : des fichiers ont disparu pendant la copie (sans gravité)
        raise RuntimeError((proc.stderr.strip().splitlines() or ["rsync a échoué"])[-1])
    stats = {}
    for line in proc.stdout.splitlines():
        if line.startswith("Number of regular files transferred"):
            stats["files"] = int(re.sub(r"\D", "", line.split(":")[1]) or 0)
        if line.startswith("Total transferred file size"):
            stats["size"] = line.split(":")[1].strip().split(" bytes")[0]
    return stats


def run(job_id, user):
    job = next((j for j in jobs() if j["id"] == job_id), None)
    if not job:
        return
    with _run_lock:
        if job_id in running:
            return
        running[job_id] = time.time()
    started = time.time()
    result = {"at": started, "status": "ok", "files": 0, "size": "0", "message": ""}
    try:
        if not os.path.isdir(BACKUP_DIR):
            raise RuntimeError(f"Destination absente : monte un disque sur {BACKUP_DIR} (voir le README)")
        base = target(job)
        sizes = []
        if job["mode"] == "mirror":
            for rid in job["sources"]:
                st = rsync(roots.get(rid)["path"], os.path.join(base, "miroir", rid))
                result["files"] += st.get("files", 0)
                sizes.append(st.get("size", "0"))
        else:
            previous = snapshots(job)
            snap = os.path.join(base, time.strftime("%Y-%m-%d_%H%M"))
            for rid in job["sources"]:
                link = os.path.join(base, previous[0], rid) if previous and os.path.isdir(os.path.join(base, previous[0], rid)) else None
                st = rsync(roots.get(rid)["path"], os.path.join(snap, rid), link_dest=link)
                result["files"] += st.get("files", 0)
                sizes.append(st.get("size", "0"))
            for old in snapshots(job)[max(1, int(job.get("keep") or 7)):]:
                shutil.rmtree(os.path.join(base, old), ignore_errors=True)
        result["size"] = " + ".join(sizes)
        result["message"] = f"{result['files']} fichier(s) copié(s)"
    except Exception as e:  # noqa: BLE001
        result.update(status="error", message=str(e))
    finally:
        result["duration"] = round(time.time() - started)
        running.pop(job_id, None)

    def save_last(data):
        for j in data["jobs"]:
            if j["id"] == job_id:
                j["last"] = result
    store.update("backups", {"jobs": []}, save_last)
    activity.log(user or job.get("owner", "*"), "sauvegardes",
                 f"Sauvegarde « {job['name']} » : " + (result["message"] if result["status"] == "ok" else "échec — " + result["message"]),
                 "#/sauvegardes", "ok" if result["status"] == "ok" else "err")


def scheduler():
    """Vérifie toutes les 30 s si une sauvegarde doit partir (heure et jour programmés)."""
    while True:
        time.sleep(30)
        now = time.localtime()
        hhmm = time.strftime("%H:%M", now)
        for j in jobs():
            last = (j.get("last") or {}).get("at", 0)
            if j.get("enabled") and j.get("time") == hhmm and now.tm_wday in j.get("days", []) and time.time() - last > 120:
                threading.Thread(target=run, args=(j["id"], None), daemon=True).start()


@bp.get("/api/backup")
def overview():
    ok = os.path.isdir(BACKUP_DIR)
    usage = shutil.disk_usage(BACKUP_DIR) if ok else None
    out = []
    for j in jobs():
        out.append({**j, "running": j["id"] in running, "snapshots": snapshots(j)[:30]})
    sources = [{"id": r["id"], "label": r["label"]} for r in roots.all_roots() if r["id"] != "sauvegardes"]
    return jsonify(jobs=out, sources=sources, dest={"ok": ok, "path": BACKUP_DIR, "free": usage.free if usage else None,
                                                    "total": usage.total if usage else None}, rsync=bool(shutil.which("rsync")))


@bp.post("/api/backup")
def save():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    sources = [s for s in d.get("sources") or [] if any(r["id"] == s for r in roots.all_roots()) and s != "sauvegardes"]
    if not name or not sources:
        raise ValueError("Donne un nom et choisis au moins un dossier à sauvegarder")
    if not re.fullmatch(r"\d{2}:\d{2}", str(d.get("time") or "")):
        raise ValueError("Heure invalide")
    job = {"id": d.get("id") or secrets.token_hex(4), "name": name, "sources": sources, "mode": "mirror" if d.get("mode") == "mirror" else "incremental",
           "time": d["time"], "days": sorted({int(x) for x in d.get("days", []) if 0 <= int(x) <= 6}), "keep": max(1, min(365, int(d.get("keep") or 7))),
           "enabled": bool(d.get("enabled", True)), "owner": g.user["name"]}

    def go(data):
        old = next((j for j in data["jobs"] if j["id"] == job["id"]), None)
        if old:
            job["last"] = old.get("last")
            data["jobs"][data["jobs"].index(old)] = job
        else:
            data["jobs"].append(job)
    store.update("backups", {"jobs": []}, go)
    return jsonify(job)


@bp.delete("/api/backup/<job_id>")
def delete(job_id):
    store.update("backups", {"jobs": []}, lambda data: data.__setitem__("jobs", [j for j in data["jobs"] if j["id"] != job_id]))
    return jsonify(ok=True, note="Les copies déjà faites restent sur le disque de sauvegarde")


@bp.post("/api/backup/<job_id>/run")
def run_now(job_id):
    if job_id in running:
        raise ValueError("Cette sauvegarde est déjà en cours")
    threading.Thread(target=run, args=(job_id, g.user["name"]), daemon=True).start()
    return jsonify(ok=True)


def start():
    threading.Thread(target=scheduler, daemon=True).start()
