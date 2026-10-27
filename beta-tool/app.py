"""Bêta Tool : une boîte à outils web auto-hébergée (téléchargeur, convertisseur,
studio PDF, décompresseur, Bêta Work…)."""

import mimetypes
import os
import secrets
import shutil
from datetime import timedelta
from functools import wraps

from flask import Flask, abort, g, jsonify, redirect, request, send_file, send_from_directory, session
from waitress import serve

import accounts
import activity
import agenda
import archives
import auth
import backup
import clipboard
import converter
import downloader
import drop
import files
import forms
import imagetool
import links
import mail
import media
import monitor
import notes
import photos
import transcribe
import translate
import vault
import videotool
import vpn
import paperasse
import pdftools
import push
import recipes
import roots
import scanner
import settings
import storage
import store
import subscriptions
import suggestions
import updater
import work

mimetypes.add_type("text/javascript", ".mjs")  # modules pdf.js
mimetypes.add_type("application/manifest+json", ".webmanifest")

app = Flask(__name__, static_folder="static", static_url_path="")
# Icône et bannière : dossier de l'image (monté par docker-compose), même quand une mise à jour tourne
BRAND_DIR = os.path.join(os.environ.get("BETA_BASE_DIR", os.path.dirname(os.path.abspath(__file__))), "static", "brand")
BLUEPRINTS = []  # outils déclarés dans leur propre module (fichiers, partages, notes…)


