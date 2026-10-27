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
    """Importe un fichier .vcf ou .csv (export iCloud, Google Contacts, Outlook, sauvegarde du téléphone…) en fusionnant les doublons."""
    f = request.files.get("file")
    if not f:
        raise ValueError("Aucun fichier")
    user = g.user["name"]
    cards, rows = parse_file(f.filename or "contacts.vcf", f.read())
    r = import_cards(user, request.form.get("book") or books(user)[0]["id"], cards, rows)
    return jsonify(r | {"imported": r["added"] + r["merged"]})


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


# --- Récupérer des contacts : fichiers du NAS (sauvegardes de téléphone…), CSV, autre serveur CardDAV ---------

def _digits(phone):
    d = re.sub(r"\D", "", phone or "")
    return d[-9:] if len(d) >= 9 else d  # 06 12… et +33 6 12… se ressemblent


def _key_index(items):
    idx = {}
    for c in items:
        for e in c["emails"]:
            idx.setdefault("m:" + e["value"].lower(), c)
        for p in c["phones"]:
            if _digits(p["value"]):
                idx.setdefault("t:" + _digits(p["value"]), c)
        if c["first"] or c["last"]:
            idx.setdefault("n:" + f"{c['first']} {c['last']}".strip().lower(), c)
    return idx


def _keys(c):
    return (["m:" + e["value"].lower() for e in c["emails"]] + ["t:" + _digits(p["value"]) for p in c["phones"] if _digits(p["value"])]
            + (["n:" + f"{c['first']} {c['last']}".strip().lower()] if c["first"] or c["last"] else []))


def _merge_into(user, book, existing, new):
    """Ajoute à un contact existant ce que l'autre fiche apporte (mails, téléphones, adresses, champs vides)."""
    d = {k: existing[k] for k in ("first", "last", "org", "title", "birthday", "notes", "url")}
    changed = False
    for k in ("org", "title", "birthday", "notes", "url"):
        if not d[k] and new.get(k):
            d[k], changed = new[k], True
    d["emails"], d["phones"], d["addresses"] = list(existing["emails"]), list(existing["phones"]), list(existing["addresses"])
    for e in new["emails"]:
        if e["value"].lower() not in {x["value"].lower() for x in d["emails"]}:
            d["emails"].append(e); changed = True
    for p in new["phones"]:
        if _digits(p["value"]) and _digits(p["value"]) not in {_digits(x["value"]) for x in d["phones"]}:
            d["phones"].append(p); changed = True
    for a in new["addresses"]:
        if (a.get("street") or a.get("city")) and (a.get("street"), a.get("city")) not in {(x["street"], x["city"]) for x in d["addresses"]}:
            d["addresses"].append(a); changed = True
    if changed:
        bd = d["birthday"]
        d["birthday"] = bd if re.fullmatch(r"\d{4}-\d{2}-\d{2}|\d{2}-\d{2}", bd or "") else ""
        write(user, book["id"], d, cid=existing["id"], fname=existing["file"], old_path=os.path.join(book["path"], existing["file"]))
    return changed


def import_cards(user, book_id, cards=(), rows=()):
    """Importe des fiches vCard (objets vobject) et/ou des fiches simples (dict) dans un carnet, en fusionnant les doublons.
    Renvoie {added, merged, same}."""
    vobject = _vobj()
    all_books = {b["id"]: b for b in books(user)}
    book = all_books[book_id]
    idx = _key_index([c for b in all_books.values() for c in read_book(b)])  # un contact déjà dans un autre carnet y est complété
    added = merged = same = 0
    pending = [(c, None) for c in cards] + [(None, r) for r in rows]
    for card, row in pending:
        if card is not None:
            if not getattr(card, "fn", None):
                card.add("fn").value = "(sans nom)"
            try:
                info = to_dict(card, book, "x.vcf")
            except Exception:  # noqa: BLE001
                continue
        else:
            info = {"first": row.get("first", ""), "last": row.get("last", ""), "org": row.get("org", ""), "title": row.get("title", ""),
                    "emails": row.get("emails", []), "phones": row.get("phones", []), "addresses": row.get("addresses", []),
                    "birthday": row.get("birthday", ""), "notes": row.get("notes", ""), "url": "", "name": ""}
            if not (info["first"] or info["last"] or info["org"]):
                continue
        hit = next((idx[k] for k in _keys(info) if k in idx), None)
        if hit:
            if _merge_into(user, all_books.get(hit.get("book"), book), hit, info):
                merged += 1
            else:
                same += 1
            continue
        if card is not None:  # fiche gardée telle quelle (photo, champs du téléphone)
            if not getattr(card, "uid", None):
                card.add("uid").value = str(uuid.uuid4())
            fname = re.sub(r"[^\w.@-]", "_", str(card.uid.value))[:120] + ".vcf"
            with open(os.path.join(book["path"], fname), "w", encoding="utf-8") as out:
                out.write(card.serialize())
            info["id"], info["file"] = str(card.uid.value), fname
        else:
            r = write(user, book_id, info)
            info["id"], info["file"] = r["id"], re.sub(r"[^\w.@-]", "_", r["id"])[:120] + ".vcf"
        for k in _keys(info):
            idx.setdefault(k, info)
        added += 1
    _cache.clear()
    return {"added": added, "merged": merged, "same": same}


