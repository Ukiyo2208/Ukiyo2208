"""Extension de navigateur (Opera, Chrome, Edge, Brave, Vivaldi) : le pont entre le navigateur et le NAS.

Appairage : dans Réglages › Extension, un code à 6 chiffres (valable 5 minutes) ; l'extension l'échange
contre un jeton personnel « extension » (révocable, seule son empreinte est gardée, comme les jetons d'API).

Routes de l'extension (/api/v1/ext/…, avec le jeton) :
- envoyer un fichier (lien, téléchargement, glisser-déposer) : rangé tout seul — relevé bancaire → Budget,
  relevé Revolut → Patrimoine, facture / PDF → Paperasse, photo → Album photo, le reste → Téléchargements/Navigateur ;
- envoyer une vidéo au Téléchargeur, une page ou une sélection à Bêta Notes, un numéro de suivi à Colis,
  un rendez-vous à l'Agenda, une annonce immobilière à l'outil Immobilier ;
- prix : fiche produit vue, suivi, comparaison avec les autres boutiques ;
- recherche dans Bêta Tool."""

import io
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
import zipfile

from flask import Blueprint, Response, g, jsonify, request

import api
import auth
import famille
import settings
import store

bp = Blueprint("extension", __name__)
ROOT = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.join(ROOT, "extension")
_codes = {}  # code → {user, until, tries}
_lock = threading.Lock()
BANK_EXT = (".ofx", ".qif", ".qfx")
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif")
PAPER_EXT = (".pdf",)
VIDEO_EXT = (".mp4", ".mkv", ".mov", ".webm", ".avi", ".mp3", ".m4a", ".flac")
DESTS = {"auto": "Automatique", "paperasse": "Paperasse", "budget": "Budget (relevé)", "patrimoine": "Patrimoine (relevé Revolut)",
         "photos": "Album photo", "fichiers": "Fichiers (Téléchargements/Navigateur)"}
TOOL_OF = {"paperasse": "paperasse", "budget": "budget", "patrimoine": "patrimoine", "photos": "photos", "fichiers": "fichiers",
           "video": "telecharger", "note": "notes", "parcel": "colis", "event": "agenda", "immo": "immo", "prix": "prix", "search": None}


def allowed(dest):
    """Outil activé et autorisé pour ce compte (les comptes enfants gardent leurs limites)."""
    tool = TOOL_OF.get(dest)
    if not tool:
        return True
    tools = famille.allowed_tools(g.user, settings.get()["tools"])
    return tools.get(tool, True)


def need_tool(dest):
    if not allowed(dest):
        raise PermissionError("Cet outil n'est pas disponible sur ton compte")


# --- Appairage ---------------------------------------------------------------------------------

@bp.post("/api/ext/code")
def new_code():
    """Code d'appairage affiché dans Réglages › Extension (session du navigateur)."""
    code = f"{secrets.randbelow(10 ** 6):06d}"
    with _lock:
        for c in [c for c, v in _codes.items() if v["until"] < time.time() or v["user"] == g.user["name"]]:
            _codes.pop(c, None)
        _codes[code] = {"user": g.user["name"], "until": time.time() + 300, "tries": 0}
    return jsonify(code=code, expires=300)


@bp.post("/api/ext-pair")
def pair():
    """L'extension échange le code contre un jeton (route publique, code à usage unique, 5 essais en tout)."""
    f = request.get_json(silent=True) or {}
    code = re.sub(r"\D", "", str(f.get("code") or ""))
    browser = str(f.get("browser") or "Navigateur")[:40]
    with _lock:
        for c, v in list(_codes.items()):
            if v["until"] < time.time():
                _codes.pop(c)
        entry = _codes.get(code)
        if not entry:
            for v in _codes.values():  # mauvais code : chaque code en cours perd un essai
                v["tries"] += 1
            for c in [c for c, v in _codes.items() if v["tries"] >= 5]:
                _codes.pop(c)
            return jsonify(error="Code incorrect ou expiré : affiche un nouveau code dans Réglages › Extension"), 400
        _codes.pop(code)
    token = "bt_" + secrets.token_urlsafe(32)
    t = {"id": secrets.token_hex(6), "user": entry["user"], "name": f"Extension · {browser}", "scopes": ["extension:use"],
         "hash": api._hash(token), "prefix": token[:7] + "…", "created": time.time(), "expires": None, "used": 0, "kind": "extension"}
    store.update("api/jetons", {"tokens": []}, lambda d: d["tokens"].append(t))
    return jsonify(token=token, user=entry["user"], site=settings.get()["site_name"])