@app.errorhandler(ValueError)
def bad_request(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(PermissionError)
def forbidden(e):
    return jsonify(error=str(e) or "Accès refusé"), 403


@app.errorhandler(converter.ConvertError)
def tool_failed(e):
    return jsonify(error=f"L'opération a échoué : {e}"), 500


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/brand/<path:name>")
def brand(name):
    return send_from_directory(BRAND_DIR, name)


@app.get("/statut")
def status_page():
    return app.send_static_file("status.html")


@app.get("/share")
def share_target():
    """Cible de partage de l'appli installée : « Partager → Bêta Tool » depuis YouTube…"""
    shared = request.args.get("url") or request.args.get("text") or ""
    from urllib.parse import quote
    return redirect("/#/telecharger?url=" + quote(shared))


# --- Connexion, comptes, rôles ---------------------------------------------

# Accessibles sans être connecté : page de connexion, ressources de la page, pages publiques
# (partages /d/, questionnaires /f/, liens courts /s/) et leurs API publiques.
PUBLIC = ("/login", "/login/code", "/style.css", "/js/i18n.js", "/i18n/", "/vendor/fonts/", "/brand/", "/manifest.webmanifest", "/sw.js", "/api/auth/mode",
          "/d/", "/f/", "/s/", "/public/", "/api/public/", "/statut", "/.well-known/")


def admin_only(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if g.user["role"] != "admin":
            raise PermissionError("Réservé aux administrateurs")
        return fn(*a, **kw)
    return wrapper


@app.before_request
def gatekeeper():
    g.user = auth.current()
    path = request.path
    tool = settings.blocked(path)
    if tool:
        return jsonify(error="Cet outil est désactivé dans les réglages"), 404
    if g.user or path.startswith(PUBLIC):
        return None
    # ONLYOFFICE appelle ces routes lui-même ; elles sont protégées par une signature
    if path.startswith("/api/work/") and path.endswith(("/raw", "/callback")):
        return None
    if path.startswith("/api/"):
        return jsonify(error="Connexion requise"), 401
    return redirect("/login")


@app.get("/login")
def login_page():
    return app.send_static_file("login.html")


@app.get("/api/auth/mode")
def auth_mode():
    return jsonify(mode=auth.mode(), site=settings.get()["site_name"])


@app.post("/login")
def login():
    result = auth.login(request.form.get("username", ""), request.form.get("password", ""))
    if result == "code":
        return redirect("/login?etape=code")
    return redirect("/" if result else "/login?erreur=1")


@app.post("/login/code")
def login_code():
    left = auth.login_code(request.form.get("code", ""))
    if left is False:
        return redirect("/login?etape=code&erreur=1" if session.get("pending") else "/login?erreur=expire")
    if left is not True:  # un code de secours vient d'être utilisé
        activity.log(session["user"], "reglages",
                     f"Code de secours utilisé : il t'en reste {left}", "#/reglages/comptes", "err")
    return redirect("/")


@app.post("/logout")
def logout():
    session.clear()
    return redirect("/login" if auth.mode() != "open" else "/")


@app.get("/api/config")
def config():
    s = settings.get()
    return jsonify(storage=settings.storage_name(), site=s["site_name"], tools=s["tools"], user=g.user,
                   mode=auth.mode(), version=updater.current_version(), prefs=user_prefs(g.user["name"]))


DEFAULT_PINS = ["telecharger", "convertir", "pdf", "fichiers", "paperasse", "presse-papier"]


def user_prefs(name):
    return {"pins": DEFAULT_PINS, "all_open": False, **store.load("prefs", {}).get(name, {})}


@app.put("/api/me/prefs")
def my_prefs():
    d = request.get_json(silent=True) or {}

    def go(data):
        p = data.setdefault(g.user["name"], {})
        if "pins" in d:
            p["pins"] = [str(t)[:40] for t in d["pins"] if isinstance(t, str)][:40]
        if "all_open" in d:
            p["all_open"] = bool(d["all_open"])
        if d.get("lang") in ("fr", "en"):
            p["lang"] = d["lang"]
    store.update("prefs", {}, go)
    return jsonify(user_prefs(g.user["name"]))


@app.get("/api/settings")
@admin_only
def settings_get():
    return jsonify(settings.get())


@app.put("/api/settings")
@admin_only
def settings_put():
    return jsonify(settings.update(request.get_json(silent=True) or {}))


@app.get("/api/users")
@admin_only
def users_list():
    return jsonify([auth.public(u) for u in auth.users()])


@app.post("/api/users")
@admin_only
def users_add():
    d = request.get_json(silent=True) or {}
    first = auth.mode() != "accounts"
    role = auth.add(d.get("name"), d.get("password"), d.get("role", "member"))
    if first:  # premier compte : on connecte directement la personne qui l'a créé
        session.permanent = True
        session["user"] = d.get("name").strip()
    return jsonify(ok=True, role=role, first=first)


@app.put("/api/users/<name>")
@admin_only
def users_edit(name):
    d = request.get_json(silent=True) or {}
    if d.get("password"):
        auth.set_password(name, d["password"])
    if d.get("role"):
        auth.set_role(name, d["role"])
    return jsonify(ok=True)


@app.delete("/api/users/<name>")
@admin_only
def users_delete(name):
    if name == g.user["name"]:
        raise ValueError("Tu ne peux pas supprimer ton propre compte")
    auth.delete(name)
    return jsonify(ok=True)


@app.post("/api/me/password")
def my_password():
    if auth.mode() != "accounts":
        raise ValueError("Pas de compte à modifier (crée d'abord des comptes dans Réglages)")
    d = request.get_json(silent=True) or {}
    if not auth.check_password(g.user["name"], d.get("old", "")):
        raise ValueError("Mot de passe actuel incorrect")
    auth.set_password(g.user["name"], d.get("new", ""))
    return jsonify(ok=True)


@app.get("/api/me/2fa")
def my_2fa():
    return jsonify(auth.twofa_status(g.user["name"]) if auth.mode() == "accounts" else {"enabled": False, "unavailable": True})


@app.post("/api/me/2fa/setup")
def my_2fa_setup():
    if auth.mode() != "accounts":
        raise ValueError("La double authentification demande des comptes (Réglages → Comptes)")
    if not auth.check_password(g.user["name"], (request.get_json(silent=True) or {}).get("password", "")):
        raise ValueError("Mot de passe incorrect")
    return jsonify(auth.twofa_setup(g.user["name"], settings.get()["site_name"] or "Bêta Tool"))


@app.post("/api/me/2fa/enable")
def my_2fa_enable():
    codes = auth.twofa_enable(g.user["name"], (request.get_json(silent=True) or {}).get("code"))
    activity.log(g.user["name"], "reglages", "Double authentification activée", "#/reglages/comptes")
    return jsonify(codes=codes)


@app.post("/api/me/2fa/disable")
def my_2fa_disable():
    if not auth.check_password(g.user["name"], (request.get_json(silent=True) or {}).get("password", "")):
        raise ValueError("Mot de passe incorrect")
    auth.twofa_disable(g.user["name"])
    return jsonify(ok=True)


@app.delete("/api/users/<name>/2fa")
@admin_only
def users_reset_2fa(name):
    auth.twofa_disable(name)
    return jsonify(ok=True)


# --- Mises à jour ------------------------------------------------------------

@app.get("/api/update")
@admin_only
def update_info():
    return jsonify({**updater.info(), "ytdlp": updater.ytdlp_version(), "update_url": settings.get()["update_url"]})


@app.post("/api/update/check")
@admin_only
def update_check():
    return jsonify(updater.check((request.get_json(silent=True) or {}).get("url") or settings.get()["update_url"]))


@app.post("/api/update/install")
@admin_only
def update_install():
    force = request.args.get("force") == "1"
    if request.files.get("file"):
        result = updater.install(request.files["file"].read(), force=force)
    else:
        d = request.get_json(silent=True) or {}
        result = updater.install_url(d.get("url", "").strip(), d.get("sha256"), force)
    activity.log("*", "reglages", f"Bêta Tool mis à jour en version {result['version']}", "#/reglages/maj")
    return jsonify(result)


@app.post("/api/update/use")
@admin_only
def update_use():
    updater.use((request.get_json(silent=True) or {}).get("version", "builtin"))
    return jsonify(ok=True)


@app.post("/api/update/ytdlp")
@admin_only
def update_ytdlp():
    updater.update_ytdlp()
    return jsonify(ok=True)


@app.post("/api/restart")
@admin_only
def restart():
    updater.restart()
    return jsonify(ok=True)


# --- Historique, recherche, tableau de bord ---------------------------------

@app.get("/api/activity")
def activity_list():
    return jsonify(activity.recent(g.user["name"], int(request.args.get("since", 0) or 0)))


@app.get("/api/dashboard")
def dashboard():
    disks = {}
    for r in roots.all_roots():
        try:
            st = os.stat(r["path"])
            usage = shutil.disk_usage(r["path"])
        except OSError:
            continue
        d = disks.setdefault(st.st_dev, {"total": usage.total, "used": usage.used, "free": usage.free, "roots": []})
        d["roots"].append(r["label"])
    counts = {"documents": len(work.list_docs()) if settings.enabled("work") else None}
    tools = settings.get()["tools"]
    for name, fn in COUNTERS.items():
        if not tools.get({"partages": "drop"}.get(name, name), True):
            continue
        try:
            counts[name] = fn(g.user["name"])
        except Exception:
            counts[name] = None
    return jsonify(disks=list(disks.values()), counts=counts, activity=activity.recent(g.user["name"], limit=5),
                   version=updater.current_version())


COUNTERS = {}  # outils qui exposent un compteur pour le tableau de bord (notes, partages…)
SEARCHERS = {}  # outils qui participent à la recherche globale


@app.get("/api/search")
def search():
    q = (request.args.get("q") or "").strip().lower()
    if len(q) < 2:
        return jsonify([])
    results = []
    tools = settings.get()["tools"]
    if tools.get("work"):
        results += [{"type": "document", "title": d["name"], "sub": "Bêta Work", "link": f"#/work/{d['id']}", "kind": d["kind"]}
                    for d in work.list_docs() if q in d["name"].lower()][:8]
    for tool, fn in SEARCHERS.items():
        if tools.get(tool, True):
            try:
                results += fn(q, g.user["name"])
            except Exception as e:  # une source en panne ne casse pas la recherche
                print("recherche", tool, e)
    return jsonify(results[:40])


# --- Téléchargeur -----------------------------------------------------------

@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    return jsonify(ids=downloader.submit(data.get("url"), data.get("mode"), data.get("subfolder"),
                                         data.get("keep", True) is not False, g.user["name"]))


@app.get("/api/download/jobs")
def download_jobs():
    return jsonify(downloader.list_jobs())


@app.get("/api/download/<job_id>/file/<int:index>")
def download_file(job_id, index):
    path = downloader.file_path(job_id, index)
    if not path:
        abort(404)
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


# --- Convertisseur ----------------------------------------------------------

@app.get("/api/convert/formats")
def convert_formats():
    return jsonify(converter.formats())


@app.post("/api/convert")
def convert():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        raise ValueError("Aucun fichier reçu")
    job_id = converter.submit(upload, request.form.get("target", ""),
                              request.form.get("nas") == "1", request.form.get("subfolder"), g.user["name"])
    return jsonify(id=job_id)


@app.get("/api/convert/jobs")
def convert_jobs():
    return jsonify(converter.list_jobs())


@app.get("/api/convert/<job_id>/file")
def convert_file(job_id):
    path = converter.result_path(job_id)
    if not path or not os.path.exists(path):
        abort(404)
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


# --- Studio PDF -------------------------------------------------------------

def uploaded():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        raise ValueError("Aucun fichier reçu")
    return upload


def send_pdf(result):
    f, name, headers = result
    resp = send_file(f, mimetype="application/pdf", as_attachment=True, download_name=name)
    resp.headers.update(headers)
    resp.headers["Access-Control-Expose-Headers"] = ", ".join(["Content-Disposition", *headers])
    return resp


@app.post("/api/pdf/compress")
def pdf_compress():
    return send_pdf(pdftools.compress(uploaded(), request.form.get("level")))


@app.post("/api/pdf/protect")
def pdf_protect():
    f = request.form
    return send_pdf(pdftools.protect(uploaded(), f.get("password"), f.get("owner"),
                                     f.get("print") == "1", f.get("copy") == "1", f.get("edit") == "1"))


@app.post("/api/pdf/unlock")
def pdf_unlock():
    return send_pdf(pdftools.unlock(uploaded(), request.form.get("password")))


@app.post("/api/pdf/ocr")
def pdf_ocr():
    return send_pdf(pdftools.ocr(uploaded(), request.form.get("lang"), request.form.get("force") == "1"))


SAVE_DIRS = {"pdf": lambda: pdftools.PDF_DIR, "archive": lambda: archives.UNZIP_DIR,
             "image": lambda: os.path.join(converter.CONVERT_DIR, "Images")}


@app.post("/api/save")
@app.post("/api/pdf/save")
def save():
    """Enregistre sur le NAS un fichier produit dans le navigateur."""
    folder = SAVE_DIRS.get(request.args.get("tool", "pdf"), SAVE_DIRS["pdf"])()
    return jsonify(saved=pdftools.save_to_nas(uploaded(), request.form.get("subfolder"), folder))


# --- Décompresseur ----------------------------------------------------------

@app.post("/api/archive")
def archive_open():
    return jsonify(archives.inspect(uploaded()))


@app.post("/api/archive/<aid>/password")
def archive_password(aid):
    return jsonify(archives.describe(aid, (request.get_json(silent=True) or {}).get("password", "")))


@app.post("/api/archive/<aid>/extract")
def archive_extract(aid):
    d = request.get_json(silent=True) or {}
    return jsonify(archives.extract(aid, d.get("paths"), d.get("dest"), d.get("subfolder"), d.get("password")))


@app.get("/api/archive/<aid>/file")
def archive_file(aid):
    path = archives.result_path(aid)
    if not path or not os.path.exists(path):
        abort(404)
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


# --- Bêta Work --------------------------------------------------------------

@app.get("/api/work/status")
def work_status():
    return jsonify(work.status())


@app.get("/api/work/docs")
def work_docs():
    return jsonify(work.list_docs())


@app.post("/api/work/new")
def work_new():
    d = request.get_json(silent=True) or {}
    return jsonify(work.create(d.get("kind"), d.get("name")))


@app.post("/api/work/upload")
def work_upload():
    return jsonify(work.upload(uploaded()))


@app.post("/api/work/<doc>/rename")
def work_rename(doc):
    return jsonify(work.rename(doc, (request.get_json(silent=True) or {}).get("name", "")))


@app.delete("/api/work/<doc>")
def work_delete(doc):
    work.delete(doc)
    return jsonify(ok=True)


@app.get("/api/work/<doc>/download")
def work_download(doc):
    path, _ = work.resolve(doc)
    return send_file(path, as_attachment=True, download_name=os.path.basename(path))


@app.get("/api/work/<doc>/config")
def work_config(doc):
    a = request.args
    return jsonify(work.editor_config(doc, a.get("user"), a.get("theme"), a.get("mobile") == "1"))


@app.get("/api/work/<doc>/raw")
def work_raw(doc):
    if not work.check_url(doc, request.args.get("exp"), request.args.get("sig")):
        abort(403)
    path, _ = work.resolve(doc)
    return send_file(path, download_name=os.path.basename(path))


@app.post("/api/work/<doc>/callback")
def work_callback(doc):
    if not work.check_url(doc, request.args.get("exp"), request.args.get("sig")):
        abort(403)
    return jsonify(work.callback(doc, request.get_json(silent=True) or {}, request.headers.get("Authorization")))


# --- Suggestions ------------------------------------------------------------

@app.post("/api/suggestions")
def suggestion_add():
    return jsonify(suggestions.add(request.get_json(silent=True) or {}))


@app.get("/api/suggestions")
def suggestion_list():
    return jsonify(suggestions.list_all())


def secret_key():
    """Clé de session stable entre deux redémarrages (gardée dans DATA_DIR)."""
    path = store.path("secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


for module in (files, drop, media, photos, videotool, transcribe, imagetool, forms, notes, links, backup, vault, push, subscriptions, clipboard, monitor, paperasse, scanner, storage, recipes, agenda, translate, vpn, accounts, mail):
    app.register_blueprint(module.bp)
SEARCHERS.update(fichiers=files.search, drop=drop.search, medias=media.search, questionnaires=forms.search, notes=notes.search,
                 liens=links.search, abonnements=subscriptions.search,
                 paperasse=paperasse.search, recettes=recipes.search, agenda=agenda.search, **{"presse-papier": clipboard.search})
COUNTERS.update(mails=mail.count, recettes=recipes.count, paperasse=paperasse.count, abonnements=subscriptions.count, partages=drop.count, questionnaires=forms.count, notes=notes.count, liens=links.count)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    downloader.start(int(os.environ.get("WORKERS", "2")))
    converter.start(int(os.environ.get("CONVERT_WORKERS", "2")))
    store.start()
    pdftools.start()
    suggestions.start()
    archives.start()
    work.start()
    files.start()
    drop.start()
    photos.start()
    videotool.start()
    transcribe.start()
    imagetool.start()
    backup.start()
    subscriptions.start()
    clipboard.start()
    monitor.start()
    paperasse.start()
    agenda.start()
    translate.start()
    mail.start()
    dav = agenda.radicale_app()
    if dav:  # serveur CalDAV des agendas (synchronisation des téléphones)
        from werkzeug.middleware.dispatcher import DispatcherMiddleware
        def dav_gate(environ, start_response):
            if not settings.enabled("agenda"):
                start_response("404 Not Found", [("Content-Type", "text/plain")])
                return [b"Agenda desactive"]
            return dav(environ, start_response)
        app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {"/dav": dav_gate})
    app.secret_key = secret_key()
    app.permanent_session_lifetime = timedelta(days=30)
    max_upload = int(float(os.environ.get("MAX_UPLOAD_GB", "20")) * 1024 ** 3)
    print(f"Bêta Tool prêt sur http://0.0.0.0:{port}")
    serve(app, host="0.0.0.0", port=port, threads=8, max_request_body_size=max_upload)
