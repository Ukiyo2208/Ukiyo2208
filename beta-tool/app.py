"""Bêta Tool : une boîte à outils web pour le NAS (téléchargeur, convertisseur…)."""

import os

from flask import Flask, abort, jsonify, request, send_file
from waitress import serve

import converter
import downloader

app = Flask(__name__, static_folder="static", static_url_path="")


@app.errorhandler(ValueError)
def bad_request(e):
    return jsonify(error=str(e)), 400


@app.get("/")
def index():
    return app.send_static_file("index.html")


# --- Téléchargeur -----------------------------------------------------------

@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    return jsonify(ids=downloader.submit(data.get("url"), data.get("mode"), data.get("subfolder")))


@app.get("/api/download/jobs")
def download_jobs():
    return jsonify(downloader.list_jobs())


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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    downloader.start(int(os.environ.get("WORKERS", "2")))
    converter.start(int(os.environ.get("CONVERT_WORKERS", "2")))
    max_upload = int(float(os.environ.get("MAX_UPLOAD_GB", "20")) * 1024 ** 3)
    print(f"Bêta Tool prêt sur http://0.0.0.0:{port}")
    serve(app, host="0.0.0.0", port=port, threads=8, max_request_body_size=max_upload)
