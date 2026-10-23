"""Outil « Traduction » : traduit des textes et des documents (TXT, Markdown, sous-titres
SRT/VTT, Word, OpenDocument, PDF) entièrement sur le NAS, sans service en ligne.

Moteur : les modèles open source d'Argos Translate (MIT), exécutés directement avec
CTranslate2 et SentencePiece. Chaque paire de langues (ex. anglais → français) est un
modèle d'environ 100 Mo, téléchargé une fois depuis les Réglages de l'outil ; entre deux
langues sans modèle direct, la traduction passe par l'anglais."""

import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.request
import zipfile

from flask import Blueprint, g, jsonify, request, send_file

import store
from jobs import JobQueue

bp = Blueprint("translate", __name__)
MODELS = store.path("models", "traduction")
INDEX_URL = os.environ.get("ARGOS_INDEX", "https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json")
NAMES = {"fr": "Français", "en": "Anglais", "es": "Espagnol", "de": "Allemand", "it": "Italien", "pt": "Portugais", "nl": "Néerlandais",
         "pl": "Polonais", "ru": "Russe", "uk": "Ukrainien", "ar": "Arabe", "zh": "Chinois", "zt": "Chinois traditionnel", "ja": "Japonais",
         "ko": "Coréen", "tr": "Turc", "sv": "Suédois", "da": "Danois", "nb": "Norvégien", "fi": "Finnois", "el": "Grec", "cs": "Tchèque",
         "ro": "Roumain", "hu": "Hongrois", "bg": "Bulgare", "ca": "Catalan", "eu": "Basque", "gl": "Galicien", "he": "Hébreu", "hi": "Hindi",
         "id": "Indonésien", "vi": "Vietnamien", "th": "Thaï", "fa": "Persan", "ga": "Irlandais", "sk": "Slovaque", "sl": "Slovène",
         "lt": "Lituanien", "lv": "Letton", "et": "Estonien", "eo": "Espéranto", "ms": "Malais", "bn": "Bengali", "ur": "Ourdou", "az": "Azéri",
         "sq": "Albanais", "tl": "Tagalog", "ky": "Kirghiz", "pb": "Portugais (Brésil)", "sw": "Swahili"}
STOP = {"fr": "le la les des et est une un pour que qui dans pas sur avec ce il elle nous vous sont du au".split(),
        "en": "the and is are of to in that it for was with on as you this be have not they".split(),
        "es": "el la los las y es en que de un una por con para no se su al lo como".split(),
        "de": "der die das und ist nicht ein eine zu den mit von sich des auf für im dem".split(),
        "it": "il lo la gli le e è di che un una per non con del della sono si".split(),
        "pt": "o a os as e é de que um uma para não com do da em no na se".split(),
        "nl": "de het een en is van dat niet op te zijn met voor die in".split()}
_installing = {}
_loaded = {}
_lock = threading.Lock()


def lang_name(code):
    return NAMES.get(code, code)


def installed():
    out = []
    if os.path.isdir(MODELS):
        for d in sorted(os.listdir(MODELS)):
            meta = os.path.join(MODELS, d, "metadata.json")
            if os.path.exists(meta) and "_" in d:
                a, b = d.split("_", 1)
                out.append({"from": a, "to": b, "dir": d, "size": dir_size(os.path.join(MODELS, d))})
    return out


def dir_size(p):
    return sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(p) for f in fs)


def pairs():
    return {(m["from"], m["to"]) for m in installed()}


def route(src, dst):
    """Chemin de traduction : direct, ou par l'anglais."""
    p = pairs()
    if (src, dst) in p:
        return [(src, dst)]
    if src != "en" and dst != "en" and (src, "en") in p and ("en", dst) in p:
        return [(src, "en"), ("en", dst)]
    return None


def detect(text):
    words = re.findall(r"[a-zàâäéèêëïîôöùûüçñßäöü]+", text.lower()[:4000])
    if not words:
        return None
    scores = {lang: sum(1 for w in words if w in set(sw)) for lang, sw in STOP.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] >= 2 else None


# --- Moteur --------------------------------------------------------------------

def engine(src, dst):
    key = f"{src}_{dst}"
    with _lock:
        if key not in _loaded:
            import ctranslate2
            import sentencepiece
            base = os.path.join(MODELS, key)
            model_dir = os.path.join(base, "model")
            sp = sentencepiece.SentencePieceProcessor(model_file=os.path.join(base, "sentencepiece.model"))
            tr = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8", inter_threads=1,
                                        intra_threads=max(1, (os.cpu_count() or 2) - 1))
            if len(_loaded) >= 3:  # garde au plus 3 modèles en mémoire
                _loaded.pop(next(iter(_loaded)))
            _loaded[key] = (tr, sp)
        return _loaded[key]


