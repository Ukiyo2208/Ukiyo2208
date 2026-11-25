"""Outil « Inventaire » : ce qu'il y a à la maison, pièce par pièce.

Pour chaque objet : photo, prix, date d'achat, garantie, numéro de série, facture (de Paperasse).
Sert à retrouver une garantie, à savoir ce qu'on a au congélateur ou dans la pharmacie (dates de
péremption), et à préparer une déclaration à l'assurance habitation (export avec la valeur totale).
L'inventaire est commun à toute la maison."""

import csv
import io
import os
import threading
import time
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, g, jsonify, request, send_file

import activity
import store

bp = Blueprint("inventaire", __name__)
PHOTOS = store.path("inventaire", "photos")
ROOMS = ["Salon", "Cuisine", "Chambre", "Salle de bain", "Bureau", "Garage", "Cave", "Grenier", "Jardin", "Entrée", "Buanderie"]
CATEGORIES = [("Électroménager", "home"), ("Informatique", "monitor"), ("Image & son", "music"), ("Téléphonie", "phone"), ("Meubles", "grid"),
              ("Outils", "settings"), ("Véhicules & vélos", "car"), ("Bijoux & valeur", "star"), ("Vêtements", "tag"), ("Jeux & loisirs", "sparkles"),
              ("Alimentation", "utensils"), ("Pharmacie", "heart"), ("Autres", "file")]
FIELDS = {"name": 120, "room": 60, "place": 80, "category": 40, "brand": 60, "model": 80, "serial": 80, "notes": 2000, "shop": 80}


def load():
    return store.load("inventaire", {"items": []})


def _date(v):
    v = str(v or "")[:10]
    if v:
        date.fromisoformat(v)
    return v


def _clean(f, old=None):
    it = dict(old or {"id": uuid.uuid4().hex[:10], "added": time.time(), "qty": 1})
    for k, n in FIELDS.items():
        if k in f:
            it[k] = str(f[k] or "").strip()[:n]
    if not it.get("name"):
        raise ValueError("Donne un nom à l'objet")
    for k in ("bought", "warranty", "expires"):
        if k in f:
            it[k] = _date(f[k])
    if "warranty_years" in f and f["warranty_years"] not in ("", None) and it.get("bought"):  # garantie en années depuis l'achat
        b = date.fromisoformat(it["bought"])
        y = int(float(f["warranty_years"]))
        try:
            it["warranty"] = b.replace(year=b.year + y).isoformat()
        except ValueError:
            it["warranty"] = b.replace(year=b.year + y, day=28).isoformat()
    if "price" in f:
        p = str(f["price"] or "").replace(",", ".").replace("€", "").strip()
        it["price"] = round(float(p), 2) if p else None
    if "qty" in f:
        it["qty"] = max(0, min(9999, int(float(f["qty"] or 1))))
    if "paper" in f:
        it["paper"] = str(f["paper"] or "")[:40]
    it["updated"] = time.time()
    return it


def status(it, today=None):
    """État à signaler : garantie bientôt finie, périmé…"""
    today = today or date.today()
    out = []
    if it.get("warranty"):
        w = date.fromisoformat(it["warranty"])
        if w >= today:
            days = (w - today).days
            out.append({"kind": "warranty", "level": "warn" if days <= 60 else "ok", "text": f"Garanti jusqu'au {w.strftime('%d/%m/%Y')}", "days": days})
        else:
            out.append({"kind": "warranty", "level": "off", "text": "Garantie terminée", "days": (w - today).days})
    if it.get("expires"):
        e = date.fromisoformat(it["expires"])
        days = (e - today).days
        out.append({"kind": "expires", "level": "bad" if days < 0 else "warn" if days <= 7 else "ok",
                    "text": "Périmé" if days < 0 else "À consommer aujourd'hui" if days == 0 else f"À consommer avant le {e.strftime('%d/%m')}", "days": days})
    return out


def public(it):
    return it | {"status": status(it), "photo_url": f"/api/inventory/{it['id']}/photo?v={int(it.get('photo_at', 0))}" if it.get("photo") else None}


def brief(user, today):
    """Pour « Ma journée » : ce qui se périme bientôt, les garanties qui se terminent dans le mois."""
    out = []
    for it in load()["items"]:
        for s in status(it, today):
            if s["kind"] == "expires" and s["days"] <= 2:
                out.append({"text": it["name"], "sub": s["text"] + (f" · {it['room']}" if it.get("room") else ""), "late": s["days"] < 0, "link": f"#/inventaire/{it['id']}"})
            elif s["kind"] == "warranty" and 0 <= s["days"] <= 30:
                out.append({"text": it["name"], "sub": f"Fin de garantie dans {s['days']} jour(s)", "link": f"#/inventaire/{it['id']}"})
    return out[:8]


def reminder_loop():
    """Chaque matin : garanties qui se terminent dans 30 jours, produits qui se périment dans 2 jours."""
    last = None
    while True:
        time.sleep(300)
        now = datetime.now()
        if now.hour < 9 or last == now.date():
            continue
        last = now.date()
        try:
            for it in load()["items"]:
                for s in status(it, now.date()):
                    if s["kind"] == "warranty" and s["days"] == 30:
                        activity.log("*", "inventaire", f"La garantie de « {it['name']} » se termine dans 30 jours : vérifie qu'il marche bien.", f"#/inventaire/{it['id']}")
                    if s["kind"] == "expires" and s["days"] == 2:
                        activity.log("*", "inventaire", f"« {it['name']} » se périme dans 2 jours.", f"#/inventaire/{it['id']}")
        except Exception as e:  # noqa: BLE001
            print("inventaire", e, flush=True)


