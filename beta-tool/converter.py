"""Outil « Convertisseur » : transforme un fichier d'un format vers un autre.

Chaque moteur déclare les extensions qu'il lit et celles qu'il produit. Pour un
couple (entrée, sortie), le premier moteur de ENGINES qui sait le faire gagne,
donc l'ordre de la liste fixe les priorités (ex. DOCX → PDF passe par
LibreOffice, EPUB → MOBI par Calibre, DOCX → Markdown par Pandoc)."""

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from queue import Queue

from PIL import Image, ImageOps, ImageSequence
from pillow_heif import register_heif_opener

import activity
from downloader import safe_subfolder

register_heif_opener()

CONVERT_DIR = os.environ.get("CONVERT_DIR", "/converted")
WORK_DIR = os.environ.get("WORK_DIR", os.path.join(tempfile.gettempdir(), "beta-tool"))
JOB_TTL = float(os.environ.get("JOB_TTL_HOURS", "24")) * 3600

ALIASES = {"jpeg": "jpg", "tif": "tiff", "htm": "html", "markdown": "md", "heif": "heic", "oga": "ogg"}

VIDEO_IN = ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v", "mpg", "mpeg", "ts", "m2ts", "3gp", "ogv", "gif"]
AUDIO_IN = ["mp3", "wav", "flac", "aac", "m4a", "ogg", "opus", "wma", "aiff", "aif", "amr", "ac3", "mka"]
AUDIO_OUT = ["mp3", "m4a", "wav", "flac", "ogg", "opus", "aiff"]

ENGINES = [
    {"id": "video", "label": "Vidéo", "tool": "FFmpeg",
     "inputs": VIDEO_IN, "outputs": ["mp4", "mkv", "mov", "webm", "avi", "gif"] + AUDIO_OUT},
    {"id": "audio", "label": "Audio", "tool": "FFmpeg",
     "inputs": AUDIO_IN, "outputs": AUDIO_OUT},
    {"id": "image", "label": "Image", "tool": "Pillow",
     "inputs": ["jpg", "png", "webp", "gif", "bmp", "tiff", "heic", "avif", "ico", "svg", "psd", "tga", "ppm"],
     "outputs": ["jpg", "png", "webp", "avif", "heic", "gif", "bmp", "tiff", "ico", "pdf"]},
    {"id": "pdf", "label": "PDF", "tool": "Poppler",
     "inputs": ["pdf"], "outputs": ["png", "jpg", "txt"]},
    {"id": "writer", "label": "Document", "tool": "LibreOffice",
     "inputs": ["doc", "docx", "odt", "rtf", "txt", "wpd", "pages"],
     "outputs": ["pdf", "docx", "odt", "doc", "rtf", "txt", "html"]},
    {"id": "calc", "label": "Tableur", "tool": "LibreOffice",
     "inputs": ["xls", "xlsx", "ods", "csv", "numbers"], "outputs": ["xlsx", "ods", "xls", "csv", "pdf", "html"]},
    {"id": "impress", "label": "Présentation", "tool": "LibreOffice",
     "inputs": ["ppt", "pptx", "odp", "key"], "outputs": ["pptx", "odp", "ppt", "pdf"]},
    {"id": "web", "label": "Page web", "tool": "LibreOffice",
     "inputs": ["html"], "outputs": ["pdf"]},
    {"id": "ebook", "label": "Livre numérique", "tool": "Calibre",
     "inputs": ["epub", "mobi", "azw", "azw3", "fb2", "lit", "pdb", "cbz", "cbr", "pdf", "docx", "odt", "rtf", "txt", "html"],
     "outputs": ["epub", "mobi", "azw3", "pdf", "fb2", "docx", "rtf", "txt"]},
    {"id": "pandoc", "label": "Texte balisé", "tool": "Pandoc",
     "inputs": ["md", "html", "rst", "tex", "org", "ipynb", "docx", "odt", "epub", "txt"],
     "outputs": ["md", "html", "docx", "odt", "epub", "rst", "tex", "txt", "pdf"]},
]


class ConvertError(Exception):
    pass


class LocalFile:
    """Fichier déjà présent sur le NAS, utilisable comme un fichier envoyé (filename + save)."""

    def __init__(self, path):
        self.path = path
        self.filename = os.path.basename(path)

    def save(self, dest):
        try:
            os.link(self.path, dest)  # lien physique : instantané, sans doubler la place
        except OSError:
            shutil.copy2(self.path, dest)


def normalize_ext(ext):
    ext = ext.lower().lstrip(".")
    return ALIASES.get(ext, ext)


