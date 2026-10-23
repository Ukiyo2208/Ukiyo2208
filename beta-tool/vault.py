"""Outil « Coffre » : intégration de Vaultwarden (serveur compatible Bitwarden),
lancé dans son propre conteneur. Bêta Tool affiche son état et le guide."""

import os
import urllib.request

from flask import Blueprint, jsonify

bp = Blueprint("vault", __name__)
INTERNAL = os.environ.get("VAULT_INTERNAL_URL", "http://vaultwarden").rstrip("/")
PUBLIC = os.environ.get("VAULT_URL", "").rstrip("/")


@bp.get("/api/vault/status")
def status():
    try:
        with urllib.request.urlopen(INTERNAL + "/alive", timeout=3) as r:
            ok = r.status == 200
    except Exception:
        ok = False
    return jsonify(ready=ok, url=PUBLIC)