CSV_MAP = {  # Google Contacts, Outlook, téléphones Android, tableurs en français
    "first": ["first name", "given name", "prénom", "prenom", "firstname"],
    "last": ["last name", "family name", "nom", "lastname", "surname", "nom de famille"],
    "org": ["organization 1 - name", "company", "organisation", "entreprise", "société", "organization name"],
    "title": ["organization 1 - title", "job title", "fonction", "title"],
    "birthday": ["birthday", "anniversaire", "date de naissance"],
    "notes": ["notes", "note"],
}


def parse_csv(text):
    import csv
    sample = text[:5000]
    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample.strip() else csv.excel
    out = []
    for row in csv.DictReader(io.StringIO(text), dialect=dialect):
        low = {str(k or "").strip().lower(): str(v or "").strip() for k, v in row.items()}
        rec = {k: next((low[c] for c in cols if low.get(c)), "") for k, cols in CSV_MAP.items()}
        if not (rec["first"] or rec["last"]) and low.get("name"):
            parts = low["name"].split()
            rec["first"], rec["last"] = " ".join(parts[:-1]) or parts[0], parts[-1] if len(parts) > 1 else ""
        rec["emails"] = [{"type": "WORK" if "work" in k or "travail" in k or "business" in k else "HOME", "value": v.split(" ::: ")[0]}
                         for k, v in low.items() if v and "@" in v and ("mail" in k or "courriel" in k) and "type" not in k]
        rec["phones"] = [{"type": "CELL" if any(w in k for w in ("mobile", "cell", "portable")) else "WORK" if any(w in k for w in ("work", "business", "travail", "bureau")) else "HOME",
                          "value": v.split(" ::: ")[0]} for k, v in low.items()
                         if v and re.search(r"phone|tél|tel|mobile|portable", k) and "type" not in k and len(re.sub(r"\D", "", v)) >= 6]
        bd = rec["birthday"]
        m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", bd)
        rec["birthday"] = f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}" if m else bd[:10] if re.match(r"\d{4}-\d{2}-\d{2}", bd) else ""
        out.append(rec)
    return out


def parse_file(name, data):
    """(fiches vCard, lignes CSV) d'un fichier .vcf ou .csv."""
    text = data.decode("utf-8-sig", "replace") if isinstance(data, bytes) else data
    if name.lower().endswith(".csv"):
        return [], parse_csv(text)
    vobject = _vobj()
    cards = []
    try:
        for card in vobject.readComponents(text, ignoreUnreadable=True):
            if card.name == "VCARD":
                cards.append(card)
    except Exception:  # noqa: BLE001
        if not cards:
            raise ValueError("Fichier de contacts illisible") from None
    return cards, []


@bp.get("/api/contacts/scan")
def scan_nas():
    """Fichiers de contacts présents sur le NAS (sauvegardes de téléphone, exports…)."""
    import roots
    found, seen_dirs, t0 = [], 0, time.time()
    for r in roots.all_roots():
        base = os.path.realpath(r["path"])
        for dirpath, dirnames, filenames in os.walk(base):
            seen_dirs += 1
            dirnames[:] = [d for d in dirnames if not d.startswith((".", "@", "#")) and dirpath.count(os.sep) - base.count(os.sep) < 8]
            if seen_dirs > 30000 or time.time() - t0 > 20:
                dirnames[:] = []
                break
            for fn in filenames:
                low = fn.lower()
                if low.endswith((".vcf", ".vcard")) or (low.endswith(".csv") and re.search(r"contact|carnet|adress|annuaire", low)):
                    p = os.path.join(dirpath, fn)
                    try:
                        st = os.stat(p)
                        if st.st_size > 50 * 1024 ** 2:
                            continue
                        with open(p, "rb") as f:
                            head = f.read(min(st.st_size, 5 * 1024 ** 2))
                        n = head.count(b"BEGIN:VCARD") if not low.endswith(".csv") else max(0, head.count(b"\n") - 1)
                    except OSError:
                        continue
                    if n:
                        found.append({"root": r["id"], "root_label": r["label"], "path": roots.relative(r["id"], p), "name": fn,
                                      "size": st.st_size, "mtime": st.st_mtime, "count": n})
    found.sort(key=lambda f: -f["mtime"])
    return jsonify(files=found[:200], roots=[r["label"] for r in roots.all_roots()])


@bp.post("/api/contacts/import-path")
def import_path():
    import roots
    d = request.get_json(silent=True) or {}
    path = roots.resolve(d.get("root"), d.get("path"))
    if not os.path.isfile(path) or not path.lower().endswith((".vcf", ".vcard", ".csv")):
        raise ValueError("Ce n'est pas un fichier de contacts (.vcf ou .csv)")
    with open(path, "rb") as f:
        cards, rows = parse_file(path, f.read())
    user = g.user["name"]
    return jsonify(import_cards(user, d.get("book") or books(user)[0]["id"], cards, rows))


