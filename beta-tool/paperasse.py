"""Outil « Paperasse » : classement automatique des papiers (factures, fiches de paie,
impôts, contrats…). Chaque document est lu (OCR si c'est un scan), reconnu
(doctype.py), renommé « 2026-03-12 EDF - Facture d'énergie.pdf » et rangé dans
PAPERS_DIR/<Catégorie>/<Année>/. Les échéances (« à payer avant le… ») donnent
lieu à des rappels.

Entrées : envoi depuis la page, Scanner, Rangement (Stockage), ou le dossier
« À classer » (pratique pour un scanner réseau ou le téléphone)."""

import os
import queue as queue_mod
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request, send_file

import activity
import doctype
import store
from converter import WORK_DIR, sanitize_name, unique_path

bp = Blueprint("paperasse", __name__)
DOCS_DIR = os.environ.get("DOCS_DIR", "/documents")
PAPERS_DIR = os.environ.get("PAPERS_DIR", os.path.join(DOCS_DIR, "Paperasse"))
WATCH = "À classer"
STAGING = ".a-valider"
TEXTS = store.path("paperasse", "texte")
THUMBS = store.path("paperasse", "miniatures")
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff", ".bmp")
ACCEPTED = (".pdf",) + IMAGE_EXT
_queue = queue_mod.Queue()
_status = {}  # id → {name, step, error}
_lock = threading.Lock()


def load():
    return store.load("paperasse", {"docs": {}, "settings": {"auto": False}})


def save_doc(doc):
    store.update("paperasse", {"docs": {}, "settings": {"auto": False}}, lambda d: d["docs"].__setitem__(doc["id"], doc))


def abs_path(doc):
    return os.path.join(PAPERS_DIR, doc["path"])


def _set(job, **kw):
    with _lock:
        if job in _status:
            _status[job].update(kw)


# --- Traitement d'un document -------------------------------------------------

def to_pdf(src, dst):
    """Image (photo, scan) → PDF d'une page."""
    from PIL import Image, ImageOps
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    img.save(dst, "PDF", resolution=200.0)


def thumb(doc_id, pdf):
    os.makedirs(THUMBS, exist_ok=True)
    base = os.path.join(THUMBS, doc_id)
    subprocess.run(["pdftoppm", "-jpeg", "-r", "50", "-scale-to", "480", "-f", "1", "-l", "1", "-singlefile", pdf, base],
                   capture_output=True, timeout=60)


def process(job, src, name, user, source):
    work = os.path.join(WORK_DIR, f"paperasse-{job}")
    os.makedirs(work, exist_ok=True)
    try:
        ext = os.path.splitext(name)[1].lower()
        pdf = os.path.join(work, "doc.pdf")
        if ext in IMAGE_EXT:
            _set(job, step="Conversion en PDF")
            to_pdf(src, pdf)
        else:
            shutil.copy(src, pdf)
        text = doctype.pdf_text(pdf)
        if len(text.strip()) < 40:  # scan sans texte : OCR → PDF cherchable
            _set(job, step="Lecture du texte (OCR)")
            out, side = os.path.join(work, "ocr.pdf"), os.path.join(work, "ocr.txt")
            if doctype.ocr_pdf(pdf, out, side, force=True) and os.path.exists(out):
                pdf = out
                text = open(side, encoding="utf-8", errors="replace").read() if os.path.exists(side) else doctype.pdf_text(out)
        _set(job, step="Reconnaissance")
        info = doctype.analyze(text, name)
        doc_id = uuid.uuid4().hex[:10]
        staging = os.path.join(PAPERS_DIR, STAGING)
        os.makedirs(staging, exist_ok=True)
        dest = os.path.join(staging, doc_id + ".pdf")
        shutil.move(pdf, dest)
        os.makedirs(TEXTS, exist_ok=True)
        with open(os.path.join(TEXTS, doc_id + ".txt"), "w", encoding="utf-8") as f:
            f.write(text[:500_000])
        thumb(doc_id, dest)
        doc = {"id": doc_id, "status": "inbox", "path": os.path.relpath(dest, PAPERS_DIR), "original": name, "source": source,
               "added_by": user, "added": time.time(), "pages": page_count(dest), "paid": False, "notes": "",
               **{k: info[k] for k in ("type", "category", "issuer", "date", "due", "amount", "title", "confidence")},
               "name": info["suggested_name"]}
        save_doc(doc)
        if load()["settings"].get("auto") and info["confidence"] == "haute":
            doc = file_doc(doc_id, {})
            activity.log("*", "paperasse", f"Classé automatiquement : {doc['name']} ({doc['category']})", "#/paperasse/docs", push=False)
        else:
            activity.log(user, "paperasse", f"Document à valider : {info['title']}{' · ' + info['issuer'] if info['issuer'] else ''}",
                         "#/paperasse", push=source == "watch")
        _set(job, step="Terminé", done=True, doc=doc_id)
    except Exception as e:  # noqa: BLE001
        _set(job, step="Échec", error=str(e)[:300], done=True)
        activity.log(user, "paperasse", f"Impossible de traiter « {name} » : {e}", "#/paperasse", "err", push=False)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def page_count(pdf):
    try:
        import pikepdf
        with pikepdf.open(pdf) as p:
            return len(p.pages)
    except Exception:  # noqa: BLE001
        return None


