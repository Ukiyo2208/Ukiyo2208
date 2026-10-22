"""Bêta Tool : une boîte à outils web auto-hébergée (téléchargeur, convertisseur,
studio PDF, décompresseur, Bêta Work…)."""

import hmac
import mimetypes
import os
import secrets
from datetime import timedelta

from flask import Flask, abort, jsonify, redirect, request, send_file, session
from waitress import serve

import archives
import converter
import downloader
import pdftools
import suggestions
import work

mimetypes.add_type("text/javascript", ".mjs")  # modules pdf.js

app = Flask(__name__, static_folder="static", static_url_path="")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
STORAGE_NAME = os.environ.get("STORAGE_NAME", "NAS")  # « NAS », « serveur », « PC »… selon l'hébergement


@app.errorhandler(ValueError)
def bad_request(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(converter.ConvertError)
def tool_failed(e):
    return jsonify(error=f"L'opération a échoué : {e}"), 500


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/config")
def config():
    return jsonify(storage=STORAGE_NAME, auth=bool(APP_PASSWORD))


# --- Mot de passe (optionnel, conseillé si le site est accessible depuis Internet) ---

PUBLIC = ("/login", "/style.css", "/vendor/fonts/", "/brand/")


@app.before_request
def require_login():
    if not APP_PASSWORD or session.get("ok") or request.path.startswith(PUBLIC):
        return None
    # ONLYOFFICE appelle ces routes lui-même ; elles sont protégées par une signature
    if request.path.startswith("/api/work/") and request.path.endswith(("/raw", "/callback")):
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="Connexion requise"), 401
    return redirect("/login")


@app.get("/login")
def login_page():
    return app.send_static_file("login.html")


@app.post("/login")
def login():
    if APP_PASSWORD and hmac.compare_digest(request.form.get("password", ""), APP_PASSWORD):
        session.permanent = True
        session["ok"] = True
        return redirect("/")
    return redirect("/login?erreur=1")


@app.post("/logout")
def logout():
    session.clear()
    return redirect("/login")


# --- Téléchargeur -----------------------------------------------------------

@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    return jsonify(ids=downloader.submit(data.get("url"), data.get("mode"), data.get("subfolder"), data.get("keep", True) is not False))


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
                              request.form.get("nas") == "1", request.form.get("subfolder"))
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


SAVE_DIRS = {"pdf": lambda: pdftools.PDF_DIR, "archive": lambda: archives.UNZIP_DIR}


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
    path = os.path.join(suggestions.DATA_DIR, "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    downloader.start(int(os.environ.get("WORKERS", "2")))
    converter.start(int(os.environ.get("CONVERT_WORKERS", "2")))
    pdftools.start()
    suggestions.start()
    archives.start()
    work.start()
    app.secret_key = secret_key()
    app.permanent_session_lifetime = timedelta(days=30)
    max_upload = int(float(os.environ.get("MAX_UPLOAD_GB", "20")) * 1024 ** 3)
    print(f"Bêta Tool prêt sur http://0.0.0.0:{port}")
    serve(app, host="0.0.0.0", port=port, threads=8, max_request_body_size=max_upload)
