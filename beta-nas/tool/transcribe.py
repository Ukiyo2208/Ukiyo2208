"""Outil « Transcription » : audio ou vidéo → texte et sous-titres (SRT, VTT),
avec faster-whisper, en local. Le modèle (WHISPER_MODEL, « small » par défaut)
est téléchargé au premier usage dans DATA_DIR/models."""

import json
import os
import shutil
import threading

from flask import Blueprint, g, jsonify, request, send_file

import roots
import store
from converter import CONVERT_DIR, LocalFile, unique_path
from jobs import JobQueue

bp = Blueprint("transcription", __name__)
MODELS = {"tiny": "Très rapide, approximatif", "base": "Rapide", "small": "Bon compromis (recommandé)",
          "medium": "Précis mais lent", "large-v3": "Le plus précis, très lent sur un NAS"}
DEFAULT = os.environ.get("WHISPER_MODEL", "small")
MODEL_DIR = store.path("models", "whisper")
SAVE_DIR = os.path.join(CONVERT_DIR, "Transcriptions")
_models, _lock = {}, threading.Lock()


def model(name):
    from faster_whisper import WhisperModel  # import tardif : lourd, et seulement si l'outil sert
    with _lock:
        if name not in _models:
            _models.clear()  # un seul modèle en mémoire à la fois
            try:
                _models[name] = WhisperModel(name, device="cpu", compute_type="int8", download_root=MODEL_DIR,
                                             cpu_threads=os.cpu_count() or 4)
            except Exception as e:
                if os.path.isdir(name):
                    raise
                raise ValueError(f"Impossible de charger le modèle « {name} » : au premier usage il est téléchargé depuis "
                                 f"Internet (huggingface.co), vérifie la connexion du NAS. Détail : {e}") from None
        return _models[name]


def decode(src):
    """Son du fichier en 16 kHz mono (ce qu'attend Whisper), décodé par FFmpeg."""
    import subprocess
    import numpy as np
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                          capture_output=True, timeout=7200)
    if proc.returncode != 0 or not proc.stdout:
        raise ValueError("Impossible de lire le son de ce fichier : " + proc.stderr.decode(errors="replace").strip()[-200:])
    return np.frombuffer(proc.stdout, np.float32)


def stamp(t, sep=","):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}{sep}{int(round((s % 1) * 1000)) % 1000:03d}"


def run(job, progress):
    o = job["options"]
    name = o.get("model") if o.get("model") in MODELS or o.get("model") == DEFAULT else DEFAULT
    progress(step="Chargement du modèle (téléchargé au premier usage)…")
    m = model(name)
    progress(step="Lecture du son…", progress=0)
    audio = decode(job["src"])
    progress(step="Transcription…")
    segments, info = m.transcribe(audio, language=o.get("language") or None, task=o.get("task") or "transcribe",
                                  vad_filter=True, beam_size=5)
    out = []
    for seg in segments:
        out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        if info.duration:
            progress(progress=round(min(99, seg.end / info.duration * 100), 1))
    work = os.path.join(job["work"], "out")
    os.makedirs(work, exist_ok=True)
    stem = os.path.splitext(job["name"])[0]
    files = {
        "txt": "\n".join(s["text"] for s in out) + "\n",
        "srt": "\n".join(f"{i}\n{stamp(s['start'])} --> {stamp(s['end'])}\n{s['text']}\n" for i, s in enumerate(out, 1)),
        "vtt": "WEBVTT\n\n" + "\n".join(f"{stamp(s['start'], '.')} --> {stamp(s['end'], '.')}\n{s['text']}\n" for s in out),
    }
    for ext, text in files.items():
        with open(os.path.join(work, f"{stem}.{ext}"), "w", encoding="utf-8") as f:
            f.write(text)
    with open(os.path.join(work, "segments.json"), "w", encoding="utf-8") as f:
        json.dump({"language": info.language, "duration": info.duration, "segments": out}, f, ensure_ascii=False)
    saved = None
    if o.get("save"):
        # À côté de la vidéo d'origine (sous-titres reconnus par Plex/Jellyfin), sinon dans Conversions/Transcriptions
        folder = os.path.dirname(job["source"]) if job.get("source") else SAVE_DIR
        os.makedirs(folder, exist_ok=True)
        dest = unique_path(folder, f"{stem}.{o.get('save_format') or 'srt'}")
        shutil.copy2(os.path.join(work, f"{stem}.{o.get('save_format') or 'srt'}"), dest)
        saved = dest
    return {"result": os.path.join(work, "segments.json"), "output": stem, "language": info.language,
            "duration": round(info.duration or 0), "saved": os.path.basename(saved) if saved else None,
            "words": sum(len(s["text"].split()) for s in out)}


queue = JobQueue("transcription", run, workers=1, label="Transcription")


@bp.get("/api/transcribe/models")
def models():
    try:
        import faster_whisper  # noqa: F401
        ok = True
    except ImportError:
        ok = False
    models_ = dict(MODELS)
    if DEFAULT not in MODELS:  # WHISPER_MODEL pointe vers un modèle personnalisé (dossier)
        models_ = {DEFAULT: "Modèle personnalisé (WHISPER_MODEL)", **models_}
    return jsonify(available=ok, default=DEFAULT, models=models_,
                   downloaded=[d.split("--")[-1].replace("faster-whisper-", "") for d in os.listdir(MODEL_DIR)] if os.path.isdir(MODEL_DIR) else [])


@bp.post("/api/transcribe")
def submit():
    if request.is_json:
        d = request.get_json()
        upload, opts = LocalFile(roots.resolve(d.get("root"), d.get("path"))), d
    else:
        upload = request.files.get("file")
        if not upload:
            raise ValueError("Aucun fichier reçu")
        opts = request.form.to_dict()
        opts["save"] = opts.get("save") == "1"
    keys = ("model", "language", "task", "save", "save_format")
    return jsonify(id=queue.submit(upload, {k: opts.get(k) for k in keys}, g.user["name"]))


@bp.get("/api/transcribe/jobs")
def jobs_list():
    return jsonify(queue.list(g.user["name"], g.user["role"]))


@bp.get("/api/transcribe/<job_id>")
def result(job_id):
    j = queue.result(job_id, g.user["name"], g.user["role"])
    if not j:
        return jsonify(error="Résultat introuvable"), 404
    with open(j["result"], encoding="utf-8") as f:
        return jsonify(json.load(f))


@bp.get("/api/transcribe/<job_id>/<fmt>")
def download(job_id, fmt):
    j = queue.result(job_id, g.user["name"], g.user["role"])
    if not j or fmt not in ("txt", "srt", "vtt"):
        return jsonify(error="Résultat introuvable"), 404
    path = os.path.join(os.path.dirname(j["result"]), f"{j['output']}.{fmt}")
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


@bp.delete("/api/transcribe/<job_id>")
def remove(job_id):
    queue.remove(job_id, g.user["name"], g.user["role"])
    return jsonify(ok=True)


def start():
    os.makedirs(MODEL_DIR, exist_ok=True)
    queue.start()