SENT_RE = re.compile(r"(?<=[.!?…])\s+(?=[\"«“(A-ZÀ-ÖØ-Þ0-9])")


ABBR = re.compile(r"(?:^|\s)(?:M|Mme|Mlle|Mr|Mrs|Ms|Dr|Pr|St|Ste|av|bd|etc|cf|ex|p|n°|No|Jr|Sr|vs|env|tél)\.$", re.I)


def split_sentences(text):
    parts = []
    for piece in SENT_RE.split(text):  # recolle les coupures après une abréviation (« M. Dupont »)
        if parts and ABBR.search(parts[-1]):
            parts[-1] += " " + piece
        else:
            parts.append(piece)
    out = []
    for s in parts:
        s = s.strip()
        while len(s) > 400:  # phrase trop longue : coupe sur une virgule ou un espace
            cut = max(s.rfind(",", 0, 400), s.rfind(" ", 0, 400))
            cut = cut if cut > 50 else 400
            out.append(s[:cut + 1].strip())
            s = s[cut + 1:].strip()
        if s:
            out.append(s)
    return out


def translate_segments(segments, src, dst, progress=None):
    """Traduit une liste de textes (paragraphes, lignes…) en gardant la structure."""
    path = route(src, dst)
    if not path:
        raise ValueError(f"Aucun modèle installé pour {lang_name(src)} → {lang_name(dst)} : installe-le dans les réglages de l'outil")
    for a, b in path:
        tr, sp = engine(a, b)
        flat, owners = [], []
        for i, seg in enumerate(segments):
            if seg.strip():
                for s in split_sentences(seg):
                    flat.append(s)
                    owners.append(i)
        results = []
        for start in range(0, len(flat), 24):
            batch = [sp.encode(s, out_type=str) for s in flat[start:start + 24]]
            out = tr.translate_batch(batch, beam_size=2, max_decoding_length=512, max_batch_size=24)
            results += [sp.decode(o.hypotheses[0]) for o in out]
            if progress:
                progress(min(99, round((start + 24) / max(1, len(flat)) * 100 / len(path) + (path.index((a, b)) * 100 / len(path)))))
        joined = {}
        for owner, text in zip(owners, results):
            joined.setdefault(owner, []).append(text.strip())
        segments = [" ".join(joined[i]) if i in joined else seg for i, seg in enumerate(segments)]
    return segments


def translate_text(text, src, dst):
    lines = text.split("\n")
    return "\n".join(translate_segments(lines, src, dst))


# --- Documents -------------------------------------------------------------------

def doc_srt(data, tr):
    blocks = re.split(r"\n\s*\n", data.strip())
    texts, metas = [], []
    for b in blocks:
        lines = b.splitlines()
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            metas.append((b, None))
            continue
        metas.append(("\n".join(lines[:idx + 1]), len(texts)))
        texts.append(" ".join(lines[idx + 1:]))
    out = tr(texts)
    return "\n\n".join(head if i is None else f"{head}\n{out[i]}" for head, i in metas) + "\n"


def doc_xml(data, tr, kind):
    """Word (.docx) ou OpenDocument (.odt) : traduit paragraphe par paragraphe, mise en page conservée."""
    zin = zipfile.ZipFile(io.BytesIO(data))
    part = "word/document.xml" if kind == "docx" else "content.xml"
    xml = zin.read(part).decode("utf-8")
    if kind == "docx":
        para_re, text_re = re.compile(r"<w:p[ >].*?</w:p>", re.S), re.compile(r"(<w:t(?: [^>]*)?>)(.*?)(</w:t>)", re.S)
    else:
        para_re, text_re = re.compile(r"<text:(?:p|h)[ >].*?</text:(?:p|h)>", re.S), re.compile(r"(<text:span[^>]*>|<text:(?:p|h)[^>]*>)([^<]+)", re.S)
    paras = para_re.findall(xml)
    import html as h
    texts = ["".join(h.unescape(m.group(2)) for m in text_re.finditer(p)) for p in paras]
    out = tr(texts)
    for p, src, dst in zip(paras, texts, out):
        if not src.strip():
            continue
        first = [True]

        def put(m, dst=dst):
            if first[0]:
                first[0] = False
                return m.group(1) + h.escape(dst, quote=False) + (m.group(3) if m.lastindex >= 3 else "")
            return m.group(1) + "" + (m.group(3) if m.lastindex >= 3 else "")
        xml = xml.replace(p, text_re.sub(put, p), 1)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, xml.encode("utf-8") if item.filename == part else zin.read(item.filename))
    return buf.getvalue()