def start():
    os.makedirs(PHOTOS, exist_ok=True)
    import journee
    journee.SOURCES["stock"] = ("inventaire", brief)
    threading.Thread(target=reminder_loop, daemon=True).start()


def count(user):
    return sum(1 for it in load()["items"] for s in status(it) if s["level"] in ("warn", "bad")) or None


# --- Routes --------------------------------------------------------------------------------------------

@bp.get("/api/inventory")
def list_items():
    items = load()["items"]
    rooms = sorted({i["room"] for i in items if i.get("room")} | set(ROOMS), key=lambda r: (r not in {i.get("room") for i in items}, r))
    total = sum((i.get("price") or 0) * (i.get("qty") or 1) for i in items)
    return jsonify(items=[public(i) for i in sorted(items, key=lambda i: i["name"].lower())], rooms=rooms,
                   categories=[{"name": n, "icon": ic} for n, ic in CATEGORIES], total=round(total, 2))


@bp.post("/api/inventory")
def add_item():
    it = _clean(request.get_json(force=True))
    store.update("inventaire", {"items": []}, lambda d: d["items"].append(it))
    return jsonify(public(it))


@bp.put("/api/inventory/<iid>")
def edit_item(iid):
    f = request.get_json(force=True)
    out = {}

    def go(d):
        it = next((i for i in d["items"] if i["id"] == iid), None)
        if not it:
            raise ValueError("Objet introuvable")
        it.update(_clean(f, it))
        out.update(it)
    store.update("inventaire", {"items": []}, go)
    return jsonify(public(out))


@bp.delete("/api/inventory/<iid>")
def delete_item(iid):
    store.update("inventaire", {"items": []}, lambda d: d.__setitem__("items", [i for i in d["items"] if i["id"] != iid]))
    p = os.path.join(PHOTOS, f"{iid}.jpg")
    if os.path.exists(p):
        os.remove(p)
    return jsonify(ok=True)


@bp.post("/api/inventory/<iid>/photo")
def set_photo(iid):
    from PIL import Image, ImageOps
    f = request.files.get("photo")
    if not f:
        raise ValueError("Aucune photo")
    if not any(i["id"] == iid for i in load()["items"]):
        raise ValueError("Objet introuvable")
    im = ImageOps.exif_transpose(Image.open(f.stream)).convert("RGB")
    im.thumbnail((1200, 1200))
    im.save(os.path.join(PHOTOS, f"{iid}.jpg"), "JPEG", quality=85)

    def go(d):
        it = next(i for i in d["items"] if i["id"] == iid)
        it["photo"], it["photo_at"] = True, time.time()
    store.update("inventaire", {"items": []}, go)
    return jsonify(ok=True)


@bp.get("/api/inventory/<iid>/photo")
def photo(iid):
    p = os.path.join(PHOTOS, f"{os.path.basename(iid)}.jpg")
    if not os.path.exists(p):
        return jsonify(error="Pas de photo"), 404
    return send_file(p, mimetype="image/jpeg", max_age=86400)


@bp.get("/api/inventory/papers")
def papers():
    """Tickets et factures de Paperasse (catégorie « Achats & garanties ») pas encore dans l'inventaire."""
    import paperasse
    used = {i.get("paper") for i in load()["items"]}
    docs = [d for d in paperasse.load()["docs"].values() if d.get("category") in ("Achats & garanties", "Factures") and d["id"] not in used
            and d.get("type") in ("Ticket / garantie", "Facture") and d.get("status") == "filed"]
    docs.sort(key=lambda d: d.get("date") or "", reverse=True)
    return jsonify([{"id": d["id"], "title": d.get("title") or d.get("name"), "issuer": d.get("issuer"), "date": d.get("date"), "amount": d.get("amount")} for d in docs[:100]])


@bp.get("/api/inventory/export.csv")
def export_csv():
    """Liste pour l'assurance habitation (en cas de vol, d'incendie ou de dégât des eaux)."""
    items = sorted(load()["items"], key=lambda i: (i.get("room") or "~", i["name"].lower()))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Pièce", "Objet", "Catégorie", "Marque", "Modèle", "N° de série", "Quantité", "Prix d'achat (€)", "Date d'achat", "Garantie jusqu'au", "Facture", "Notes"])
    total = 0
    for i in items:
        price = (i.get("price") or 0) * (i.get("qty") or 1)
        total += price
        w.writerow([i.get("room", ""), i["name"], i.get("category", ""), i.get("brand", ""), i.get("model", ""), i.get("serial", ""), i.get("qty", 1),
                    f"{price:.2f}".replace(".", ",") if i.get("price") is not None else "", i.get("bought", ""), i.get("warranty", ""),
                    "oui (Paperasse)" if i.get("paper") else "", i.get("notes", "").replace("\n", " ")])
    w.writerow([])
    w.writerow(["", "Valeur totale", "", "", "", "", "", f"{total:.2f}".replace(".", ","), "", "", "", f"Inventaire du {date.today().strftime('%d/%m/%Y')}"])
    return Response("﻿" + buf.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f"attachment; filename=inventaire-{date.today().isoformat()}.csv"})
