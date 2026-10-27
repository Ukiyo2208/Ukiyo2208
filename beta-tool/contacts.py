"""Outil « Contacts » : carnets d'adresses (Perso, Pro, Famille partagé, et ceux que tu crées),
synchronisés avec les téléphones par CardDAV.

Les carnets sont des collections du serveur Radicale de l'Agenda (même identifiant et même
mot de passe de synchronisation) : un contact ajouté sur l'iPhone apparaît ici, et inversement.
Les contacts servent aussi aux Mails (adresses proposées, expéditeurs de confiance pour le
filtre anti-faux mails) et à l'Agenda (anniversaires)."""

import io
import os
import re
import shutil
import threading
import time
import uuid
from datetime import date, datetime

from flask import Blueprint, Response, g, jsonify, request

import agenda

bp = Blueprint("contacts", __name__)
SHARED_DIR = os.path.join(agenda.COLL, agenda.SHARED, "contacts")
SHARED_ID = "famille-contacts"
KINDS = {"tel": ["CELL", "HOME", "WORK", "OTHER"], "email": ["HOME", "WORK", "OTHER"], "adr": ["HOME", "WORK", "OTHER"]}
_lock = threading.RLock()
_cache = {}  # utilisateur → (heure, contacts) pour les recherches rapides


def _vobj():
    import vobject
    return vobject


def _book_props(name, description=""):
    return {"tag": "VADDRESSBOOK", "D:displayname": name, "CR:addressbook-description": description}


def ensure(user):
    """Carnets par défaut (Personnel, Professionnel) et lien vers le carnet Famille partagé."""
    p = agenda.ensure_user(user)  # crée d'abord le dossier et l'agenda Personnel
    home = os.path.join(agenda.COLL, p)
    with _lock:
        if not any(agenda._props(os.path.join(home, d)).get("tag") == "VADDRESSBOOK" for d in os.listdir(home) if not d.startswith(".")):
            for cid, name in (("contacts-perso", "Perso"), ("contacts-pro", "Pro")):
                os.makedirs(os.path.join(home, cid), exist_ok=True)
                agenda._write_props(os.path.join(home, cid), _book_props(name))
        os.makedirs(SHARED_DIR, exist_ok=True)
        if not os.path.exists(os.path.join(SHARED_DIR, ".Radicale.props")):
            agenda._write_props(SHARED_DIR, _book_props("Famille", "Contacts partagés par toute la maison"))
        link = os.path.join(home, SHARED_ID)
        if not os.path.lexists(link):
            os.symlink(os.path.relpath(SHARED_DIR, home), link)
    return home


def books(user):
    home = ensure(user)
    out = []
    for d in sorted(os.listdir(home)):
        path = os.path.join(home, d)
        if d.startswith(".") or not os.path.isdir(path):
            continue
        props = agenda._props(path)
        if props.get("tag") == "VADDRESSBOOK":
            out.append({"id": d, "name": props.get("D:displayname") or d, "shared": os.path.islink(path), "path": path,
                        "count": sum(1 for f in os.listdir(path) if f.endswith(".vcf"))})
    out.sort(key=lambda b: (b["shared"], b["name"].lower() != "perso", b["name"].lower()))
    return out


def book_path(user, book_id):
    b = next((b for b in books(user) if b["id"] == book_id), None)
    if not b:
        raise ValueError("Carnet introuvable")
    return b["path"]


# --- Lecture ---------------------------------------------------------------------------------

def _val(card, key):
    v = getattr(card, key, None)
    return v.value if v is not None else ""


def _type(prop, kinds):
    t = [x.upper() for x in prop.params.get("TYPE", [])]
    t = [x for part in t for x in part.split(",")]
    return next((k for k in kinds if k in t), "OTHER" if t else kinds[0])