def worker():
    while True:
        job, src, name, user, source, cleanup = _queue.get()
        try:
            process(job, src, name, user, source)
        finally:
            if cleanup:
                try:
                    os.remove(src)
                except OSError:
                    pass
        _queue.task_done()


def enqueue(src, name, user, source="upload", cleanup=True):
    """Ajoute un fichier à traiter ; src est copié/déplacé par l'appelant dans un endroit temporaire."""
    if not name.lower().endswith(ACCEPTED):
        raise ValueError(f"« {name} » : seuls les PDF et les images (photo, scan) sont acceptés")
    job = uuid.uuid4().hex[:10]
    with _lock:
        _status[job] = {"id": job, "name": name, "step": "En attente", "error": None, "done": False, "at": time.time()}
    _queue.put((job, src, name, user, source, cleanup))
    return job


def ingest_file(path, user, source="rangement", move=True):
    """Envoie un fichier du NAS vers Paperasse (déplacé ou copié dans la file)."""
    tmp_dir = os.path.join(WORK_DIR, "paperasse-entrants")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp = os.path.join(tmp_dir, uuid.uuid4().hex[:8] + os.path.splitext(path)[1].lower())
    (shutil.move if move else shutil.copy2)(path, tmp)
    return enqueue(tmp, os.path.basename(path), user, source)


def folder_for(doc):
    cat = doc.get("category") if doc.get("category") in doctype.CATEGORY_NAMES else "Autres"
    year = (doc.get("date") or "")[:4] or str(datetime.now().year)
    return os.path.join(PAPERS_DIR, cat, year)


def clean_name(name):
    name = sanitize_name(re.sub(r'[\\/:*?"<>|]+', " ", name or "").strip()) or "Document"
    return name if name.lower().endswith(".pdf") else name + ".pdf"


def file_doc(doc_id, fields):
    doc = load()["docs"].get(doc_id)
    if not doc:
        raise ValueError("Document introuvable")
    apply_fields(doc, fields)
    folder = folder_for(doc)
    os.makedirs(folder, exist_ok=True)
    src = abs_path(doc)
    wanted = clean_name(doc["name"])
    if os.path.dirname(src) == folder and os.path.basename(src) == wanted:
        dest = src
    else:
        dest = unique_path(folder, wanted)
        shutil.move(src, dest)
    doc.update(path=os.path.relpath(dest, PAPERS_DIR), name=os.path.basename(dest), status="filed", filed=time.time())
    save_doc(doc)
    try:
        import files
        files.invalidate()
    except Exception:  # noqa: BLE001
        pass
    return doc


def apply_fields(doc, f):
    for key in ("title", "issuer", "type", "notes", "name"):
        if key in f:
            doc[key] = str(f[key] or "").strip()[:200] or None
    if "category" in f and f["category"] in doctype.CATEGORY_NAMES:
        doc["category"] = f["category"]
    for key in ("date", "due"):
        if key in f:
            v = str(f[key] or "")
            doc[key] = v if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else None
    if "amount" in f:
        try:
            doc["amount"] = round(float(str(f["amount"]).replace(",", ".")), 2) if str(f["amount"]).strip() else None
        except ValueError:
            raise ValueError("Montant invalide") from None
    if "paid" in f:
        doc["paid"] = bool(f["paid"])
    if not doc.get("name"):
        doc["name"] = doctype.suggested_name(doc.get("type") or "Document", doc.get("issuer"), doc.get("date"), "doc.pdf")


# --- Dossier « À classer » et rappels d'échéances -------------------------------

