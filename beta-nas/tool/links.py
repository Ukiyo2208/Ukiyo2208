"""Outil « Liens courts » : /s/<code> redirige vers une longue adresse et compte les clics."""

import re
import secrets
import string
import time

from flask import Blueprint, g, jsonify, redirect, request

import store

bp = Blueprint("links", __name__)
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{2,40}$")


def links():
    return store.load("links", {})


@bp.get("/api/links")
def list_links():
    out = [l for l in links().values() if l["owner"] == g.user["name"] or g.user["role"] == "admin"]
    return jsonify(sorted(out, key=lambda l: -l["created"]))


@bp.post("/api/links")
def create():
    d = request.get_json(silent=True) or {}
    url = str(d.get("url") or "").strip()
    if not re.match(r"^https?://[^\s/$.?#].\S*$", url, re.I):
        raise ValueError("Adresse invalide : elle doit commencer par http:// ou https://")
    code = str(d.get("code") or "").strip()
    if code and not CODE_RE.match(code):
        raise ValueError("Code invalide (2 à 40 lettres, chiffres, - ou _)")

    def go(all_):
        c = code
        if c and c in all_:
            raise ValueError("Ce code est déjà utilisé")
        while not c or c in all_:
            c = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(5))
        all_[c] = {"code": c, "url": url, "title": str(d.get("title") or "")[:120], "owner": g.user["name"],
                   "created": time.time(), "clicks": 0, "last": None}
        return all_[c]
    return jsonify(store.update("links", {}, go))


@bp.delete("/api/links/<code>")
def delete(code):
    def go(all_):
        l = all_.get(code)
        if not l or (l["owner"] != g.user["name"] and g.user["role"] != "admin"):
            raise ValueError("Lien introuvable")
        del all_[code]
    store.update("links", {}, go)
    return jsonify(ok=True)


@bp.get("/s/<code>")
def follow(code):
    def go(all_):
        l = all_.get(code)
        if l:
            l["clicks"] += 1
            l["last"] = time.time()
        return l
    l = store.update("links", {}, go)
    if not l:
        return "Ce lien n'existe pas ou a été supprimé.", 404
    return redirect(l["url"], 302)


def search(q, user):
    return [{"type": "link", "title": "/s/" + l["code"], "sub": l["url"], "link": "#/liens"}
            for l in links().values() if l["owner"] == user and (q in l["code"].lower() or q in l["url"].lower() or q in l["title"].lower())][:6]


def count(user):
    return sum(1 for l in links().values() if l["owner"] == user)
