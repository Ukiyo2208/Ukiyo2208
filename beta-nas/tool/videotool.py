"""Outil « Compresseur vidéo » : réduire une vidéo à une taille cible (Discord,
WhatsApp, mail…) ou à un niveau de qualité, la couper et la redimensionner.
Sortie MP4 (H.264 + AAC), lisible partout."""

import os
import shutil

from flask import Blueprint, g, jsonify, request, send_file

import roots
from converter import CONVERT_DIR, ConvertError, LocalFile, probe_duration, run_ffmpeg, unique_path
from jobs import JobQueue

bp = Blueprint("video", __name__)
CRF = {"haute": 20, "bonne": 24, "legere": 28}
SAVE_DIR = os.path.join(CONVERT_DIR, "Vidéos compressées")


def probe_height(src):
    import subprocess
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height",
                          "-of", "csv=p=0", src], capture_output=True, text=True, timeout=30).stdout.strip()
    return int(out) if out.isdigit() else 0


def compress(job, progress):
    o = job["options"]
    src = job["src"]
    total = probe_duration(src)
    if not total:
        raise ConvertError("Impossible de lire la durée de cette vidéo")
    start = max(0.0, float(o.get("start") or 0))
    end = min(total, float(o.get("end") or total)) or total
    duration = end - start
    if duration <= 0.5:
        raise ValueError("La partie à garder est trop courte")
    src_h = probe_height(src)
    height = int(o.get("height") or 0)
    mute = bool(o.get("mute"))
    out_dir = os.path.join(job["work"], "out")
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(job["name"])[0]
    dst = os.path.join(out_dir, f"{stem}-compressee.mp4")
    trim = ["-ss", f"{start:.3f}", "-t", f"{duration:.3f}"] if start or end < total else []
    audio = ["-an"] if mute else ["-c:a", "aac", "-ac", "2"]

    if o.get("mode") == "size":
        target_mb = float(o.get("target_mb") or 25)
        total_kbps = target_mb * 8192 * .96 / duration  # 4 % de marge pour le conteneur
        a_kbps = 0 if mute else (64 if total_kbps < 400 else 96 if total_kbps < 1000 else 128)
        v_kbps = int(total_kbps - a_kbps)
        # Jamais plus lourd que l'original : on plafonne au débit de la vidéo d'origine
        src_kbps = os.path.getsize(src) * 8 / 1024 / total
        v_kbps = int(min(v_kbps, max(150, src_kbps * .85 - a_kbps)))
        if v_kbps < 120:
            raise ValueError(f"{target_mb:g} Mo, c'est trop peu pour {duration:.0f} s de vidéo : coupe-la ou vise plus gros "
                             f"(au moins {((120 + a_kbps) * duration / 8192 / .96):.0f} Mo)")
        if not height:  # moins de débit → image plus petite, pour rester nette
            height = 480 if v_kbps < 600 else 720 if v_kbps < 1500 else 1080
        vf = ["-vf", f"scale=-2:{height}"] if src_h and height < src_h else ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
        common = [*trim, *vf, "-c:v", "libx264", "-preset", "medium", "-b:v", f"{v_kbps}k", "-pix_fmt", "yuv420p"]
        log = os.path.join(job["work"], "passe")
        progress(step="Analyse (passe 1/2)")
        run_ffmpeg(src, os.devnull, [*common, "-pass", "1", "-passlogfile", log, "-an", "-f", "null"],
                   lambda p: progress(progress=round(p / 2, 1)), duration=duration)
        progress(step="Compression (passe 2/2)")
        run_ffmpeg(src, dst, [*common, "-pass", "2", "-passlogfile", log, *audio, *(["-b:a", f"{a_kbps}k"] if a_kbps else []),
                              "-movflags", "+faststart"], lambda p: progress(progress=round(50 + p / 2, 1)), duration=duration)
    else:
        crf = CRF.get(o.get("quality"), 24)
        vf = ["-vf", f"scale=-2:{height}"] if height and src_h and height < src_h else ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"]
        progress(step="Compression")
        run_ffmpeg(src, dst, [*trim, *vf, "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p",
                              *audio, *([] if mute else ["-b:a", "128k"]), "-movflags", "+faststart"],
                   lambda p: progress(progress=round(p, 1)), duration=duration)

    result = {"result": dst, "output": os.path.basename(dst), "size": os.path.getsize(dst),
              "before": os.path.getsize(src), "duration": round(duration, 1)}
    if o.get("save"):
        os.makedirs(SAVE_DIR, exist_ok=True)
        dest = unique_path(SAVE_DIR, os.path.basename(dst))
        shutil.copy2(dst, dest)
        result["saved"] = os.path.relpath(dest, CONVERT_DIR)
    return result


queue = JobQueue("video", compress, workers=1, label="Compression vidéo")


@bp.post("/api/video")
def submit():
    if request.is_json:
        d = request.get_json()
        upload = LocalFile(roots.resolve(d.get("root"), d.get("path")))
        opts = d
    else:
        upload = request.files.get("file")
        if not upload:
            raise ValueError("Aucune vidéo reçue")
        opts = request.form.to_dict()
        opts["mute"] = opts.get("mute") == "1"
        opts["save"] = opts.get("save") == "1"
    keys = ("mode", "target_mb", "quality", "height", "start", "end", "mute", "save")
    return jsonify(id=queue.submit(upload, {k: opts.get(k) for k in keys}, g.user["name"]))


@bp.get("/api/video/jobs")
def jobs_list():
    return jsonify(queue.list(g.user["name"], g.user["role"]))


@bp.get("/api/video/<job_id>/file")
def result(job_id):
    j = queue.result(job_id, g.user["name"], g.user["role"])
    if not j:
        return jsonify(error="Résultat introuvable"), 404
    return send_file(j["result"], as_attachment=request.args.get("dl") != "0", download_name=j["output"], conditional=True)


@bp.delete("/api/video/<job_id>")
def remove(job_id):
    queue.remove(job_id, g.user["name"], g.user["role"])
    return jsonify(ok=True)


def start():
    queue.start()
