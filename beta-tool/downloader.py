"""Outil « Téléchargeur » : récupère une vidéo/playlist (YouTube et ~1800 autres
sites) en meilleure qualité via yt-dlp, dans le dossier du NAS ou seulement le
temps de la récupérer sur son appareil."""

import os
import shutil
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from queue import Queue

import yt_dlp

import activity

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", "/downloads")
# Téléchargements « appareil seulement » : gardés temporairement puis effacés
TMP_DIR = os.path.join(os.environ.get("WORK_DIR", os.path.join(tempfile.gettempdir(), "beta-tool")), "telechargements")
JOB_TTL = float(os.environ.get("JOB_TTL_HOURS", "24")) * 3600

jobs = OrderedDict()
jobs_lock = threading.Lock()
queue = Queue()


def update(job_id, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


def safe_subfolder(value):
    """Empêche de sortir du dossier de téléchargement (../, chemins absolus)."""
    parts = [p for p in str(value or "").replace("\\", "/").split("/") if p not in ("", ".", "..")]
    return os.path.join(*parts) if parts else ""


def build_options(job_id, mode, target):

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = round(d.get("downloaded_bytes", 0) * 100 / total, 1) if total else None
            info = d.get("info_dict") or {}
            update(job_id, status="downloading", progress=pct,
                   title=info.get("title") or jobs[job_id]["title"],
                   speed=d.get("_speed_str", "").strip(), eta=d.get("_eta_str", "").strip())
        elif d["status"] == "finished":
            update(job_id, status="processing", progress=100)

    def moved(d):
        # MoveFiles est la dernière étape : le chemin final du fichier est connu
        if d["status"] == "finished" and d.get("postprocessor") == "MoveFiles":
            path = (d.get("info_dict") or {}).get("filepath")
            if path:
                with jobs_lock:
                    jobs[job_id]["paths"].append(path)

    opts = {
        "outtmpl": os.path.join(target, "%(playlist_title|)s", "%(title)s [%(id)s].%(ext)s"),
        "progress_hooks": [hook],
        "postprocessor_hooks": [moved],
        "noplaylist": False,
        "ignoreerrors": True,
        "windowsfilenames": True,  # noms compatibles SMB/Windows
        "writethumbnail": True,
        "quiet": True,
        "noprogress": True,
    }
    if mode == "audio":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "best"},
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ]
    else:
        # Meilleure vidéo + meilleur audio, sans limite de résolution (4K/8K, HDR…)
        opts["format"] = "bestvideo*+bestaudio/best"
        opts["format_sort"] = ["res", "fps", "hdr:12", "vbr", "abr"]
        opts["merge_output_format"] = "mkv"  # MKV accepte tous les codecs (VP9/AV1/Opus)
        opts["postprocessors"] = [
            {"key": "FFmpegMetadata"},
            {"key": "EmbedThumbnail"},
        ]
    return opts


def worker():
    while True:
        job_id = queue.get()
        job = jobs[job_id]
        update(job_id, status="starting")
        try:
            with yt_dlp.YoutubeDL(build_options(job_id, job["mode"], job["target"])) as ydl:
                code = ydl.download([job["url"]])
            update(job_id, status="done" if code == 0 else "error",
                   error=None if code == 0 else "Certains éléments ont échoué")
            activity.log(job.get("user"), "telecharger", ("Téléchargement terminé : " if code == 0 else "Téléchargement incomplet : ")
                         + jobs[job_id]["title"], "#/telecharger", "ok" if code == 0 else "err")
        except Exception as e:  # noqa: BLE001
            update(job_id, status="error", error=str(e))
            activity.log(job.get("user"), "telecharger", "Échec du téléchargement : " + job["url"], "#/telecharger", "err")
        update(job_id, finished=time.time())
        queue.task_done()


def submit(text, mode, subfolder, keep=True, user="*"):
    urls = [u.strip() for u in str(text or "").split() if u.strip()]
    if not urls or not all(u.startswith(("http://", "https://")) for u in urls):
        raise ValueError("Lien invalide")
    mode = "audio" if mode == "audio" else "video"
    subfolder = safe_subfolder(subfolder)
    created = []
    for url in urls:
        job_id = uuid.uuid4().hex[:8]
        target = (os.path.join(DOWNLOAD_DIR, subfolder) if subfolder else DOWNLOAD_DIR) if keep \
            else os.path.join(TMP_DIR, job_id)
        with jobs_lock:
            jobs[job_id] = {"id": job_id, "url": url, "mode": mode, "subfolder": subfolder if keep else "",
                            "keep": keep, "target": target, "paths": [], "user": user,
                            "title": url, "status": "queued", "progress": 0,
                            "speed": "", "eta": "", "error": None}
        queue.put(job_id)
        created.append(job_id)
    return created


def list_jobs():
    with jobs_lock:
        return [{**{k: v for k, v in j.items() if k not in ("paths", "target", "user")},
                 "files": [os.path.basename(p) for p in j["paths"]]} for j in reversed(jobs.values())]


def file_path(job_id, index):
    with jobs_lock:
        job = jobs.get(job_id)
        paths = list(job["paths"]) if job else []
    if not 0 <= index < len(paths) or not os.path.isfile(paths[index]):
        return None
    return paths[index]


def janitor():
    """Oublie les tâches anciennes et efface les fichiers « appareil seulement »."""
    while True:
        time.sleep(1800)
        now = time.time()
        with jobs_lock:
            old = [j for j in jobs.values() if j.get("finished") and now - j["finished"] > JOB_TTL]
            for j in old:
                del jobs[j["id"]]
        for j in old:
            if not j["keep"]:
                shutil.rmtree(j["target"], ignore_errors=True)


def start(workers):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    threading.Thread(target=janitor, daemon=True).start()
    for _ in range(workers):
        threading.Thread(target=worker, daemon=True).start()