def find_engine(ext, target):
    for engine in ENGINES:
        if ext in engine["inputs"] and target in engine["outputs"]:
            return engine
    return None


def sanitize_name(name):
    name = os.path.basename(str(name or "").replace("\\", "/"))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name[:150] or "fichier"


def unique_path(folder, name):
    stem, ext = os.path.splitext(name)
    path, n = os.path.join(folder, name), 1
    while os.path.exists(path):
        path = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return path


def run(cmd, timeout=1800, env=None):
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              env={**os.environ, **(env or {})})
    except subprocess.TimeoutExpired:
        raise ConvertError("Délai dépassé") from None
    if proc.returncode != 0:
        raise ConvertError(error_tail(proc.stderr or proc.stdout))
    return proc


def error_tail(text):
    lines = [l for l in (text or "").strip().splitlines() if l.strip()]
    return " / ".join(lines[-2:])[:300] or "Erreur inconnue"


# --- FFmpeg (vidéo / audio) -------------------------------------------------

EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
H264 = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-vf", EVEN,
        "-c:a", "aac", "-b:a", "192k"]
FFMPEG_ARGS = {
    "mp4": ["-map", "0:v:0", "-map", "0:a?"] + H264 + ["-movflags", "+faststart"],
    "mov": ["-map", "0:v:0", "-map", "0:a?"] + H264,
    "webm": ["-map", "0:v:0", "-map", "0:a?", "-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0",
             "-row-mt", "1", "-c:a", "libopus", "-b:a", "160k"],
    "avi": ["-map", "0:v:0", "-map", "0:a?", "-c:v", "mpeg4", "-q:v", "2", "-c:a", "libmp3lame", "-q:a", "2"],
    "gif": ["-an", "-vf", "fps=15,scale='min(720,iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
            "-loop", "0"],
    "mp3": ["-vn", "-c:a", "libmp3lame", "-q:a", "0"],
    "m4a": ["-vn", "-c:a", "aac", "-b:a", "256k"],
    "wav": ["-vn", "-c:a", "pcm_s16le"],
    "flac": ["-vn", "-c:a", "flac"],
    "ogg": ["-vn", "-c:a", "libvorbis", "-q:a", "7"],
    "opus": ["-vn", "-c:a", "libopus", "-b:a", "192k"],
    "aiff": ["-vn", "-c:a", "pcm_s16be"],
}


def probe_duration(src):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                             capture_output=True, text=True, timeout=60).stdout
        return float(out.strip())
    except (ValueError, subprocess.SubprocessError):
        return 0


def run_ffmpeg(src, dst, args, on_progress):
    duration = probe_duration(src)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, *args,
           "-progress", "pipe:1", "-nostats", dst]
    with tempfile.TemporaryFile("w+") as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err, text=True)
        for line in proc.stdout:
            if line.startswith("out_time_us=") and duration:
                try:
                    on_progress(min(99, int(line.split("=")[1]) / 1e6 / duration * 100))
                except ValueError:
                    pass
        if proc.wait() != 0:
            err.seek(0)
            raise ConvertError(error_tail(err.read()))


def convert_ffmpeg(src, out_dir, stem, target, on_progress):
    dst = os.path.join(out_dir, f"{stem}.{target}")
    if target == "mkv":
        # MKV accepte presque tous les codecs : on tente une copie sans perte d'abord
        try:
            run_ffmpeg(src, dst, ["-map", "0", "-c", "copy"], on_progress)
            return dst
        except ConvertError:
            pass
        run_ffmpeg(src, dst, ["-map", "0:v:0", "-map", "0:a?"] + H264, on_progress)
        return dst
    run_ffmpeg(src, dst, FFMPEG_ARGS[target], on_progress)
    return dst


# --- Images (Pillow) --------------------------------------------------------

PIL_FORMATS = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP", "avif": "AVIF", "heic": "HEIF", "gif": "GIF",
               "bmp": "BMP", "tiff": "TIFF", "ico": "ICO", "pdf": "PDF"}