def to_dict(card, book, fname):
    n = _val(card, "n")
    org = _val(card, "org")
    adrs = []
    for a in card.contents.get("adr", []):
        v = a.value
        adrs.append({"type": _type(a, KINDS["adr"]), "street": " ".join(v.street) if isinstance(v.street, list) else v.street,
                     "city": v.city if isinstance(v.city, str) else " ".join(v.city), "code": v.code if isinstance(v.code, str) else " ".join(v.code),
                     "country": v.country if isinstance(v.country, str) else " ".join(v.country)})
    bday = str(_val(card, "bday") or "")
    photo = None
    p = card.contents.get("photo", [None])[0]
    if p is not None and isinstance(p.value, bytes) and len(p.value) < 400_000:
        import base64
        kind = (p.params.get("TYPE", ["JPEG"])[0] or "JPEG").lower()
        photo = f"data:image/{'jpeg' if kind in ('jpeg', 'jpg') else kind};base64,{base64.b64encode(p.value).decode()}"
    first = (n.given if n else "") or ""
    last = (n.family if n else "") or ""
    fn = str(_val(card, "fn") or "").strip() or f"{first} {last}".strip()
    return {"id": str(_val(card, "uid") or fname[:-4]), "book": book["id"], "book_name": book["name"], "shared": book["shared"], "file": fname,
            "name": fn or (org[0] if org else "") or "(sans nom)", "first": first if isinstance(first, str) else " ".join(first),
            "last": last if isinstance(last, str) else " ".join(last), "org": org[0] if org else "", "title": str(_val(card, "title") or ""),
            "emails": [{"type": _type(e, KINDS["email"]), "value": e.value} for e in card.contents.get("email", []) if e.value],
            "phones": [{"type": _type(t, KINDS["tel"]), "value": t.value} for t in card.contents.get("tel", []) if t.value],
            "addresses": adrs, "birthday": _norm_bday(bday), "notes": str(_val(card, "note") or ""), "url": str(_val(card, "url") or ""),
            "photo": photo}


def _norm_bday(s):
    """« AAAA-MM-JJ », ou « MM-JJ » sans année (vCard « --MMJJ », ou 1604 chez Apple)."""
    m = re.match(r"^(\d{4}|--)-?(\d{2})-?(\d{2})", (s or "").strip())
    if not m:
        return ""
    return f"{m[2]}-{m[3]}" if m[1] in ("--", "1604") else f"{m[1]}-{m[2]}-{m[3]}"


def read_book(book):
    vobject = _vobj()
    out = []
    for fname in os.listdir(book["path"]):
        if not fname.endswith(".vcf"):
            continue
        try:
            with open(os.path.join(book["path"], fname), encoding="utf-8") as f:
                card = vobject.readOne(f.read())
            out.append(to_dict(card, book, fname))
        except Exception:  # noqa: BLE001  fiche illisible : ignorée
            continue
    return out


def all_contacts(user):
    hit = _cache.get(user)
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    out = [c for b in books(user) for c in read_book(b)]
    out.sort(key=lambda c: (c["last"] or c["name"]).lower() + " " + c["first"].lower())
    _cache[user] = (time.time(), out)
    return out


def emails(user):
    """Adresses mail de tous les contacts (expéditeurs de confiance pour le filtre anti-faux mails)."""
    return {e["value"].lower() for c in all_contacts(user) for e in c["emails"]}


def find(user, cid):
    for b in books(user):
        for c in read_book(b):
            if c["id"] == cid:
                return b, c
    raise ValueError("Contact introuvable")


# --- Écriture --------------------------------------------------------------------------------

MANAGED = ("fn", "n", "org", "title", "email", "tel", "adr", "bday", "note", "url", "rev", "prodid")


