"""Outil « Scanner », partie serveur : le PDF est assemblé dans le navigateur ; ici on
ajoute le texte cherchable (OCR) et on l'enregistre (NAS ou Paperasse)."""

import os
import shutil
import uuid

from flask import Blueprint, g, jsonify, request, send_file

import doctype
import paperasse
import pdftools
from converter import WORK_DIR, sanitize_name, unique_path

bp = Blueprint("scanner", __name__)
SCANS = "Scans"


@bp.post("/api/scan/save")
def save():
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    name = sanitize_name(f.filename or "Scan.pdf")
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    dest = request.form.get("dest", "nas")
    work = os.path.join(WORK_DIR, "scan-" + uuid.uuid4().hex[:8])
    os.makedirs(work)
    src = os.path.join(work, "scan.pdf")
    f.save(src)
    if dest == "paperasse":  # Paperasse se charge de l'OCR et du classement
        paperasse.enqueue(src, name, g.user["name"], "scan")
        return jsonify(ok=True)
    try:
        out = src
        if request.form.get("ocr") == "1":
            ocr = os.path.join(work, "ocr.pdf")
            if doctype.ocr_pdf(src, ocr, os.path.join(work, "ocr.txt"), force=True) and os.path.exists(ocr):
                out = ocr
        if dest == "device":
            return send_file(open(out, "rb"), mimetype="application/pdf", download_name=name, as_attachment=True)
        folder = os.path.join(pdftools.PDF_DIR, SCANS)
        os.makedirs(folder, exist_ok=True)
        target = unique_path(folder, name)
        shutil.move(out, target)
        return jsonify(saved=os.path.relpath(target, pdftools.PDF_DIR))
    finally:
        shutil.rmtree(work, ignore_errors=True)