@bp.get("/api/ext/browsers")
def browsers():
    mine = [{k: v for k, v in t.items() if k not in ("hash", "user")} for t in api.tokens()
            if t["user"] == g.user["name"] and "extension:use" in t["scopes"]]
    import vault
    return jsonify(browsers=sorted(mine, key=lambda t: -t["created"]), vault=vault.PUBLIC, vault_on=settings.enabled("coffre"),
                   url=request.host_url.rstrip("/"))


@bp.get("/api/ext/download")
def download():
    """L'extension en .zip, à décompresser puis charger dans opera://extensions (mode développeur)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(EXT_DIR):
            for name in files:
                full = os.path.join(base, name)
                z.write(full, os.path.join("beta-tool-extension", os.path.relpath(full, EXT_DIR)))
    return Response(buf.getvalue(), mimetype="application/zip", headers={"Content-Disposition": 'attachment; filename="beta-tool-extension.zip"'})


# --- Routes de l'extension -------------------------------------------------------------------------

def ext_route(rule, **kw):
    """Route /api/v1/ext/… réservée au jeton de l'extension (ou à la session du navigateur)."""
    def deco(fn):
        return bp.route("/api/v1/ext" + rule, endpoint="ext_" + fn.__name__, **kw)(api.need("extension:use")(fn))
    return deco


@ext_route("/status")
def status():
    import colis
    import vault
    tools = famille.allowed_tools(g.user, settings.get()["tools"])
    return jsonify(user=g.user["name"], site=settings.get()["site_name"], version=open(os.path.join(ROOT, "VERSION")).read().strip(),
                   tools={d: tools.get(t, True) for d, t in TOOL_OF.items() if t}, dests=DESTS,
                   vault={"on": tools.get("coffre", False), "url": vault.PUBLIC},
                   parcel_patterns=[[c, p] for c, p in colis.PATTERNS], parcel_context=colis.CONTEXT_NUM, prix=_prix_settings())


def _prix_settings():
    import prix
    return prix.settings_of(prix.load(g.user["name"]))


def classify(name, head):
    """Destination automatique d'un fichier d'après son nom et son début."""
    low = name.lower()
    if low.endswith(BANK_EXT):
        return "budget"
    if low.endswith(".csv"):
        import patrimoine
        text = head.decode("utf-8-sig", "replace")
        try:
            if patrimoine.parse_revolut(text):
                return "patrimoine"
        except Exception:  # noqa: BLE001
            pass
        import budget
        try:
            rows, _ = budget.parse_file(name, head)
            if rows:
                return "budget"
        except Exception:  # noqa: BLE001
            pass
        return "fichiers"
    if low.endswith(PAPER_EXT):
        return "paperasse"
    if low.endswith(PHOTO_EXT):
        return "photos"
    return "fichiers"


def _call(view):
    resp = view()
    if isinstance(resp, tuple):
        resp = resp[0]
    return resp.get_json() if hasattr(resp, "get_json") else resp