def write(user, book_id, d, cid=None, fname=None, old_path=None):
    vobject = _vobj()
    path = book_path(user, book_id)
    first, last = str(d.get("first") or "").strip()[:80], str(d.get("last") or "").strip()[:80]
    org = str(d.get("org") or "").strip()[:120]
    if not (first or last or org):
        raise ValueError("Donne au moins un prénom, un nom ou une entreprise")
    card = None
    if old_path and os.path.exists(old_path):  # on garde la photo et les champs inconnus (créés sur le téléphone)
        with open(old_path, encoding="utf-8") as f:
            card = vobject.readOne(f.read())
        for key in MANAGED:
            for prop in list(card.contents.get(key, [])):
                card.remove(prop)
    if card is None:
        card = vobject.vCard()
    cid = cid or str(uuid.uuid4())
    if not getattr(card, "uid", None):
        card.add("uid").value = cid
    card.add("fn").value = f"{first} {last}".strip() or org
    card.add("n").value = vobject.vcard.Name(family=last, given=first)
    if org:
        card.add("org").value = [org]
    if d.get("title"):
        card.add("title").value = str(d["title"])[:120]
    for key, field in (("email", "emails"), ("tel", "phones")):
        for item in d.get(field) or []:
            value = str(item.get("value") or "").strip()[:200]
            if not value:
                continue
            if key == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
                raise ValueError(f"Adresse mail invalide : {value}")
            p = card.add(key)
            p.value = value
            p.type_param = item.get("type") if item.get("type") in KINDS[key] else KINDS[key][0]
    for a in d.get("addresses") or []:
        if not any(str(a.get(k) or "").strip() for k in ("street", "city", "code", "country")):
            continue
        p = card.add("adr")
        p.value = vobject.vcard.Address(street=str(a.get("street") or "")[:200], city=str(a.get("city") or "")[:100],
                                        code=str(a.get("code") or "")[:20], country=str(a.get("country") or "")[:60])
        p.type_param = a.get("type") if a.get("type") in KINDS["adr"] else "HOME"
    bday = str(d.get("birthday") or "").strip()
    if bday:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}|\d{2}-\d{2}", bday):
            raise ValueError("Date d'anniversaire invalide")
        card.add("bday").value = bday if len(bday) == 10 else f"--{bday.replace('-', '')}"
    if d.get("notes"):
        card.add("note").value = str(d["notes"])[:5000]
    if d.get("url"):
        card.add("url").value = str(d["url"])[:300]
    card.add("rev").value = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    card.add("prodid").value = "-//Beta Tool//Contacts//FR"
    data = card.serialize()
    fname = fname or re.sub(r"[^\w.@-]", "_", str(_val(card, "uid")))[:120] + ".vcf"
    with open(os.path.join(path, fname), "w", encoding="utf-8") as f:
        f.write(data)
    if old_path and os.path.abspath(old_path) != os.path.abspath(os.path.join(path, fname)) and os.path.exists(old_path):
        os.remove(old_path)
    _cache.clear()
    return {"id": str(_val(card, "uid")), "book": book_id}


# --- Anniversaires (affichés dans l'Agenda) ---------------------------------------------------

def birthdays(user, start, end):
    out = []
    for c in all_contacts(user):
        b = c["birthday"]
        if not b:
            continue
        m = re.match(r"(?:(\d{4})-)?(\d{2})-(\d{2})$", b)
        if not m:
            continue
        year = int(m[1]) if m[1] else None
        for y in range(start.year, end.year + 1):
            try:
                d = date(y, int(m[2]), int(m[3]))
            except ValueError:
                continue
            if start.date() <= d < end.date():
                age = f" ({y - year} ans)" if year and y > year else ""
                out.append({"uid": f"bday-{c['id']}-{y}", "cal": "_anniversaires", "color": "#ec4899", "allday": True, "readonly": True,
                            "title": f"🎂 {c['name']}{age}", "start": d.isoformat() + "T00:00:00", "end": d.isoformat() + "T23:59:00",
                            "link": f"#/contacts/{c['id']}"})
    return out


# --- Routes ------------------------------------------------------------------------------------

def public_book(b):
    return {k: v for k, v in b.items() if k != "path"}


@bp.get("/api/contacts")
def list_contacts():
    user = g.user["name"]
    q = (request.args.get("q") or "").strip().lower()
    book = request.args.get("book")
    items = [c for c in all_contacts(user) if (not book or c["book"] == book)]
    if q:
        items = [c for c in items if q in " ".join([c["name"], c["org"], c["notes"], *[e["value"] for e in c["emails"]],
                                                     *[f"{a['street']} {a['code']} {a['city']}" for a in c["addresses"]],
                                                     *[p["value"] for p in c["phones"]]]).lower()
                 or re.sub(r"\D", "", q) and re.sub(r"\D", "", q) in "".join(re.sub(r"\D", "", p["value"]) for p in c["phones"])]
    light = [{k: v for k, v in c.items() if k != "photo"} | {"has_photo": bool(c["photo"])} for c in items]
    return jsonify(books=[public_book(b) for b in books(user)], contacts=light)


@bp.get("/api/contacts/suggest")
def suggest():
    """Adresses mail pour compléter les destinataires (Mails)."""
    out = [{"name": c["name"], "email": e["value"], "book": c["book_name"]} for c in all_contacts(g.user["name"]) for e in c["emails"]]
    q = (request.args.get("q") or "").lower()
    return jsonify([x for x in out if not q or q in (x["name"] + " " + x["email"]).lower()][:500])


@bp.get("/api/contacts/<cid>")
def get_contact(cid):
    _, c = find(g.user["name"], cid)
    return jsonify(c)


@bp.post("/api/contacts")
def create_contact():
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    return jsonify(write(user, d.get("book") or books(user)[0]["id"], d))