@bp.post("/api/contacts/carddav-import")
def carddav_import():
    """Copie les contacts d'un autre serveur CardDAV (Nextcloud, Radicale dans Docker, Synology Contacts…)."""
    import requests
    import xml.etree.ElementTree as ET
    from urllib.parse import urljoin
    d = request.get_json(silent=True) or {}
    url, auth_ = str(d.get("url") or "").strip(), (str(d.get("username") or ""), str(d.get("password") or ""))
    if not re.match(r"https?://", url):
        raise ValueError("Adresse du serveur invalide (https://…)")
    ns = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:carddav"}

    def call(method, target, body, depth):
        try:
            r = requests.request(method, target, data=body.encode(), auth=auth_, timeout=30,
                                 headers={"Depth": str(depth), "Content-Type": "application/xml; charset=utf-8"})
        except requests.RequestException as e:
            raise ValueError(f"Serveur injoignable ({e.__class__.__name__})") from None
        if r.status_code == 401:
            raise ValueError("Identifiant ou mot de passe refusé")
        if r.status_code != 207:
            raise ValueError(f"Le serveur ne répond pas en CardDAV ({r.status_code}) : vérifie l'adresse")
        return ET.fromstring(r.content)

    prop = lambda p: f'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop>{p}</d:prop></d:propfind>'
    root = call("PROPFIND", url, prop("<d:current-user-principal/><d:resourcetype/>"), 0)
    href = root.findtext(".//d:current-user-principal/d:href", None, ns)
    books_found = []
    if root.find(".//d:resourcetype/c:addressbook", ns) is not None:
        books_found = [url]
    else:
        principal = urljoin(url, href) if href else url
        home_root = call("PROPFIND", principal, prop("<c:addressbook-home-set/>"), 0)
        home = urljoin(principal, home_root.findtext(".//c:addressbook-home-set/d:href", "", ns) or principal)
        listing = call("PROPFIND", home, prop("<d:resourcetype/><d:displayname/>"), 1)
        for resp in listing.findall("d:response", ns):
            if resp.find(".//d:resourcetype/c:addressbook", ns) is not None:
                books_found.append(urljoin(home, resp.findtext("d:href", "", ns)))
    if not books_found:
        raise ValueError("Aucun carnet d'adresses trouvé sur ce serveur")
    vobject = _vobj()
    cards = []
    query = ('<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">'
             '<d:prop><c:address-data/></d:prop></c:addressbook-query>')
    for b in books_found:
        for resp in call("REPORT", b, query, 1).findall("d:response", ns):
            data = resp.findtext(".//c:address-data", "", ns)
            if data:
                try:
                    cards.append(vobject.readOne(data))
                except Exception:  # noqa: BLE001
                    pass
    user = g.user["name"]
    return jsonify(import_cards(user, d.get("book") or books(user)[0]["id"], cards) | {"books": len(books_found)})


def duplicates(user, book_id=None):
    groups, seen = [], set()
    for b in books(user):
        if book_id and b["id"] != book_id:
            continue
        items = read_book(b)
        parent = {c["id"]: c["id"] for c in items}

        def find_(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        owner = {}
        for c in items:
            for k in _keys(c):
                if k in owner:
                    parent[find_(c["id"])] = find_(owner[k])
                else:
                    owner[k] = c["id"]
        by = {}
        for c in items:
            by.setdefault(find_(c["id"]), []).append(c)
        for grp in by.values():
            if len(grp) > 1 and grp[0]["id"] not in seen:
                seen.update(c["id"] for c in grp)
                groups.append({"book": b["id"], "book_name": b["name"], "contacts": grp})
    return groups


@bp.get("/api/contacts/duplicates")
def list_duplicates():
    groups = duplicates(g.user["name"], request.args.get("book") or None)
    return jsonify([{"book_name": gr["book_name"], "names": [c["name"] for c in gr["contacts"]],
                     "detail": " · ".join(sorted({e["value"] for c in gr["contacts"] for e in c["emails"]} | {p["value"] for c in gr["contacts"] for p in c["phones"]}))[:200]}
                    for gr in groups])


@bp.post("/api/contacts/dedupe")
def dedupe():
    """Fusionne les doublons (même mail, même téléphone ou même nom) : une seule fiche avec toutes les infos."""
    user = g.user["name"]
    n = 0
    for gr in duplicates(user, (request.get_json(silent=True) or {}).get("book") or None):
        book = next(b for b in books(user) if b["id"] == gr["book"])
        keep, *others = sorted(gr["contacts"], key=lambda c: -(len(c["emails"]) + len(c["phones"]) + len(c["addresses"]) + bool(c["photo"])))
        for o in others:
            _merge_into(user, book, keep, o)
            keep = next((c for c in read_book(book) if c["id"] == keep["id"]), keep)
            os.remove(os.path.join(book["path"], o["file"]))
            n += 1
    _cache.clear()
    return jsonify(merged=n)