@ext_route("/upload", methods=["POST"])
def upload():
    """Un fichier venu du navigateur ; dest = auto, paperasse, budget, patrimoine, photos ou fichiers."""
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    name = re.sub(r'[\\/:*?"<>|]+', "_", f.filename or "fichier").strip() or "fichier"
    f.filename = name
    head = f.stream.read(20 * 1024 * 1024)
    f.stream.seek(0)
    dest = request.form.get("dest") or "auto"
    if dest == "auto":
        dest = classify(name, head)
    if dest not in DESTS:
        raise ValueError("Destination inconnue")
    need_tool(dest)
    if dest == "paperasse":
        import paperasse
        if not name.lower().endswith(paperasse.ACCEPTED):
            dest = "fichiers"
        else:
            r = _call(paperasse.upload)
            return jsonify(dest=dest, label="Paperasse", link="#/paperasse", detail="Lecture et rangement en cours", result=r)
    if dest == "budget":
        import budget
        r = _call(budget.import_file)
        return jsonify(dest=dest, label="Budget", link="#/budget/operations", detail=f"{r.get('added', 0)} opération(s) ajoutée(s)", result=r)
    if dest == "patrimoine":
        import patrimoine
        r = _call(patrimoine.import_revolut)
        return jsonify(dest=dest, label="Patrimoine", link="#/patrimoine/placements", detail=f"{r.get('added', 0)} opération(s) ajoutée(s)", result=r)
    if dest == "photos":
        import photos
        _call(photos.upload)
        return jsonify(dest=dest, label="Album photo", link="#/photos", detail="Photo ajoutée (dossier Import)")
    # Fichiers : Téléchargements/Navigateur
    import roots
    from converter import unique_path
    folder = os.path.join(roots.resolve("telechargements"), "Navigateur")
    os.makedirs(folder, exist_ok=True)
    path = unique_path(folder, name)
    f.save(path)
    rel = roots.relative("telechargements", path)
    return jsonify(dest="fichiers", label="Fichiers", link=f"#/fichiers/telechargements/{os.path.dirname(rel)}", detail=f"Téléchargements/{rel}")


@ext_route("/video", methods=["POST"])
def video():
    need_tool("video")
    import downloader
    f = request.get_json(force=True)
    ids = downloader.submit(f.get("url"), f.get("mode") or "video", f.get("folder") or "", True, g.user["name"])
    return jsonify(ids=ids, link="#/telecharger")


@ext_route("/note", methods=["POST"])
def note():
    need_tool("note")
    import notes
    f = request.get_json(force=True)
    title = str(f.get("title") or "Depuis le navigateur")[:200]
    body = str(f.get("text") or "").strip()
    if f.get("url"):
        body = (body + "\n\n" if body else "") + f"Source : [{title}]({f['url']})"
    n = {"id": secrets.token_hex(5), "title": title, "body": body[:200000], "folder": "Navigateur", "pinned": False, "color": "",
         "trashed": False, "created": time.time(), "updated": time.time()}
    store.update(notes.key(g.user["name"]), [], lambda ns: ns.append(n))
    return jsonify(id=n["id"], link=f"#/notes/{n['id']}")


@ext_route("/parcel", methods=["POST"])
def parcel():
    need_tool("parcel")
    import colis
    return jsonify(_call(colis.add_parcel) | {"link": "#/colis"})


@ext_route("/event-guess", methods=["POST"])
def event_guess():
    """Titre, date et heure devinés dans un texte sélectionné (« Rendez-vous le 12 mars à 14h30 chez… »)."""
    import commande
    import datefr
    text = re.sub(r"\s+", " ", str((request.get_json(force=True) or {}).get("text") or "")).strip()[:500]
    found = datefr.find(text)
    title = commande._strip_dates(text)[:120] or text[:120]
    if not found:
        return jsonify(title=title, start=None, allday=True)
    s = found[0]
    return jsonify(title=title, allday=s["allday"], start=s["start"].isoformat() if s["allday"] else s["start"].strftime("%Y-%m-%dT%H:%M"))