def run_job(job, progress):
    o = job["options"]
    src_path = job["src"]
    name = os.path.basename(src_path)
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    src, dst = o["from"], o["to"]
    tr = lambda segs: translate_segments(segs, src, dst, lambda p: progress(progress=p))  # noqa: E731
    with open(src_path, "rb") as f:
        data = f.read()
    if src == "auto":
        import doctype
        sample = doctype.text_of(src_path, ocr=False) if ext in (".pdf", ".docx", ".odt") else data[:20000].decode("utf-8", "replace")
        src = detect(sample) or "en"
        tr = lambda segs: translate_segments(segs, src, dst, lambda p: progress(progress=p))  # noqa: E731
    out_dir = os.path.join(job["work"], "out")
    os.makedirs(out_dir, exist_ok=True)
    suffix = f" ({dst})"
    if ext in (".srt", ".vtt"):
        result, out_name = doc_srt(data.decode("utf-8-sig", "replace"), tr).encode("utf-8"), stem + suffix + ext
    elif ext in (".docx", ".odt"):
        result, out_name = doc_xml(data, tr, ext[1:]), stem + suffix + ext
    elif ext == ".pdf":
        import doctype
        text = doctype.text_of(src_path, ocr=True)
        paras = [p.replace("\n", " ") for p in re.split(r"\n\s*\n", text)]
        result, out_name = "\n\n".join(tr(paras)).encode("utf-8"), stem + suffix + ".txt"
    else:
        result, out_name = "\n".join(tr(data.decode("utf-8-sig", "replace").split("\n"))).encode("utf-8"), stem + suffix + (ext if ext in (".md", ".txt") else ".txt")
    out = os.path.join(out_dir, out_name)
    with open(out, "wb") as f:
        f.write(result)
    return {"result": out, "output": out_name, "size": len(result), "detected": src}


queue = JobQueue("traduction", run_job, workers=1, label="Traduction")


def start():
    os.makedirs(MODELS, exist_ok=True)
    queue.start()


# --- Installation des modèles ------------------------------------------------------

def index():
    cache = store.load("traduction-index", {"at": 0, "packages": []})
    if time.time() - cache["at"] > 86400 or not cache["packages"]:
        try:
            with urllib.request.urlopen(urllib.request.Request(INDEX_URL, headers={"User-Agent": "Beta-Tool"}), timeout=20) as r:
                pk = json.loads(r.read())
            cache = {"at": time.time(), "packages": [{"from": p["from_code"], "to": p["to_code"], "version": p.get("package_version"),
                                                      "links": p.get("links", [])} for p in pk]}
            store.save("traduction-index", cache)
        except Exception as e:  # noqa: BLE001
            if not cache["packages"]:
                raise ValueError(f"Impossible de récupérer la liste des langues ({e}) : le NAS a-t-il accès à Internet ?") from None
    return cache["packages"]


def install(src, dst):
    key = f"{src}_{dst}"
    pkg = next((p for p in index() if p["from"] == src and p["to"] == dst), None)
    if not pkg:
        raise ValueError("Ce modèle n'existe pas")
    _installing[key] = {"status": "running", "progress": 0}

    def go():
        try:
            data = None
            for url in pkg["links"]:
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Beta-Tool"})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        total = int(r.headers.get("Content-Length") or 0)
                        buf = io.BytesIO()
                        while chunk := r.read(1024 * 256):
                            buf.write(chunk)
                            if total:
                                _installing[key]["progress"] = round(buf.tell() * 100 / total)
                        data = buf.getvalue()
                    break
                except Exception as e:  # noqa: BLE001
                    _installing[key]["error"] = str(e)
            if data is None:
                raise ValueError("Téléchargement impossible : " + _installing[key].get("error", "?"))
            tmp = tempfile.mkdtemp(dir=MODELS)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for m in z.infolist():
                    if ".." in m.filename.split("/") or m.filename.startswith("/"):
                        raise ValueError("Paquet suspect")
                z.extractall(tmp)
            inner = next((os.path.join(tmp, d) for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))), tmp)
            if not os.path.isdir(os.path.join(inner, "model")) or not os.path.exists(os.path.join(inner, "sentencepiece.model")):
                raise ValueError("Modèle incompatible (format inattendu)")
            dest = os.path.join(MODELS, key)
            shutil.rmtree(dest, ignore_errors=True)
            shutil.move(inner, dest)
            shutil.rmtree(tmp, ignore_errors=True)
            if not os.path.exists(os.path.join(dest, "metadata.json")):
                with open(os.path.join(dest, "metadata.json"), "w") as f:
                    json.dump({"from_code": src, "to_code": dst}, f)
            _installing[key] = {"status": "done", "progress": 100}
        except Exception as e:  # noqa: BLE001
            _installing[key] = {"status": "error", "error": str(e)[:300]}
    threading.Thread(target=go, daemon=True).start()