def watcher():
    seen = {}
    while True:
        time.sleep(30)
        inbox = os.path.join(PAPERS_DIR, WATCH)
        try:
            os.makedirs(inbox, exist_ok=True)
            names = [n for n in os.listdir(inbox) if not n.startswith(".") and n.lower().endswith(ACCEPTED)]
        except OSError:
            continue
        for n in names:
            p = os.path.join(inbox, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            key = (n, st.st_size)
            # on attend que le fichier ne bouge plus (scanner ou copie en cours)
            if seen.get(n) == key and time.time() - st.st_mtime > 20:
                seen.pop(n, None)
                try:
                    ingest_file(p, "*", "watch")
                except Exception as e:  # noqa: BLE001
                    print("paperasse", n, e)
            else:
                seen[n] = key


def reminders():
    while True:
        today = date.today()
        changes = []
        for doc in load()["docs"].values():
            if not doc.get("due") or doc.get("paid"):
                continue
            due = date.fromisoformat(doc["due"])
            left = (due - today).days
            for mark, cond in (("j7", 0 < left <= 7), ("j1", left == 1), ("j0", left == 0), ("late", left == -3)):
                if cond and mark not in doc.get("reminded", []):
                    when = {"j7": f"dans {left} jours", "j1": "demain", "j0": "aujourd'hui", "late": "il y a 3 jours (en retard)"}[mark]
                    amount = f" ({doc['amount']:.2f} €)".replace(".", ",") if doc.get("amount") else ""
                    activity.log("*", "paperasse", f"Échéance {when} : {doc.get('issuer') or doc.get('title')}{amount}",
                                 "#/paperasse/echeances", "err" if mark in ("j0", "late") else "ok", title="Paperasse · échéance")
                    changes.append((doc["id"], mark))
                    break
        if changes:
            def go(d):
                for doc_id, mark in changes:
                    if doc_id in d["docs"]:
                        d["docs"][doc_id].setdefault("reminded", []).append(mark)
            store.update("paperasse", {"docs": {}, "settings": {"auto": False}}, go)
        time.sleep(3600 * 3)


def start():
    os.makedirs(os.path.join(PAPERS_DIR, WATCH), exist_ok=True)
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=watcher, daemon=True).start()
    threading.Thread(target=reminders, daemon=True).start()