@ext_route("/event", methods=["POST"])
def event():
    need_tool("event")
    import agenda
    from datetime import datetime, timedelta
    f = request.get_json(force=True)
    title, start = str(f.get("title") or "").strip()[:120], str(f.get("start") or "")
    if not title or not start:
        raise ValueError("Indique un titre et une date")
    if f.get("allday") or len(start) == 10:
        d = {"title": title, "allday": True, "start": start[:10], "end": start[:10]}
    else:
        s = datetime.fromisoformat(start[:16])
        d = {"title": title, "allday": False, "start": s.strftime("%Y-%m-%dT%H:%M"), "end": (s + timedelta(minutes=int(f.get("minutes") or 60))).strftime("%Y-%m-%dT%H:%M"), "reminder": "30"}
    d["notes"] = str(f.get("notes") or "")[:1000]
    d["location"] = str(f.get("location") or "")[:120]
    agenda.write_event(g.user["name"], "personnel", d)
    return jsonify(ok=True, link="#/agenda")


@ext_route("/immo", methods=["POST"])
def immo_listing():
    """Annonce immobilière ouverte dans le navigateur : la page est lue par le NAS depuis le HTML envoyé."""
    need_tool("immo")
    import immo
    f = request.get_json(force=True)
    info = immo.parse_listing(str(f.get("html") or ""), str(f.get("url") or "")) if f.get("html") else {}
    url = str(f.get("url") or "")
    if not re.match(r"https?://", url):
        raise ValueError("Lien d'annonce invalide")
    l = immo.new_listing(g.user["name"], url, info)
    return jsonify(listing=l, link="#/immo/annonces", warning=None if l.get("price") else "Prix non lu : complète l'annonce dans l'outil Immobilier")


@ext_route("/search")
def search():
    from flask import current_app
    return current_app.view_functions["search"]()


# --- Prix -------------------------------------------------------------------------------------------

@ext_route("/prix/seen", methods=["POST"])
def prix_seen():
    need_tool("prix")
    import prix
    f = request.get_json(force=True)
    info = f.get("info") or {}
    if f.get("html"):  # page complète envoyée : le NAS la lit (plus complet que la lecture de l'extension)
        info = prix.parse_product(f["html"], f.get("url", "")) or info
    if not info or not prix.to_price(info.get("price")):
        return jsonify(product=None)
    return jsonify(product=prix.seen(g.user["name"], f.get("url", ""), info, follow=bool(f.get("follow"))))


@ext_route("/prix/product", methods=["POST"])
def prix_product():
    need_tool("prix")
    import prix
    f = request.get_json(force=True)
    d = prix.load(g.user["name"])
    p, _ = prix._find(d, pid=f.get("pid"), url=prix.clean_url(f["url"]) if f.get("url") else None)
    return jsonify(product=prix.public(p, prix.clean_url(f.get("url") or "")) if p else None)


@ext_route("/prix/follow", methods=["POST"])
def prix_follow():
    need_tool("prix")
    import prix
    f = request.get_json(force=True)

    def go(d):
        p, _ = prix._find(d, pid=f.get("pid"))
        if not p:
            raise ValueError("Produit introuvable")
        p["followed"] = bool(f.get("followed", True))
        if "target" in f:
            p["target"] = prix.to_price(f["target"]) if f["target"] not in (None, "") else None
    store.update(prix.key(g.user["name"]), prix.EMPTY, go)
    return jsonify(product=prix.summary(g.user["name"], f.get("pid"), prix.clean_url(f["url"]) if f.get("url") else None))


@ext_route("/prix/plan", methods=["POST"])
def prix_plan():
    need_tool("prix")
    import prix
    return jsonify(steps=prix.compare_plan(g.user["name"], (request.get_json(force=True) or {}).get("pid")))


@ext_route("/prix/page", methods=["POST"])
def prix_page():
    """Page lue par l'extension pendant une comparaison ou une relecture : kind = search, product ou refresh."""
    need_tool("prix")
    import prix
    f = request.get_json(force=True)
    user, html = g.user["name"], str(f.get("html") or "")[:6_000_000]
    if f.get("kind") == "refresh":
        return jsonify(ok=prix.refresh(user, f["pid"], f["url"], html=html, source="extension"))
    return jsonify(prix.compare_page(user, f.get("pid"), f.get("shop"), f.get("url", ""), html, f.get("kind")))


