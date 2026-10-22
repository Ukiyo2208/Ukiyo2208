"""Outil « Téléchargeur » : récupère une vidéo/playlist (YouTube et ~1800 autres
sites) en meilleure qualité via yt-dlp, directement dans le dossier du NAS."""

import os
import threading
import uuid
from collections import OrderedDict
from queue import Queue

import yt_dlp

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", "/downloads")

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


def build_options(job_id, mode, subfolder):
    target = os.path.join(DOWNLOAD_DIR, subfolder) if subfolder else DOWNLOAD_DIR

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

    opts = {
        "outtmpl": os.path.join(target, "%(playlist_title|)s", "%(title)s [%(id)s].%(ext)s"),
        "progress_hooks": [hook],
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
            with yt_dlp.YoutubeDL(build_options(job_id, job["mode"], job["subfolder"])) as ydl:
                code = ydl.download([job["url"]])
            update(job_id, status="done" if code == 0 else "error",
                   error=None if code == 0 else "Certains éléments ont échoué")
        except Exception as e:  # noqa: BLE001
            update(job_id, status="error", error=str(e))
        queue.task_done()


def submit(text, mode, subfolder):
    urls = [u.strip() for u in str(text or "").split() if u.strip()]
    if not urls or not all(u.startswith(("http://", "https://")) for u in urls):
        raise ValueError("Lien invalide")
    mode = "audio" if mode == "audio" else "video"
    subfolder = safe_subfolder(subfolder)
    created = []
    for url in urls:
        job_id = uuid.uuid4().hex[:8]
        with jobs_lock:
            jobs[job_id] = {"id": job_id, "url": url, "mode": mode, "subfolder": subfolder,
                            "title": url, "status": "queued", "progress": 0,
                            "speed": "", "eta": "", "error": None}
        queue.put(job_id)
        created.append(job_id)
    return created


def list_jobs():
    with jobs_lock:
        return list(reversed(jobs.values()))


def start(workers):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    for _ in range(workers):
        threading.Thread(target=worker, daemon=True).start()