def flatten(im):
    """Supprime la transparence (fond blanc) pour les formats qui ne la gèrent pas."""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def convert_image(src, out_dir, stem, ext, target):
    if ext == "svg":
        png = os.path.join(out_dir, "_svg.png")
        run(["rsvg-convert", "-f", "png", "-o", png, src], timeout=120)
        src = png
    dst = os.path.join(out_dir, f"{stem}.{target}")
    with Image.open(src) as im:
        animated = getattr(im, "n_frames", 1) > 1
        if animated and target in ("gif", "webp", "pdf", "tiff"):
            frames = [ImageOps.exif_transpose(f.copy()) for f in ImageSequence.Iterator(im)]
            if target == "pdf":
                frames = [flatten(f) for f in frames]
            extra = {"duration": im.info.get("duration", 100), "loop": 0} if target in ("gif", "webp") else {}
            frames[0].save(dst, PIL_FORMATS[target], save_all=True, append_images=frames[1:], **extra)
            return dst
        im = ImageOps.exif_transpose(im)
        opts = {}
        if target in ("jpg", "bmp", "pdf"):
            im = flatten(im)
            opts = {"quality": 92, "subsampling": 0} if target == "jpg" else {}
        elif target == "webp":
            opts = {"quality": 90, "method": 4}
        elif target in ("avif", "heic"):
            opts = {"quality": 85}
        elif target == "tiff":
            opts = {"compression": "tiff_lzw"}
        elif target == "ico":
            opts = {"sizes": [(s, s) for s in (16, 32, 48, 64, 128, 256) if s <= max(im.size)] or [(16, 16)]}
        if im.mode not in ("RGB", "RGBA", "L", "LA", "P"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        im.save(dst, PIL_FORMATS[target], **opts)
    return dst


# --- PDF (Poppler) ----------------------------------------------------------

def convert_pdf(src, out_dir, stem, target):
    if target == "txt":
        dst = os.path.join(out_dir, f"{stem}.txt")
        run(["pdftotext", "-layout", src, dst])
        return dst
    pages_dir = os.path.join(out_dir, "pages")
    os.makedirs(pages_dir)
    run(["pdftoppm", "-r", "150", "-png" if target == "png" else "-jpeg", src, os.path.join(pages_dir, stem)])
    pages = sorted(os.listdir(pages_dir))
    if len(pages) == 1:
        dst = os.path.join(out_dir, f"{stem}.{target}")
        shutil.move(os.path.join(pages_dir, pages[0]), dst)
        return dst
    dst = os.path.join(out_dir, f"{stem}-{target}.zip")  # une image par page
    with zipfile.ZipFile(dst, "w") as z:
        for p in pages:
            z.write(os.path.join(pages_dir, p), p)
    return dst


# --- LibreOffice ------------------------------------------------------------

LO_FILTERS = {
    ("writer", "txt"): "txt:Text (encoded):UTF8",
    ("calc", "csv"): "csv:Text - txt - csv (StarCalc):44,34,76",
    ("web", "pdf"): "pdf:writer_web_pdf_Export",
}


def convert_office(src, out_dir, engine_id, target, work):
    out = os.path.join(out_dir, "lo")
    os.makedirs(out, exist_ok=True)
    run(["soffice", "--headless", "--norestore", f"-env:UserInstallation=file://{work}/lo-profile",
         "--convert-to", LO_FILTERS.get((engine_id, target), target), "--outdir", out, src], timeout=600)
    files = os.listdir(out)
    if not files:
        raise ConvertError("LibreOffice n'a produit aucun fichier")
    dst = os.path.join(out_dir, files[0])
    shutil.move(os.path.join(out, files[0]), dst)
    return dst


# --- Pandoc -----------------------------------------------------------------

PANDOC_READERS = {"md": "markdown", "txt": "markdown", "html": "html", "rst": "rst", "tex": "latex",
                  "org": "org", "ipynb": "ipynb", "docx": "docx", "odt": "odt", "epub": "epub"}
PANDOC_WRITERS = {"md": "gfm", "html": "html5", "docx": "docx", "odt": "odt", "epub": "epub3",
                  "rst": "rst", "tex": "latex", "txt": "plain"}


def convert_pandoc(src, out_dir, stem, ext, target, work):
    if target == "pdf":
        # Pas de LaTeX dans l'image : on passe par ODT puis LibreOffice
        odt = convert_pandoc(src, out_dir, stem, ext, "odt", work)
        dst = convert_office(odt, out_dir, "writer", "pdf", work)
        os.remove(odt)
        return dst
    dst = os.path.join(out_dir, f"{stem}.{target}")
    run(["pandoc", "-s", "-f", PANDOC_READERS[ext], "-t", PANDOC_WRITERS[target], "-o", dst, src],
        timeout=600)
    return dst


# --- Calibre ----------------------------------------------------------------

def convert_ebook(src, out_dir, stem, target):
    dst = os.path.join(out_dir, f"{stem}.{target}")
    run(["ebook-convert", src, dst], timeout=1800,
        env={"QT_QPA_PLATFORM": "offscreen", "QTWEBENGINE_CHROMIUM_FLAGS": "--no-sandbox"})
    return dst


# --- File d'attente ---------------------------------------------------------

jobs = OrderedDict()
jobs_lock = threading.Lock()
queue = Queue()


def update(job_id, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


def public(job):
    return {k: v for k, v in job.items() if k not in ("src", "work", "result", "user")}


def convert(job):
    job_id, work, ext, target = job["id"], job["work"], job["ext"], job["target"]
    out_dir = os.path.join(work, "out")
    os.makedirs(out_dir)
    stem = os.path.splitext(job["name"])[0]
    engine = find_engine(ext, target)
    eid = engine["id"]
    if eid in ("video", "audio"):
        return convert_ffmpeg(job["src"], out_dir, stem, target, lambda p: update(job_id, progress=round(p, 1)))
    if eid == "image":
        return convert_image(job["src"], out_dir, stem, ext, target)
    if eid == "pdf":
        return convert_pdf(job["src"], out_dir, stem, target)
    if eid in ("writer", "calc", "impress", "web"):
        return convert_office(job["src"], out_dir, eid, target, work)
    if eid == "pandoc":
        return convert_pandoc(job["src"], out_dir, stem, ext, target, work)
    return convert_ebook(job["src"], out_dir, stem, target)


def worker():
    while True:
        job_id = queue.get()
        job = jobs[job_id]
        update(job_id, status="converting", started=time.time())
        try:
            result = convert(job)
            saved = None
            if job["nas"]:
                folder = os.path.join(CONVERT_DIR, job["subfolder"])
                os.makedirs(folder, exist_ok=True)
                dest = unique_path(folder, os.path.basename(result))
                shutil.copy2(result, dest)
                saved = os.path.relpath(dest, CONVERT_DIR)
            update(job_id, status="done", progress=100, result=result, output=os.path.basename(result),
                   size=os.path.getsize(result), saved=saved)
            activity.log(job.get("user"), "convertir", f"Conversion terminée : {os.path.basename(result)}", "#/convertir")
        except Exception as e:  # noqa: BLE001
            update(job_id, status="error", error=str(e) if isinstance(e, ConvertError) else f"{type(e).__name__}: {e}")
            activity.log(job.get("user"), "convertir", f"Échec de la conversion : {job['name']}", "#/convertir", "err")
        finally:
            update(job_id, finished=time.time())
        queue.task_done()


def janitor():
    """Supprime les fichiers temporaires des conversions terminées depuis JOB_TTL."""
    while True:
        time.sleep(1800)
        now = time.time()
        with jobs_lock:
            expired = [j for j in jobs.values() if j.get("finished") and now - j["finished"] > JOB_TTL]
            for j in expired:
                del jobs[j["id"]]
        for j in expired:
            shutil.rmtree(j["work"], ignore_errors=True)


def submit(upload, target, nas, subfolder, user="*"):
    name = sanitize_name(upload.filename)
    ext = normalize_ext(os.path.splitext(name)[1])
    target = normalize_ext(target)
    if not find_engine(ext, target):
        raise ValueError(f"Conversion {ext or '?'} → {target} non prise en charge")
    job_id = uuid.uuid4().hex[:10]
    work = os.path.join(WORK_DIR, job_id)
    os.makedirs(os.path.join(work, "in"))
    src = os.path.join(work, "in", name)
    upload.save(src)
    with jobs_lock:
        jobs[job_id] = {"id": job_id, "name": name, "ext": ext, "target": target,
                        "engine": find_engine(ext, target)["tool"], "nas": bool(nas),
                        "subfolder": safe_subfolder(subfolder), "status": "queued", "progress": None,
                        "error": None, "output": None, "size": None, "saved": None,
                        "src": src, "work": work, "created": time.time(), "user": user}
    queue.put(job_id)
    return job_id


def list_jobs():
    with jobs_lock:
        return [public(j) for j in reversed(jobs.values())]


def result_path(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        return job and job.get("result")


def formats():
    return [{k: e[k] for k in ("id", "label", "tool", "inputs", "outputs")} for e in ENGINES]


def start(workers):
    shutil.rmtree(WORK_DIR, ignore_errors=True)  # restes d'un redémarrage précédent
    os.makedirs(WORK_DIR, exist_ok=True)
    os.makedirs(CONVERT_DIR, exist_ok=True)
    for _ in range(workers):
        threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=janitor, daemon=True).start()
