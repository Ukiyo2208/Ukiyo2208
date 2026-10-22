"""Boîte à idées : les suggestions envoyées depuis le site sont gardées dans un
fichier JSON Lines sur le NAS (une ligne par suggestion)."""

import json
import os
import threading
import time

DATA_DIR = os.environ.get("DATA_DIR", "/data")
FILE = os.path.join(DATA_DIR, "suggestions.jsonl")
KINDS = {"idee": "Idée d'outil", "amelioration": "Amélioration", "bug": "Problème"}
TOOLS = {"general", "telecharger", "convertir", "pdf", "decompresser", "work"}
lock = threading.Lock()


def add(data):
    message = str(data.get("message") or "").strip()
    if len(message) < 3:
        raise ValueError("Écris ta suggestion avant d'envoyer")
    entry = {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "kind": data.get("kind") if data.get("kind") in KINDS else "idee",
        "tool": data.get("tool") if data.get("tool") in TOOLS else "general",
        "name": str(data.get("name") or "").strip()[:80],
        "message": message[:4000],
    }
    with lock, open(FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def list_all():
    if not os.path.exists(FILE):
        return []
    with lock, open(FILE, encoding="utf-8") as f:
        return [json.loads(l) for l in reversed(f.read().splitlines()) if l.strip()]


def start():
    os.makedirs(DATA_DIR, exist_ok=True)