def text(doc_id):
    try:
        with open(os.path.join(TEXTS, doc_id + ".txt"), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def public(doc):
    return {**doc, "folder": os.path.relpath(os.path.dirname(abs_path(doc)), PAPERS_DIR) if doc["status"] == "filed" else None}


# --- Routes -----------------------------------------------------------------

@bp.get("/api/papers")
def list_docs():
    a = request.args
    docs = list(load()["docs"].values())
    counts = {"inbox": sum(1 for d in docs if d["status"] == "inbox"),
              "categories": {c: sum(1 for d in docs if d["status"] == "filed" and d.get("category") == c) for c in doctype.CATEGORY_NAMES},
              "years": sorted({(d.get("date") or "")[:4] for d in docs if d.get("date")}, reverse=True)}
    status = a.get("status", "filed")
    docs = [d for d in docs if d["status"] == status]
    if a.get("category"):
        docs = [d for d in docs if d.get("category") == a["category"]]
    if a.get("year"):
        docs = [d for d in docs if (d.get("date") or "").startswith(a["year"])]
    q = doctype.plain(a.get("q", "")).strip()
    if q:
        docs = [d for d in docs if q in doctype.plain(" ".join(str(d.get(k) or "") for k in ("title", "issuer", "name", "type", "notes")))
                or q in doctype.plain(text(d["id"]))]
    docs.sort(key=lambda d: (d.get("date") or "", d["added"]), reverse=True)
    with _lock:
        pending = [s for s in _status.values() if not s["done"] or time.time() - s["at"] < 30]
    return jsonify(docs=[public(d) for d in docs[:500]], counts=counts, processing=pending,
                   categories=doctype.CATEGORIES, settings=load()["settings"], watch=os.path.join(os.path.basename(PAPERS_DIR), WATCH))


@bp.post("/api/papers/upload")
def upload():
    files = request.files.getlist("files") or request.files.getlist("file")
    if not files:
        raise ValueError("Aucun fichier")
    tmp_dir = os.path.join(WORK_DIR, "paperasse-entrants")
    os.makedirs(tmp_dir, exist_ok=True)
    jobs = []
    for f in files:
        name = sanitize_name(f.filename or "document.pdf")
        if not name.lower().endswith(ACCEPTED):
            raise ValueError(f"« {name} » : seuls les PDF et les images (photo, scan) sont acceptés")
        tmp = os.path.join(tmp_dir, uuid.uuid4().hex[:8] + os.path.splitext(name)[1].lower())
        f.save(tmp)
        jobs.append(enqueue(tmp, name, g.user["name"], request.form.get("source") or "upload"))
    return jsonify(jobs=jobs)


@bp.get("/api/papers/<doc_id>")
def get_doc(doc_id):
    doc = load()["docs"].get(doc_id)
    if not doc:
        raise ValueError("Document introuvable")
    return jsonify({**public(doc), "text": text(doc_id)[:4000], "categories": doctype.CATEGORIES})


@bp.put("/api/papers/<doc_id>")
def edit(doc_id):
    d = request.get_json(silent=True) or {}
    doc = load()["docs"].get(doc_id)
    if not doc:
        raise ValueError("Document introuvable")
    if d.get("file") or doc["status"] == "filed" and any(k in d for k in ("category", "date", "name")):
        return jsonify(public(file_doc(doc_id, d)))  # (re)classe : déplace le fichier si besoin
    apply_fields(doc, d)
    save_doc(doc)
    return jsonify(public(doc))


@bp.post("/api/papers/<doc_id>/reanalyze")
def reanalyze(doc_id):
    doc = load()["docs"].get(doc_id)
    if not doc:
        raise ValueError("Document introuvable")
    info = doctype.analyze(text(doc_id), doc.get("original") or doc["name"])
    return jsonify(info)


@bp.delete("/api/papers/<doc_id>")
def delete(doc_id):
    doc = load()["docs"].get(doc_id)
    if not doc:
        raise ValueError("Document introuvable")
    src = abs_path(doc)
    if os.path.exists(src):
        trash = os.path.join(DOCS_DIR, ".corbeille")
        os.makedirs(trash, exist_ok=True)
        shutil.move(src, unique_path(trash, doc.get("name") or os.path.basename(src)))
    store.update("paperasse", {"docs": {}, "settings": {"auto": False}}, lambda d: d["docs"].pop(doc_id, None))
    for p in (os.path.join(TEXTS, doc_id + ".txt"), os.path.join(THUMBS, doc_id + ".jpg")):
        try:
            os.remove(p)
        except OSError:
            pass
    return jsonify(ok=True)


@bp.get("/api/papers/<doc_id>/pdf")
def pdf(doc_id):
    doc = load()["docs"].get(doc_id)
    if not doc or not os.path.exists(abs_path(doc)):
        raise ValueError("Document introuvable")
    return send_file(abs_path(doc), mimetype="application/pdf", download_name=doc.get("name") or "document.pdf",
                     as_attachment=request.args.get("dl") == "1")


@bp.get("/api/papers/<doc_id>/thumb")
def thumbnail(doc_id):
    p = os.path.join(THUMBS, doc_id + ".jpg")
    if not os.path.exists(p):
        doc = load()["docs"].get(doc_id)
        if doc and os.path.exists(abs_path(doc)):
            thumb(doc_id, abs_path(doc))
    if not os.path.exists(p):
        return "", 404
    resp = send_file(p, mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "max-age=86400"
    return resp


@bp.get("/api/papers/deadlines")
def deadlines():
    out = [public(d) for d in load()["docs"].values() if d.get("due")]
    out.sort(key=lambda d: (d.get("paid", False), d["due"]))
    return jsonify(out)


@bp.put("/api/papers/settings")
def set_settings():
    auto = bool((request.get_json(silent=True) or {}).get("auto"))
    store.update("paperasse", {"docs": {}, "settings": {"auto": False}}, lambda d: d["settings"].update(auto=auto))
    return jsonify(load()["settings"])


@bp.post("/api/papers/approve-all")
def approve_all():
    """Valide tous les documents en attente avec la proposition faite."""
    n = 0
    for doc in [d for d in load()["docs"].values() if d["status"] == "inbox"]:
        file_doc(doc["id"], {})
        n += 1
    return jsonify(filed=n)


def search(q, user):
    out = []
    for d in load()["docs"].values():
        hay = doctype.plain(" ".join(str(d.get(k) or "") for k in ("title", "issuer", "name", "type")))
        if doctype.plain(q) in hay:
            out.append({"type": "paper", "title": d.get("name") or d.get("title"), "sub": f"Paperasse · {d.get('category')}", "link": f"#/paperasse/doc/{d['id']}"})
    return out[:8]


def count(user):
    return sum(1 for d in load()["docs"].values() if d["status"] == "inbox") or None


def upcoming(days=60):
    """Échéances à venir (pour l'agenda et le tableau de bord)."""
    limit = (date.today() + timedelta(days=days)).isoformat()
    return [d for d in load()["docs"].values() if d.get("due") and not d.get("paid") and d["due"] <= limit]