@ext_route("/prix/done", methods=["POST"])
def prix_done():
    import prix
    f = request.get_json(force=True) or {}
    pid = f.get("pid")
    store.update(prix.key(g.user["name"]), prix.EMPTY, lambda d: [p.__setitem__("compared", time.time()) for p in d["products"] if p["id"] == pid])
    return jsonify(product=prix.summary(g.user["name"], pid, prix.clean_url(f["url"]) if f.get("url") else None))


@ext_route("/prix/due")
def prix_due():
    import prix
    return jsonify(items=prix.due(g.user["name"], browser=True))


# --- Avant d'enregistrer un téléchargement : convertir ou extraire ------------------------------------

TOOL_OF.update(convert="convertir", archive="decompresser")


@ext_route("/convert/targets")
def convert_targets():
    """Formats possibles pour un nom de fichier, et si c'est une archive que le Décompresseur sait ouvrir."""
    import archives
    import converter
    name = str(request.args.get("name") or "")
    ext = converter.normalize_ext(os.path.splitext(name)[1])
    targets = []
    if allowed("convert"):
        for e in converter.ENGINES:
            if ext in e["inputs"]:
                targets += [t for t in e["outputs"] if t != ext and t not in targets]
    low = name.lower()
    is_archive = allowed("archive") and (bool(archives.TAR_RE.search(low)) or ext in archives.EXTENSIONS)
    return jsonify(ext=ext, targets=targets, archive=is_archive)


@ext_route("/convert", methods=["POST"])
def convert_start():
    need_tool("convert")
    import converter
    f = request.files.get("file")
    if not f or not f.filename:
        raise ValueError("Aucun fichier reçu")
    job = converter.submit(f, request.form.get("target", ""), request.form.get("nas") == "1", "Navigateur", g.user["name"])
    return jsonify(id=job)


@ext_route("/convert/<job_id>")
def convert_status(job_id):
    import converter
    j = next((x for x in converter.list_jobs() if x["id"] == job_id), None)
    if not j:
        raise ValueError("Conversion introuvable")
    return jsonify({k: j.get(k) for k in ("id", "status", "progress", "error", "output", "size", "saved", "name", "target")})


@ext_route("/convert/<job_id>/file")
def convert_result(job_id):
    import converter
    from flask import send_file
    path = converter.result_path(job_id)
    if not path or not os.path.exists(path):
        raise ValueError("Fichier converti introuvable")
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


@ext_route("/archive", methods=["POST"])
def archive_open():
    need_tool("archive")
    import archives
    f = request.files.get("file")
    if not f or not f.filename:
        raise ValueError("Aucun fichier reçu")
    return jsonify(archives.inspect(f))


@ext_route("/archive/<aid>/extract", methods=["POST"])
def archive_extract(aid):
    need_tool("archive")
    import archives
    d = request.get_json(silent=True) or {}
    dest = "server" if d.get("dest") == "server" else "download"
    r = archives.extract(aid, d.get("paths"), dest, d.get("subfolder") or None, d.get("password"))
    if r.get("download"):
        r["download"] = f"/api/v1/ext/archive/{aid}/file"
    return jsonify(r)


@ext_route("/archive/<aid>/password", methods=["POST"])
def archive_password(aid):
    need_tool("archive")
    import archives
    return jsonify(archives.describe(aid, (request.get_json(silent=True) or {}).get("password", "")))


@ext_route("/archive/<aid>/file")
def archive_result(aid):
    import archives
    from flask import send_file
    path = archives.result_path(aid)
    if not path or not os.path.exists(path):
        raise ValueError("Fichier extrait introuvable")
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))
