"""Réglages du site (fichier settings.json dans DATA_DIR) et registre des outils.

Un outil désactivé disparaît de l'interface et ses routes /api répondent 404."""

import os

import store

# id : (préfixes des routes de l'outil, activé par défaut)
TOOLS = {
    "telecharger": (["/api/download"], True),
    "convertir": (["/api/convert"], True),
    "pdf": (["/api/pdf"], True),
    "decompresser": (["/api/archive"], True),
    "work": (["/api/work/docs", "/api/work/new", "/api/work/upload", "/api/work/status"], True),
    "fichiers": (["/api/files"], True),
    "drop": (["/api/drop", "/d/", "/api/public/drop"], True),
    "medias": (["/api/media"], True),
    "photos": (["/api/photos"], True),
    "video": (["/api/video"], True),
    "image": (["/api/image"], True),
    "transcription": (["/api/transcribe"], True),
    "questionnaires": (["/api/forms", "/f/", "/api/public/forms"], True),
    "notes": (["/api/notes"], True),
    "qr": ([], True),
    "liens": (["/api/links", "/s/"], True),
    "coffre": (["/api/vault"], False),
    "sauvegardes": (["/api/backup"], True),
}
DEFAULTS = {"tools": {}, "storage_name": "", "update_url": "", "site_name": "Bêta Tool"}


def get():
    data = {**DEFAULTS, **store.load("settings", {})}
    data["tools"] = {t: data["tools"].get(t, default) for t, (_, default) in TOOLS.items()}
    return data


def update(patch):
    def go(data):
        if "tools" in patch:
            data.setdefault("tools", {})
            for t, on in (patch["tools"] or {}).items():
                if t in TOOLS:
                    data["tools"][t] = bool(on)
        for key in ("storage_name", "update_url", "site_name"):
            if key in patch:
                data[key] = str(patch[key] or "").strip()[:200]
    store.update("settings", {}, go)
    return get()


def enabled(tool):
    return get()["tools"].get(tool, True)


def blocked(path):
    """Renvoie l'outil désactivé auquel appartient cette route, ou None."""
    tools = get()["tools"]
    for tool, (prefixes, _) in TOOLS.items():
        if not tools.get(tool, True) and any(path.startswith(p) for p in prefixes):
            return tool
    return None


def storage_name():
    return get()["storage_name"] or os.environ.get("STORAGE_NAME", "NAS")