# --- Routes ------------------------------------------------------------------------

@bp.get("/api/translate/languages")
def languages():
    inst = installed()
    langs = sorted({m["from"] for m in inst} | {m["to"] for m in inst})
    targets = {a: sorted({b for b in langs if b != a and route(a, b)}) for a in langs}
    return jsonify(installed=inst, languages=[{"code": c, "name": lang_name(c)} for c in langs], targets=targets, installing=_installing)


@bp.get("/api/translate/catalog")
def catalog():
    if g.user["role"] != "admin":
        raise PermissionError("Réservé aux administrateurs")
    have = pairs()
    return jsonify([{**p, "from_name": lang_name(p["from"]), "to_name": lang_name(p["to"]), "installed": (p["from"], p["to"]) in have}
                    for p in index() if p["from"] in NAMES and p["to"] in NAMES])


@bp.post("/api/translate/install")
def install_route():
    if g.user["role"] != "admin":
        raise PermissionError("Réservé aux administrateurs")
    d = request.get_json(silent=True) or {}
    install(d.get("from"), d.get("to"))
    return jsonify(ok=True)


@bp.delete("/api/translate/models/<key>")
def remove_model(key):
    if g.user["role"] != "admin" or not re.fullmatch(r"[a-z]{2}_[a-z]{2}", key):
        raise PermissionError("Réservé aux administrateurs")
    shutil.rmtree(os.path.join(MODELS, key), ignore_errors=True)
    _loaded.pop(key, None)
    return jsonify(ok=True)


@bp.post("/api/translate")
def translate():
    d = request.get_json(silent=True) or {}
    text = str(d.get("text") or "")
    if not text.strip():
        raise ValueError("Rien à traduire")
    if len(text) > 50_000:
        raise ValueError("Texte trop long : utilise la traduction de documents")
    src = d.get("from") or "auto"
    detected = None
    if src == "auto":
        src = detected = detect(text)
        if not src:
            raise ValueError("Langue non reconnue : choisis-la dans la liste")
    dst = d.get("to") or "fr"
    if src == dst:
        return jsonify(text=text, detected=detected)
    start = time.time()
    return jsonify(text=translate_text(text, src, dst), detected=detected, seconds=round(time.time() - start, 1))


@bp.post("/api/translate/doc")
def translate_doc():
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    ext = os.path.splitext(f.filename or "")[1].lower()
    if ext not in (".txt", ".md", ".srt", ".vtt", ".docx", ".odt", ".pdf"):
        raise ValueError("Formats acceptés : TXT, Markdown, SRT, VTT, Word (.docx), OpenDocument (.odt), PDF")
    src, dst = request.form.get("from") or "auto", request.form.get("to") or "fr"
    if src != "auto" and not route(src, dst):
        raise ValueError(f"Aucun modèle installé pour {lang_name(src)} → {lang_name(dst)}")
    job = queue.submit(f, {"from": src, "to": dst}, g.user["name"])
    return jsonify(id=job)


@bp.get("/api/translate/jobs")
def jobs():
    return jsonify(queue.list(g.user["name"], g.user["role"]))


@bp.get("/api/translate/jobs/<job_id>/file")
def job_file(job_id):
    j = queue.result(job_id, g.user["name"], g.user["role"])
    if not j:
        raise ValueError("Résultat introuvable")
    return send_file(j["result"], as_attachment=True, download_name=j["output"])


@bp.delete("/api/translate/jobs/<job_id>")
def job_delete(job_id):
    queue.remove(job_id, g.user["name"], g.user["role"])
    return jsonify(ok=True)
