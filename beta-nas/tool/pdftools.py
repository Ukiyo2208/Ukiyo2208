"""Outil « Studio PDF », partie serveur : les opérations qu'un navigateur ne sait
pas faire seul (compression Ghostscript, chiffrement, OCR) et l'enregistrement
sur le NAS. L'édition, la signature, l'organisation des pages, la fusion… se
font directement dans le navigateur (pdf.js + pdf-lib)."""

import os
import shutil
import subprocess
import sys
import tempfile
import uuid

import pikepdf

from converter import ConvertError, WORK_DIR, error_tail, run, sanitize_name, unique_path
from downloader import safe_subfolder

PDF_DIR = os.environ.get("PDF_DIR", "/pdf")

COMPRESS_LEVELS = {"forte": "/screen", "equilibree": "/ebook", "legere": "/printer"}


class Workspace:
    """Dossier temporaire pour une opération ; supprimé à la sortie du bloc."""

    def __init__(self, upload):
        self.dir = os.path.join(WORK_DIR, "pdf-" + uuid.uuid4().hex[:10])
        os.makedirs(self.dir)
        self.name = sanitize_name(upload.filename)
        if not self.name.lower().endswith(".pdf"):
            self.name += ".pdf"
        self.src = os.path.join(self.dir, "source.pdf")
        upload.save(self.src)
        self.dst = os.path.join(self.dir, "resultat.pdf")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.dir, ignore_errors=True)

    def result(self, suffix):
        """Ouvre le résultat (le fichier reste lisible après suppression du dossier)."""
        stem = os.path.splitext(self.name)[0]
        return open(self.dst, "rb"), f"{stem}-{suffix}.pdf"


def compress(upload, level):
    with Workspace(upload) as ws:
        run(["gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6",
             f"-dPDFSETTINGS={COMPRESS_LEVELS.get(level, '/ebook')}",
             "-dDetectDuplicateImages=true", "-dNOPAUSE", "-dBATCH", "-dQUIET",
             f"-sOutputFile={ws.dst}", ws.src], timeout=900)
        before, after = os.path.getsize(ws.src), os.path.getsize(ws.dst)
        if after >= before:  # déjà optimisé : on rend l'original plutôt qu'un fichier plus gros
            shutil.copy(ws.src, ws.dst)
            after = before
        f, name = ws.result("compresse")
        return f, name, {"X-Size-Before": str(before), "X-Size-After": str(after)}


def protect(upload, password, owner_password, allow_print, allow_copy, allow_edit):
    if not password:
        raise ValueError("Choisis un mot de passe")
    with Workspace(upload) as ws:
        try:
            pdf = pikepdf.open(ws.src)
        except pikepdf.PasswordError:
            raise ValueError("Ce PDF est déjà protégé : déverrouille-le d'abord") from None
        with pdf:
            perms = pikepdf.Permissions(print_lowres=allow_print, print_highres=allow_print,
                                        extract=allow_copy, accessibility=True,
                                        modify_other=allow_edit, modify_annotation=allow_edit,
                                        modify_form=allow_edit, modify_assembly=allow_edit)
            pdf.save(ws.dst, encryption=pikepdf.Encryption(user=password, owner=owner_password or password,
                                                           R=6, allow=perms))
        return ws.result("protege") + ({},)


def unlock(upload, password):
    with Workspace(upload) as ws:
        try:
            with pikepdf.open(ws.src, password=password or "") as pdf:
                pdf.save(ws.dst)
        except pikepdf.PasswordError:
            raise ValueError("Mot de passe incorrect") from None
        return ws.result("deverrouille") + ({},)


def ocr(upload, language, force):
    langs = "+".join(l for l in (language or "fra+eng").split("+") if l in ("fra", "eng")) or "fra"
    with Workspace(upload) as ws:
        cmd = [sys.executable, "-m", "ocrmypdf", "-l", langs, "--rotate-pages", "--deskew",
               "--output-type", "pdf", "--force-ocr" if force else "--skip-text", ws.src, ws.dst]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if proc.returncode not in (0, 4):  # 4 = avertissement non bloquant
            raise ConvertError(error_tail(proc.stderr))
        return ws.result("ocr") + ({},)


def save_to_nas(upload, subfolder, base=None):
    base = base or PDF_DIR
    folder = os.path.join(base, safe_subfolder(subfolder))
    os.makedirs(folder, exist_ok=True)
    dest = unique_path(folder, sanitize_name(upload.filename))
    upload.save(dest)
    return os.path.relpath(dest, base)


def start():
    os.makedirs(PDF_DIR, exist_ok=True)
