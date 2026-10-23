"""Outil « Bêta Notes » : notes en Markdown (avec cases à cocher), rangées par
dossier, propres à chaque compte (DATA_DIR/notes/<compte>.json)."""

import re
import secrets
import time

from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("notes", __name__)
COLORS = {"", "bleu", "vert", "jaune", "rouge", "violet"}


def key(user):
    return "notes/" + re.sub(r"[^\w.-]", "_", user)


def all_notes(user):
    return store.load(key(user), [])


@bp.get("/api/notes")
def list_notes():
    return jsonify(sorted(all_notes(g.user["name"]), key=lambda n: (not n.get("pinned"), -n["updated"])))


@bp.post("/api/notes")
def create():
    d = request.get_json(silent=True) or {}
    note = {"id": secrets.token_hex(5), "title": str(d.get("title") or "")[:200], "body": str(d.get("body") or "")[:200000],
            "folder": str(d.get("folder") or "")[:60], "pinned": False, "color": "", "trashed": False,
            "created": time.time(), "updated": time.time()}
    store.update(key(g.user["name"]), [], lambda notes: notes.append(note))
    return jsonify(note)


@bp.put("/api/notes/<nid>")
def update(nid):
    d = request.get_json(silent=True) or {}

    def go(notes):
        n = next((n for n in notes if n["id"] == nid), None)
        if not n:
            raise ValueError("Note introuvable")
        if "title" in d:
            n["title"] = str(d["title"])[:200]
        if "body" in d:
            n["body"] = str(d["body"])[:200000]
        if "folder" in d:
            n["folder"] = str(d["folder"] or "")[:60]
        if "pinned" in d:
            n["pinned"] = bool(d["pinned"])
        if "trashed" in d:
            n["trashed"] = bool(d["trashed"])
        if d.get("color") in COLORS:
            n["color"] = d["color"]
        n["updated"] = time.time()
        return n
    return jsonify(store.update(key(g.user["name"]), [], go))


@bp.delete("/api/notes/<nid>")
def delete(nid):
    store.update(key(g.user["name"]), [], lambda notes: notes.__setitem__(slice(None), [n for n in notes if n["id"] != nid]))
    return jsonify(ok=True)


def search(q, user):
    out = []
    for n in all_notes(user):
        if n.get("trashed"):
            continue
        if q in n["title"].lower() or q in n["body"].lower():
            i = n["body"].lower().find(q)
            excerpt = n["body"][max(0, i - 30):i + 60].replace("\n", " ") if i >= 0 else n["body"][:80]
            out.append({"type": "note", "title": n["title"] or "Sans titre", "sub": excerpt, "link": f"#/notes/{n['id']}"})
    return out[:8]


def count(user):
    return sum(1 for n in all_notes(user) if not n.get("trashed"))
