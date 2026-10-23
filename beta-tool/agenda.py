"""Outil « Agenda » : calendriers personnels et agenda « Famille » partagé, synchronisés
avec les téléphones (iPhone, Android via DAVx⁵, Thunderbird…) par CalDAV.

Le serveur CalDAV est Radicale (open source, GPL v3), embarqué sur /dav. Bêta Tool
et Radicale partagent les mêmes fichiers .ics (DATA_DIR/agenda/collection-root) :
un événement créé sur le téléphone apparaît dans la page, et inversement.
Chaque compte a un mot de passe de synchronisation dédié (pas son mot de passe du site).

Les rappels (VALARM) donnent lieu à des notifications push ; les échéances de
Paperasse sont affichées dans un calendrier en lecture seule."""

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
import unicodedata
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, redirect, request

import activity
import auth
import store

bp = Blueprint("agenda", __name__)
ROOT = store.path("agenda")
COLL = os.path.join(ROOT, "collection-root")
SHARED = "_famille"  # dossier réel de l'agenda partagé, relié dans le dossier de chacun
COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"]
_lock = threading.RLock()
LOCAL_TZ = datetime.now().astimezone().tzinfo


def slug(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "maison"


def principal_of(user):
    return slug(user if user not in ("local", "admin") or auth.mode() == "accounts" else "maison")


# --- Comptes de synchronisation (utilisés par Radicale) -----------------------------

def sync_accounts():
    return store.load("agenda/sync", {})


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def check_sync(login, password):
    """Appelé par dav_auth : renvoie le nom du dossier (principal) ou ""."""
    acc = sync_accounts().get(slug(login))
    if acc and acc.get("hash") and hmac.compare_digest(acc["hash"], _hash(password or "")):
        return slug(login)
    return ""


def new_sync_password(user):
    token = "-".join(secrets.token_urlsafe(6)[:4].lower() for _ in range(4))
    p = principal_of(user)
    store.update("agenda/sync", {}, lambda d: d.__setitem__(p, {"user": user, "hash": _hash(token), "created": time.time()}))
    return token


# --- Calendriers (dossiers Radicale) ------------------------------------------------

def _props(path):
    try:
        with open(os.path.join(path, ".Radicale.props"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _write_props(path, props):
    with open(os.path.join(path, ".Radicale.props"), "w", encoding="utf-8") as f:
        json.dump(props, f, ensure_ascii=False)


def make_calendar(path, name, color, description=""):
    os.makedirs(path, exist_ok=True)
    if not os.path.exists(os.path.join(path, ".Radicale.props")):
        _write_props(path, {"tag": "VCALENDAR", "D:displayname": name, "ICAL:calendar-color": color,
                            "C:calendar-description": description, "C:supported-calendar-component-set": "VEVENT,VTODO"})


def ensure_user(user):
    """Dossier du compte avec son agenda « Personnel » et le lien vers l'agenda « Famille »."""
    p = principal_of(user)
    with _lock:
        home = os.path.join(COLL, p)
        os.makedirs(home, exist_ok=True)
        if not os.path.exists(os.path.join(home, ".Radicale.props")):
            _write_props(home, {})
        if not any(os.path.isdir(os.path.join(home, d)) and not os.path.islink(os.path.join(home, d)) for d in os.listdir(home) if not d.startswith(".")):
            make_calendar(os.path.join(home, "personnel"), "Personnel", COLORS[0])
        shared = os.path.join(COLL, SHARED, "agenda")
        make_calendar(shared, "Famille", COLORS[1], "Agenda partagé par toute la maison")
        link = os.path.join(home, "famille")
        if not os.path.lexists(link):
            os.symlink(os.path.relpath(shared, home), link)
    return p


def calendars(user):
    p = ensure_user(user)
    home = os.path.join(COLL, p)
    out = []
    for d in sorted(os.listdir(home)):
        path = os.path.join(home, d)
        if d.startswith(".") or not os.path.isdir(path):
            continue
        props = _props(path)
        if props.get("tag") != "VCALENDAR":
            continue
        out.append({"id": d, "name": props.get("D:displayname") or d, "color": props.get("ICAL:calendar-color") or COLORS[0],
                    "shared": os.path.islink(path), "path": path})
    return out


def cal_path(user, cal_id):
    c = next((c for c in calendars(user) if c["id"] == cal_id), None)
    if not c:
        raise ValueError("Agenda introuvable")
    return c["path"]


# --- Lecture / écriture des événements -------------------------------------------------

def _vobj():
    import vobject
    return vobject


def to_local(v):
    if isinstance(v, datetime):
        return v.astimezone(LOCAL_TZ).replace(tzinfo=None) if v.tzinfo else v
    return v


def read_items(path):
    vobject = _vobj()
    for name in os.listdir(path):
        if not name.endswith(".ics"):
            continue
        fp = os.path.join(path, name)
        try:
            with open(fp, encoding="utf-8") as f:
                cal = vobject.readOne(f.read())
        except Exception:  # noqa: BLE001
            continue
        for ev in getattr(cal, "vevent_list", []):
            yield name, ev


def occurrences(ev, start, end):
    """Occurrences (début, fin) d'un VEVENT dans [start, end[ (datetimes locaux naïfs)."""
    dtstart = ev.dtstart.value
    allday = not isinstance(dtstart, datetime)
    if hasattr(ev, "dtend"):
        dtend = ev.dtend.value
    elif hasattr(ev, "duration"):
        dtend = dtstart + ev.duration.value
    else:
        dtend = dtstart + (timedelta(days=1) if allday else timedelta(hours=1))
    length = (to_local(dtend) if not allday else datetime.combine(dtend, datetime.min.time())) - \
        (to_local(dtstart) if not allday else datetime.combine(dtstart, datetime.min.time()))
    base = to_local(dtstart) if not allday else datetime.combine(dtstart, datetime.min.time())
    if hasattr(ev, "rrule"):
        try:
            rs = ev.getrruleset(addRDate=True)
            starts = []
            for s in rs:
                s = to_local(s) if isinstance(s, datetime) else datetime.combine(s, datetime.min.time())
                if s >= end:
                    break
                if s + length > start:
                    starts.append(s)
                if len(starts) > 500:
                    break
        except Exception:  # noqa: BLE001
            starts = [base]
    else:
        starts = [base] if base < end and base + length > start else []
    return [(s, s + length, allday) for s in starts]


def text(ev, key):
    v = getattr(ev, key, None)
    return str(v.value) if v is not None and v.value is not None else ""


def reminder_of(ev):
    for al in getattr(ev, "valarm_list", []):
        trig = getattr(al, "trigger", None)
        if trig is not None and isinstance(trig.value, timedelta):
            return int(-trig.value.total_seconds() // 60)
    return None


def list_events(user, start, end):
    out = []
    for c in calendars(user):
        for fname, ev in read_items(c["path"]):
            for s, e, allday in occurrences(ev, start, end):
                out.append({"uid": text(ev, "uid"), "file": fname, "cal": c["id"], "color": c["color"], "title": text(ev, "summary") or "(sans titre)",
                            "start": s.isoformat(), "end": e.isoformat(), "allday": allday, "location": text(ev, "location"),
                            "notes": text(ev, "description"), "recur": rrule_kind(ev), "reminder": reminder_of(ev),
                            "shared": c["shared"], "by": text(ev, "x_bt_by")})
    return out


def rrule_kind(ev):
    if not hasattr(ev, "rrule"):
        return ""
    r = ev.rrule.value.upper()
    for k in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        if f"FREQ={k}" in r:
            return k.lower()
    return "custom"


def write_event(user, cal_id, d, uid=None, file=None):
    vobject = _vobj()
    path = cal_path(user, cal_id)
    title = str(d.get("title") or "").strip()[:200]
    if not title:
        raise ValueError("Donne un titre à l'événement")
    allday = bool(d.get("allday"))
    try:
        if allday:
            s = date.fromisoformat(str(d["start"])[:10])
            e = date.fromisoformat(str(d.get("end") or d["start"])[:10]) + timedelta(days=1)
        else:
            s = datetime.fromisoformat(str(d["start"])[:16]).replace(tzinfo=LOCAL_TZ)
            e = datetime.fromisoformat(str(d.get("end") or "")[:16]).replace(tzinfo=LOCAL_TZ) if d.get("end") else s + timedelta(hours=1)
    except (KeyError, ValueError):
        raise ValueError("Date invalide") from None
    if e <= s:
        raise ValueError("La fin doit être après le début")
    from dateutil.tz import tzutc
    utc = tzutc()  # vobject ne reconnaît pas datetime.timezone.utc
    cal = vobject.iCalendar()
    cal.add("prodid").value = "-//Beta Tool//Agenda//FR"
    ev = cal.add("vevent")
    uid = uid or f"{uuid.uuid4()}@beta-tool"
    ev.add("uid").value = uid
    ev.add("dtstamp").value = datetime.now(utc)
    ev.add("summary").value = title
    ev.add("dtstart").value = s if allday else s.astimezone(utc)
    ev.add("dtend").value = e if allday else e.astimezone(utc)
    if d.get("location"):
        ev.add("location").value = str(d["location"])[:300]
    if d.get("notes"):
        ev.add("description").value = str(d["notes"])[:5000]
    if d.get("recur") in ("daily", "weekly", "monthly", "yearly"):
        ev.add("rrule").value = f"FREQ={d['recur'].upper()}"
    if str(d.get("reminder") or "").strip() not in ("", "None"):
        al = ev.add("valarm")
        al.add("action").value = "DISPLAY"
        al.add("description").value = title
        al.add("trigger").value = timedelta(minutes=-int(d["reminder"]))
    ev.add("x-bt-by").value = user
    if file and file.endswith(".ics") and "/" not in file:
        old = file
    else:
        old = None
    fname = old or re.sub(r"[^\w.@-]", "_", uid) + ".ics"
    data = cal.serialize()  # avant d'ouvrir le fichier : une erreur ne laisse pas de fichier vide
    with open(os.path.join(path, fname), "w", encoding="utf-8") as f:
        f.write(data)
    return {"uid": uid, "file": fname}


def find_file(user, uid):
    for c in calendars(user):
        for fname, ev in read_items(c["path"]):
            if text(ev, "uid") == uid:
                return c, fname
    raise ValueError("Événement introuvable")


# --- Routes ----------------------------------------------------------------------

@bp.get("/api/agenda")
def overview():
    cals = [{k: v for k, v in c.items() if k != "path"} for c in calendars(g.user["name"])]
    acc = sync_accounts().get(principal_of(g.user["name"]))
    return jsonify(calendars=cals, colors=COLORS, sync={"login": principal_of(g.user["name"]), "configured": bool(acc),
                                                         "created": acc.get("created") if acc else None},
                   radicale=radicale_ok())


@bp.get("/api/agenda/events")
def events():
    try:
        start = datetime.fromisoformat(request.args["start"][:10])
        end = datetime.fromisoformat(request.args["end"][:10])
    except (KeyError, ValueError):
        raise ValueError("Période invalide") from None
    if (end - start).days > 400:
        raise ValueError("Période trop longue")
    out = list_events(g.user["name"], start, end)
    try:  # échéances de Paperasse (lecture seule)
        import paperasse
        import settings
        if settings.enabled("paperasse"):
            for doc in paperasse.load()["docs"].values():
                if doc.get("due") and start.date().isoformat() <= doc["due"] < end.date().isoformat():
                    out.append({"uid": "paperasse-" + doc["id"], "cal": "_paperasse", "color": "#f59e0b", "allday": True, "readonly": True,
                                "title": f"À payer : {doc.get('issuer') or doc.get('title')}" + (f" ({doc['amount']:.2f} €)".replace(".", ",") if doc.get("amount") else ""),
                                "start": doc["due"] + "T00:00:00", "end": doc["due"] + "T23:59:00", "link": f"#/paperasse/doc/{doc['id']}", "paid": doc.get("paid")})
    except Exception:  # noqa: BLE001
        pass
    out.sort(key=lambda e: (e["start"], not e["allday"]))
    return jsonify(out)


@bp.post("/api/agenda/events")
def create():
    d = request.get_json(silent=True) or {}
    r = write_event(g.user["name"], d.get("cal") or "personnel", d)
    return jsonify(r)


@bp.put("/api/agenda/events/<path:uid>")
def update(uid):
    d = request.get_json(silent=True) or {}
    c, fname = find_file(g.user["name"], uid)
    if d.get("cal") and d["cal"] != c["id"]:  # changement d'agenda : on déplace le fichier
        os.remove(os.path.join(c["path"], fname))
        return jsonify(write_event(g.user["name"], d["cal"], d, uid=uid))
    return jsonify(write_event(g.user["name"], c["id"], d, uid=uid, file=fname))


@bp.delete("/api/agenda/events/<path:uid>")
def delete(uid):
    c, fname = find_file(g.user["name"], uid)
    os.remove(os.path.join(c["path"], fname))
    return jsonify(ok=True)


@bp.post("/api/agenda/calendars")
def add_calendar():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Donne un nom à l'agenda")
    home = os.path.join(COLL, ensure_user(g.user["name"]))
    cid = slug(name)
    while os.path.exists(os.path.join(home, cid)):
        cid += "-2"
    make_calendar(os.path.join(home, cid), name, d.get("color") if d.get("color") in COLORS else COLORS[len(os.listdir(home)) % len(COLORS)])
    return jsonify(id=cid)


@bp.put("/api/agenda/calendars/<cid>")
def edit_calendar(cid):
    d = request.get_json(silent=True) or {}
    path = cal_path(g.user["name"], cid)
    props = _props(path)
    if d.get("name"):
        props["D:displayname"] = str(d["name"]).strip()[:60]
    if d.get("color"):
        props["ICAL:calendar-color"] = d["color"] if re.fullmatch(r"#[0-9a-fA-F]{6}", d["color"]) else props.get("ICAL:calendar-color")
    _write_props(path, props)
    return jsonify(ok=True)


@bp.delete("/api/agenda/calendars/<cid>")
def delete_calendar(cid):
    path = cal_path(g.user["name"], cid)
    if os.path.islink(path) or cid == "famille":
        raise ValueError("L'agenda Famille est partagé : il ne peut pas être supprimé")
    if len([c for c in calendars(g.user["name"]) if not c["shared"]]) <= 1:
        raise ValueError("Garde au moins un agenda personnel")
    shutil.rmtree(path)
    return jsonify(ok=True)


@bp.post("/api/agenda/sync-password")
def sync_password():
    ensure_user(g.user["name"])
    return jsonify(login=principal_of(g.user["name"]), password=new_sync_password(g.user["name"]))


@bp.post("/api/agenda/import")
def import_ics():
    """Importe un fichier .ics (export Google Agenda, Outlook…) dans un agenda."""
    vobject = _vobj()
    f = request.files.get("file")
    cal_id = request.form.get("cal") or "personnel"
    if not f:
        raise ValueError("Aucun fichier")
    path = cal_path(g.user["name"], cal_id)
    try:
        cal = vobject.readOne(f.read().decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        raise ValueError("Fichier .ics illisible") from None
    n = 0
    for ev in getattr(cal, "vevent_list", []):
        one = vobject.iCalendar()
        one.add(ev)
        uid = text(ev, "uid") or f"{uuid.uuid4()}@beta-tool"
        if not hasattr(ev, "uid"):
            ev.add("uid").value = uid
        with open(os.path.join(path, re.sub(r"[^\w.@-]", "_", uid)[:120] + ".ics"), "w", encoding="utf-8") as out:
            out.write(one.serialize())
        n += 1
    return jsonify(imported=n)


# --- Rappels -----------------------------------------------------------------------

def check_reminders(sent):
    """Envoie les rappels dus (VALARM) ; `sent` mémorise ceux déjà envoyés."""
    now = datetime.now()
    users = [u["name"] for u in auth.users()] if auth.mode() == "accounts" else ["local"]
    for user in users:
        for c in calendars(user):
            for _, ev in read_items(c["path"]):
                mins = reminder_of(ev)
                if mins is None:
                    continue
                for s, _, allday in occurrences(ev, now - timedelta(minutes=5), now + timedelta(minutes=mins + 2, days=1)):
                    at = (s - timedelta(minutes=mins)) if not allday else s.replace(hour=8) - timedelta(minutes=mins)
                    key = f"{text(ev, 'uid')}|{s.isoformat()}|{'' if c['shared'] else user}"
                    if not (at <= now < at + timedelta(minutes=10)) or key in sent:
                        continue
                    sent[key] = time.time()
                    when = "aujourd'hui" if allday else s.strftime("à %Hh%M").replace("h00", "h")
                    where = f" · {text(ev, 'location')}" if text(ev, "location") else ""
                    activity.log("*" if c["shared"] else user, "agenda", f"{text(ev, 'summary')} · {when}{where}", "#/agenda",
                                 title=f"Rappel · {c['name']}")
    cutoff = time.time() - 3 * 86400
    return {k: v for k, v in sent.items() if v > cutoff}


def reminders():
    sent = store.load("agenda/rappels", {})
    while True:
        time.sleep(30)
        try:
            before = len(sent)
            sent = check_reminders(sent)
            if len(sent) != before:
                store.save("agenda/rappels", sent)
        except Exception as e:  # noqa: BLE001
            print("agenda rappels", e, flush=True)


# --- Radicale (CalDAV) -----------------------------------------------------------------

_radicale = None


def radicale_ok():
    return _radicale is not None


def radicale_app():
    """Application WSGI Radicale configurée pour Bêta Tool (ou None si Radicale n'est pas installé)."""
    global _radicale
    try:
        import radicale
        import radicale.config
    except ImportError:
        print("Agenda : Radicale n'est pas installé, la synchronisation des téléphones est désactivée")
        return None
    os.makedirs(COLL, exist_ok=True)
    cfg = radicale.config.load([])
    cfg.update({
        "auth": {"type": "dav_auth", "delay": "1"},
        "rights": {"type": "dav_rights"},
        "storage": {"filesystem_folder": ROOT},
        "web": {"type": "none"},
        "logging": {"level": "warning", "mask_passwords": "True"},
    }, "beta-tool", privileged=True)
    _radicale = radicale.Application(cfg)
    return _radicale


def start():
    os.makedirs(COLL, exist_ok=True)
    threading.Thread(target=reminders, daemon=True).start()


@bp.get("/.well-known/caldav")
@bp.get("/.well-known/carddav")
def well_known():
    return redirect("/dav/", 301)


def search(q, user):
    now = datetime.now()
    try:
        evs = list_events(user, now - timedelta(days=30), now + timedelta(days=365))
    except Exception:  # noqa: BLE001
        return []
    return [{"type": "event", "title": e["title"], "sub": f"Agenda · {e['start'][:10]}", "link": f"#/agenda?date={e['start'][:10]}"}
            for e in evs if q in e["title"].lower()][:6]