@bp.put("/api/contacts/<cid>")
def update_contact(cid):
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    b, c = find(user, cid)
    target = d.get("book") or b["id"]
    return jsonify(write(user, target, d, cid=cid, fname=c["file"], old_path=os.path.join(b["path"], c["file"])))


@bp.delete("/api/contacts/<cid>")
def delete_contact(cid):
    b, c = find(g.user["name"], cid)
    os.remove(os.path.join(b["path"], c["file"]))
    _cache.clear()
    return jsonify(ok=True)


@bp.post("/api/contacts/books")
def add_book():
    name = str((request.get_json(silent=True) or {}).get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Donne un nom au carnet")
    home = ensure(g.user["name"])
    bid = "contacts-" + agenda.slug(name)
    while os.path.exists(os.path.join(home, bid)):
        bid += "-2"
    os.makedirs(os.path.join(home, bid))
    agenda._write_props(os.path.join(home, bid), _book_props(name))
    return jsonify(id=bid)


@bp.put("/api/contacts/books/<bid>")
def rename_book(bid):
    name = str((request.get_json(silent=True) or {}).get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Donne un nom au carnet")
    path = book_path(g.user["name"], bid)
    props = agenda._props(path)
    props["D:displayname"] = name
    agenda._write_props(path, props)
    return jsonify(ok=True)


@bp.delete("/api/contacts/books/<bid>")
def delete_book(bid):
    user = g.user["name"]
    path = book_path(user, bid)
    if os.path.islink(path):
        raise ValueError("Le carnet Famille est partagé : il ne peut pas être supprimé")
    if len([b for b in books(user) if not b["shared"]]) <= 1:
        raise ValueError("Garde au moins un carnet personnel")
    shutil.rmtree(path)
    _cache.clear()
    return jsonify(ok=True)


@bp.post("/api/contacts/import")
def import_vcf():
    """Importe un fichier .vcf (export iCloud, Google Contacts, Outlook…) dans un carnet."""
    vobject = _vobj()
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    user = g.user["name"]
    path = book_path(user, request.form.get("book") or books(user)[0]["id"])
    text = f.read().decode("utf-8", "replace")
    n = 0
    try:
        for card in vobject.readComponents(text):
            if card.name != "VCARD":
                continue
            if not getattr(card, "uid", None):
                card.add("uid").value = str(uuid.uuid4())
            if not getattr(card, "fn", None):
                card.add("fn").value = "(sans nom)"
            with open(os.path.join(path, re.sub(r"[^\w.@-]", "_", str(card.uid.value))[:120] + ".vcf"), "w", encoding="utf-8") as out:
                out.write(card.serialize())
            n += 1
    except Exception:  # noqa: BLE001
        if not n:
            raise ValueError("Fichier .vcf illisible") from None
    _cache.clear()
    return jsonify(imported=n)


@bp.get("/api/contacts/export")
def export_vcf():
    user = g.user["name"]
    bid = request.args.get("book")
    buf = io.StringIO()
    for b in books(user):
        if bid and b["id"] != bid:
            continue
        for fname in sorted(os.listdir(b["path"])):
            if fname.endswith(".vcf"):
                with open(os.path.join(b["path"], fname), encoding="utf-8") as f:
                    buf.write(f.read().strip() + "\r\n")
    name = next((b["name"] for b in books(user) if b["id"] == bid), "Contacts") if bid else "Contacts"
    from urllib.parse import quote
    return Response(buf.getvalue(), mimetype="text/vcard", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}.vcf"})


def search(q, user):
    return [{"type": "contact", "title": c["name"], "sub": " · ".join(filter(None, [c["org"], c["book_name"]])), "link": f"#/contacts/{c['id']}"}
            for c in all_contacts(user) if q in (c["name"] + " " + c["org"] + " " + " ".join(e["value"] for e in c["emails"])).lower()][:6]


def count(user):
    return len(all_contacts(user))


@bp.get("/api/contacts/sync")
def sync_info():
    p = agenda.principal_of(g.user["name"])
    return jsonify(login=p, configured=bool(agenda.sync_accounts().get(p)), radicale=agenda.radicale_ok())


@bp.post("/api/contacts/sync-password")
def sync_password():
    ensure(g.user["name"])
    return jsonify(login=agenda.principal_of(g.user["name"]), password=agenda.new_sync_password(g.user["name"]))
