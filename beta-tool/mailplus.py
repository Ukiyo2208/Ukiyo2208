"""Compléments de l'outil Mails :
  - invitations (fichier .ics envoyé par Outlook, Gmail, iCloud…) : accepter / peut-être / refuser,
    l'événement s'ajoute à l'agenda et la réponse part à l'organisateur ;
  - « Ajouter à l'agenda » : un événement créé depuis un mail, avec la date repérée dans le texte ;
  - envoi programmé (« envoyer demain à 8h ») ;
  - relance : rappel si personne n'a répondu au bout de quelques jours ;
  - réponse automatique d'absence (vacances)."""

import email
import email.policy
import email.utils
import os
import re
import shutil
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from email.message import EmailMessage

from flask import Blueprint, g, jsonify, request

import accounts
import activity
import mail
import store

bp = Blueprint("mailplus", __name__)
QUEUE_DIR = store.path("mail", "programmes")
PARTSTAT = {"ACCEPTED": "Accepté", "TENTATIVE": "Peut-être", "DECLINED": "Refusé"}


# --- Invitations (iMIP) -------------------------------------------------------------------------------

def _calendar_part(msg):
    for part in msg.walk():
        if part.get_content_type() in ("text/calendar", "application/ics") or (part.get_filename() or "").lower().endswith(".ics"):
            data = part.get_payload(decode=True) or b""
            if b"BEGIN:VCALENDAR" in data:
                return data.decode("utf-8", "replace"), (part.get_param("method") or "")
    return None, None


def _parse(raw):
    import vobject
    cal = vobject.readOne(raw)
    method = str(getattr(cal, "method", None).value if getattr(cal, "method", None) else "").upper()
    ev = next(iter(getattr(cal, "vevent_list", [])), None)
    return cal, ev, method


def _addr(prop):
    v = str(prop.value if prop is not None else "")
    return v.split(":", 1)[1].lower() if v.lower().startswith("mailto:") else v.lower()


def invite_info(acc, msg):
    raw, param = _calendar_part(msg)
    if not raw:
        return None
    cal, ev, method = _parse(raw)
    method = method or str(param).upper() or "REQUEST"
    if ev is None or method not in ("REQUEST", "CANCEL", "PUBLISH", "REPLY"):
        return None
    import agenda
    s = ev.dtstart.value
    allday = not isinstance(s, datetime)
    end = ev.dtend.value if hasattr(ev, "dtend") else (s + ev.duration.value if hasattr(ev, "duration") else s + (timedelta(days=1) if allday else timedelta(hours=1)))
    me = (acc.get("email") or acc["mail"].get("username") or "").lower()
    my_status = None
    for a in getattr(ev, "attendee_list", []):
        if _addr(a) == me:
            my_status = (a.params.get("PARTSTAT") or [None])[0]
    uid = agenda.text(ev, "uid")
    in_agenda = None
    try:
        for c in agenda.calendars(acc["owner"]):
            for _, e2 in agenda.read_items(c["path"]):
                if agenda.text(e2, "uid") == uid:
                    in_agenda = c["name"]
                    for a in getattr(e2, "attendee_list", []):
                        if _addr(a) == me:
                            my_status = (a.params.get("PARTSTAT") or [my_status])[0]
    except Exception:  # noqa: BLE001
        pass
    answered = store.load("mail/invitations", {}).get(uid)
    if answered:  # réponse donnée depuis Bêta Tool (aussi pour les agendas raccordés)
        my_status = answered["status"]
        in_agenda = in_agenda or answered.get("cal_name")
    organizer = getattr(ev, "organizer", None)
    who = (organizer.params.get("CN") or [""])[0] if organizer is not None else ""
    out = {"method": method, "uid": uid, "title": agenda.text(ev, "summary") or "(sans titre)", "location": agenda.text(ev, "location"),
           "allday": allday, "start": (agenda.to_local(s) if not allday else s).isoformat(), "end": (agenda.to_local(end) if not allday else end).isoformat(),
           "organizer": who or (_addr(organizer) if organizer is not None else ""), "organizer_email": _addr(organizer) if organizer is not None else "",
           "attendees": len(getattr(ev, "attendee_list", [])), "my_status": my_status, "in_agenda": in_agenda,
           "recur_text": agenda.describe_rrule(ev.rrule.value, agenda.to_local(s) if not allday else s) if hasattr(ev, "rrule") else ""}
    if method == "REPLY":  # quelqu'un répond à une de tes invitations
        a = next(iter(getattr(ev, "attendee_list", [])), None)
        out["reply_from"] = ((a.params.get("CN") or [""])[0] or _addr(a)) if a is not None else ""
        out["reply_status"] = (a.params.get("PARTSTAT") or [""])[0] if a is not None else ""
    return out


def _reply(acc, cal, ev, status, me):
    """Envoie la réponse (iTIP REPLY) à l'organisateur."""
    import vobject
    organizer = getattr(ev, "organizer", None)
    if organizer is None:
        return False
    out = vobject.iCalendar()
    out.add("method").value = "REPLY"
    out.add("prodid").value = "-//Beta Tool//Mails//FR"
    rep = out.add("vevent")
    for key in ("uid", "dtstart", "dtend", "summary", "sequence", "recurrence_id"):
        prop = getattr(ev, key, None)
        if prop is not None:
            p = rep.add(prop.name.lower())
            p.value, p.params = prop.value, dict(prop.params)
    from dateutil.tz import tzutc
    rep.add("dtstamp").value = datetime.now(tzutc())
    o = rep.add("organizer")
    o.value, o.params = organizer.value, dict(organizer.params)
    a = rep.add("attendee")
    a.value = "mailto:" + me
    a.params = {"PARTSTAT": [status]}
    name = acc["mail"].get("name")
    if name:
        a.params["CN"] = [name]
    m = EmailMessage()
    m["From"] = email.utils.formataddr((name or "", me))
    m["To"] = _addr(organizer)
    m["Subject"] = f"{PARTSTAT[status]} : {str(ev.summary.value) if hasattr(ev, 'summary') else 'invitation'}"
    m["Date"] = email.utils.formatdate(localtime=True)
    m["Message-ID"] = email.utils.make_msgid(domain=me.split("@")[-1] or "beta-tool.local")
    m.set_content(f"{name or me} a répondu « {PARTSTAT[status].lower()} » à l'invitation.")
    m.add_alternative(out.serialize(), subtype="calendar", params={"method": "REPLY"})
    mail.smtp_send(acc, m)
    return True


@bp.post("/api/mail/<acc_id>/invite")
def answer_invite(acc_id):
    import agenda
    acc = mail.account(acc_id)
    d = request.get_json(silent=True) or {}
    folder, uid, answer = d.get("folder") or "INBOX", str(int(d["uid"])), d.get("answer")
    with mail.session(acc) as c:
        mail.select(c, folder)
        msg = email.message_from_bytes(mail.raw_message(acc, c, folder, uid), policy=email.policy.default)
    raw, _ = _calendar_part(msg)
    if not raw:
        raise ValueError("Ce mail ne contient pas d'invitation")
    cal, ev, method = _parse(raw)
    user = g.user["name"]
    me = (acc.get("email") or acc["mail"].get("username") or "").lower()
    ev_uid = agenda.text(ev, "uid") or f"{uuid.uuid4()}@beta-tool"

    def remove_existing():
        for c2 in agenda.calendars(user):
            for fname, e2 in agenda.read_items(c2["path"]):
                if agenda.text(e2, "uid") == ev_uid:
                    os.remove(os.path.join(c2["path"], fname))
                    return True
        return False

    if answer == "remove" or method == "CANCEL":
        store.update("mail/invitations", {}, lambda x: x.pop(ev_uid, None))
        return jsonify(ok=True, removed=remove_existing())
    if answer not in PARTSTAT:
        raise ValueError("Réponse inconnue")
    sent = False
    if answer in ("ACCEPTED", "TENTATIVE"):
        cal_id = d.get("cal") or "personnel"
        remove_existing()
        if cal_id.startswith("x-"):  # agenda raccordé : on recrée l'événement avec ses informations principales
            import extcal
            s = ev.dtstart.value
            allday = not isinstance(s, datetime)
            e = ev.dtend.value if hasattr(ev, "dtend") else s + (timedelta(days=1) if allday else timedelta(hours=1))
            fmt = (lambda v: v.isoformat()) if allday else (lambda v: agenda.to_local(v).strftime("%Y-%m-%dT%H:%M"))
            extcal.create(user, cal_id, {"title": agenda.text(ev, "summary"), "allday": allday, "start": fmt(s),
                                         "end": fmt(e - timedelta(days=1) if allday else e), "location": agenda.text(ev, "location"),
                                         "notes": agenda.text(ev, "description"), "reminder": "30" if not allday else ""})
        else:  # agenda Bêta Tool : l'invitation est gardée telle quelle (invités, fuseau, répétitions)
            for a in getattr(ev, "attendee_list", []):
                if _addr(a) == me:
                    a.params["PARTSTAT"] = [answer]
            if hasattr(cal, "method"):
                cal.remove(cal.method)
            if not getattr(ev, "valarm_list", None) and isinstance(ev.dtstart.value, datetime):
                al = ev.add("valarm")
                al.add("action").value = "DISPLAY"
                al.add("description").value = agenda.text(ev, "summary")
                al.add("trigger").value = timedelta(minutes=-30)
            path = agenda.cal_path(user, cal_id)
            with open(os.path.join(path, re.sub(r"[^\w.@-]", "_", ev_uid)[:120] + ".ics"), "w", encoding="utf-8") as f:
                f.write(cal.serialize())
    else:
        remove_existing()
    cal_name = ""
    if answer != "DECLINED":
        import extcal
        cal_name = next((c["name"] for c in agenda.calendars(user) + extcal.calendars(user) if c["id"] == (d.get("cal") or "personnel")), "")
    store.update("mail/invitations", {}, lambda x: x.__setitem__(ev_uid, {"status": answer, "cal_name": cal_name, "at": time.time()}))
    if d.get("notify_organizer", True):
        try:
            sent = _reply(acc, cal, ev, answer, me)
        except ValueError as e:
            return jsonify(ok=True, sent=False, warning=f"Ajouté à l'agenda, mais la réponse n'est pas partie : {e}")
    return jsonify(ok=True, sent=sent)


# --- Ajouter un mail à l'agenda -----------------------------------------------------------------------

@bp.get("/api/mail/<acc_id>/event-suggest")
def event_suggest(acc_id):
    import datefr
    acc = mail.account(acc_id)
    folder, uid = request.args.get("folder") or "INBOX", str(int(request.args["uid"]))
    with mail.session(acc) as c:
        mail.select(c, folder)
        msg = email.message_from_bytes(mail.raw_message(acc, c, folder, uid), policy=email.policy.default)
    _, text, _ = mail.body_of(msg)
    if not text:
        html_part = msg.get_body(preferencelist=("html",))
        text = re.sub(r"<[^>]+>", " ", html_part.get_content()) if html_part is not None else ""
    subject = re.sub(r"^((re|tr|fwd?)\s*:\s*)+", "", mail.dec(msg["Subject"]), flags=re.I)
    try:
        ref = email.utils.parsedate_to_datetime(msg["Date"]).astimezone().replace(tzinfo=None)
    except (TypeError, ValueError):
        ref = datetime.now()
    found = datefr.find(subject + "\n" + "\n".join(l for l in text.splitlines() if not l.startswith(">")), ref)
    minutes = datefr.duration_hint(text) or 60
    out = []
    for f in found:
        s = f["start"]
        if f["allday"]:
            out.append({"allday": True, "start": s.isoformat(), "end": s.isoformat(), "text": f["text"]})
        else:
            out.append({"allday": False, "start": s.strftime("%Y-%m-%dT%H:%M"), "end": (s + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M"), "text": f["text"]})
    who = mail.dec(msg["From"])
    excerpt = re.sub(r"\n{3,}", "\n\n", "\n".join(l for l in text.splitlines() if not l.startswith(">")).strip())[:600]
    return jsonify(title=subject or "Événement", notes=f"D'après le mail de {who} :\n{excerpt}", candidates=out)


# --- Envoi programmé ---------------------------------------------------------------------------------------

class _Stored:
    """Pièce jointe gardée sur le disque, relue au moment de l'envoi (même interface que les fichiers envoyés)."""

    def __init__(self, path, filename, mimetype):
        self.path, self.filename, self.mimetype = path, filename, mimetype

    def read(self):
        with open(self.path, "rb") as f:
            return f.read()


def queue():
    return store.load("mail/programmes", {"items": []})["items"]


def schedule(acc, d, files):
    try:
        at = datetime.fromisoformat(str(d["send_at"])[:16])
    except ValueError:
        raise ValueError("Date d'envoi invalide") from None
    if at < datetime.now() - timedelta(minutes=1):
        raise ValueError("La date d'envoi est passée")
    if not (d.get("to") or d.get("cc") or d.get("bcc")):
        raise ValueError("Indique au moins un destinataire")
    sid = uuid.uuid4().hex[:10]
    folder = os.path.join(QUEUE_DIR, sid)
    os.makedirs(folder, exist_ok=True)
    saved = []
    for i, f in enumerate(files):
        p = os.path.join(folder, f"{i}.bin")
        f.save(p)
        saved.append({"path": p, "name": f.filename, "type": f.mimetype})
    item = {"id": sid, "owner": acc["owner"], "account": acc["id"], "at": at.timestamp(), "fields": {k: v for k, v in d.items() if k != "send_at"},
            "files": saved, "created": time.time(), "to": d.get("to") or d.get("cc") or d.get("bcc"), "subject": d.get("subject") or "(sans objet)"}
    store.update("mail/programmes", {"items": []}, lambda x: x["items"].append(item))
    return {"ok": True, "scheduled": at.isoformat(), "id": sid}


def _send_due():
    now = time.time()
    due = [i for i in queue() if i["at"] <= now]
    for item in due:
        store.update("mail/programmes", {"items": []}, lambda x: x.__setitem__("items", [i for i in x["items"] if i["id"] != item["id"]]))
        try:
            acc = accounts.get(item["owner"], item["account"])
            info = {}
            files = [_Stored(f["path"], f["name"], f["type"]) for f in item["files"]]
            mail.send_message(acc, item["fields"], files, info)
            if item["fields"].get("follow_days"):
                follow(acc, info, item["fields"])
            activity.log(item["owner"], "mails", f"À {item['to']} : {item['subject']}", f"#/mails/{acc['id']}", title="Mail programmé envoyé")
        except Exception as e:  # noqa: BLE001
            activity.log(item["owner"], "mails", f"« {item['subject']} » n'a pas pu partir : {e}", "#/mails", kind="err", title="Mail programmé : échec")
        shutil.rmtree(os.path.join(QUEUE_DIR, item["id"]), ignore_errors=True)


@bp.get("/api/mail/scheduled")
def list_scheduled():
    user = g.user["name"]
    return jsonify([{k: i[k] for k in ("id", "account", "at", "to", "subject", "created")} | {"text": i["fields"].get("text", "")[:200]}
                    for i in sorted(queue(), key=lambda i: i["at"]) if i["owner"] == user])


@bp.delete("/api/mail/scheduled/<sid>")
def cancel_scheduled(sid):
    user = g.user["name"]

    def go(x):
        before = len(x["items"])
        x["items"] = [i for i in x["items"] if not (i["id"] == sid and i["owner"] == user)]
        return before != len(x["items"])
    found = store.update("mail/programmes", {"items": []}, go)
    if not found:
        raise ValueError("Mail programmé introuvable")
    shutil.rmtree(os.path.join(QUEUE_DIR, re.sub(r"\W", "", sid)), ignore_errors=True)
    return jsonify(ok=bool(found))


@bp.post("/api/mail/scheduled/<sid>/now")
def send_now(sid):
    user = g.user["name"]
    store.update("mail/programmes", {"items": []}, lambda x: [i.__setitem__("at", 0) for i in x["items"] if i["id"] == sid and i["owner"] == user])
    _send_due()
    return jsonify(ok=True)


# --- Relances (« rappelle-moi si pas de réponse ») -----------------------------------------------------------

def follow(acc, info, d):
    try:
        days = max(1, min(30, int(d.get("follow_days") or 0)))
    except ValueError:
        return
    if not info.get("msgid"):
        return
    item = {"id": uuid.uuid4().hex[:8], "owner": acc["owner"], "account": acc["id"], "msgid": info["msgid"], "subject": info.get("subject") or "",
            "to": d.get("to") or "", "due": time.time() + days * 86400, "created": time.time()}
    store.update("mail/relances", {"items": []}, lambda x: x["items"].append(item))


def _answered(acc, msgid):
    with mail.session(acc) as c:
        for folder in ["INBOX"] + [f["name"] for f in mail.folders(acc, c) if f["role"] in ("archive", "all")]:
            try:
                mail.select(c, folder)
            except ValueError:
                continue
            for header in ("In-Reply-To", "References"):
                typ, data = c.uid("SEARCH", "HEADER", header, f'"{msgid}"')
                if typ == "OK" and data and data[0]:
                    return True
    return False


def _check_followups():
    items = store.load("mail/relances", {"items": []})["items"]
    now, done = time.time(), set()
    for it in items:
        if it["due"] > now:
            continue
        try:
            acc = accounts.get(it["owner"], it["account"])
            if not _answered(acc, it["msgid"]):
                activity.log(it["owner"], "mails", f"{it['to']} n'a pas répondu à « {it['subject']} ». Une petite relance ?",
                             f"#/mails/{acc['id']}", title="Relance")
        except Exception as e:  # noqa: BLE001
            print("relance", e, flush=True)
        done.add(it["id"])
    if done:
        store.update("mail/relances", {"items": []}, lambda x: x.__setitem__("items", [i for i in x["items"] if i["id"] not in done]))


@bp.get("/api/mail/followups")
def list_followups():
    user = g.user["name"]
    return jsonify([i for i in store.load("mail/relances", {"items": []})["items"] if i["owner"] == user])


@bp.delete("/api/mail/followups/<fid>")
def cancel_followup(fid):
    user = g.user["name"]
    store.update("mail/relances", {"items": []}, lambda x: x.__setitem__("items", [i for i in x["items"] if not (i["id"] == fid and i["owner"] == user)]))
    return jsonify(ok=True)


def on_answer(acc, uid, msg):
    """Une réponse arrive : la relance correspondante est annulée."""
    refs = f"{msg['In-Reply-To'] or ''} {msg['References'] or ''}"
    if not refs.strip():
        return
    items = store.load("mail/relances", {"items": []})["items"]
    keep = [i for i in items if i["msgid"] not in refs]
    if len(keep) != len(items):
        store.update("mail/relances", {"items": []}, lambda x: x.__setitem__("items", [i for i in x["items"] if i["msgid"] not in refs]))


# --- Réponse automatique d'absence -------------------------------------------------------------------------

def vacation_of(acc):
    v = (acc.get("mail") or {}).get("vacation") or {}
    if not v.get("on"):
        return None
    today = date.today().isoformat()
    if (v.get("start") and today < v["start"]) or (v.get("end") and today > v["end"]):
        return None
    return v


def on_vacation(acc, uid, msg):
    v = vacation_of(acc)
    if not v:
        return
    import phishing
    sender = phishing.parseaddr(str(msg["From"] or ""))[1].lower()
    me = (acc.get("email") or "").lower()
    if not sender or sender == me or re.search(r"no-?reply|ne-pas-repondre|mailer-daemon|postmaster|notification", sender):
        return
    if msg["List-Id"] or msg["List-Unsubscribe"] or str(msg["Precedence"] or "").lower() in ("bulk", "list", "junk") \
            or str(msg["Auto-Submitted"] or "no").lower() != "no" or msg["X-Autoreply"] or msg["X-Autorespond"]:
        return
    if v.get("contacts_only"):
        trusted, _ = mail.trust_lists(acc["owner"])
        if sender not in trusted:
            return
    key = f"{acc['id']}|{sender}"
    sent = store.load("mail/absence", {})
    if time.time() - sent.get(key, 0) < 4 * 86400:  # une seule réponse tous les 4 jours par personne
        return
    m = EmailMessage()
    m["From"] = email.utils.formataddr((acc["mail"].get("name") or "", acc.get("email") or acc["mail"]["username"]))
    m["To"] = sender
    m["Subject"] = (v.get("subject") or "Absent") + " : " + re.sub(r"^((re|tr|fwd?)\s*:\s*)+", "", mail.dec(msg["Subject"]), flags=re.I)[:120]
    m["Date"] = email.utils.formatdate(localtime=True)
    m["Message-ID"] = email.utils.make_msgid()
    m["Auto-Submitted"] = "auto-replied"
    if msg["Message-ID"]:
        m["In-Reply-To"] = msg["Message-ID"]
        m["References"] = msg["Message-ID"]
    m.set_content(v.get("text") or "Je suis absent en ce moment et je te répondrai à mon retour.")
    mail.smtp_send(acc, m)
    store.update("mail/absence", {}, lambda x: x.__setitem__(key, time.time()))


@bp.get("/api/mail/<acc_id>/vacation")
def get_vacation(acc_id):
    acc = mail.account(acc_id)
    v = acc["mail"].get("vacation") or {}
    return jsonify({"on": False, "start": "", "end": "", "subject": "Absent", "text": "", "contacts_only": False, **v, "active": bool(vacation_of(acc))})


@bp.put("/api/mail/<acc_id>/vacation")
def set_vacation(acc_id):
    mail.account(acc_id)
    d = request.get_json(silent=True) or {}
    v = {"on": bool(d.get("on")), "subject": str(d.get("subject") or "Absent").strip()[:100], "text": str(d.get("text") or "").strip()[:5000],
         "start": str(d.get("start") or "")[:10], "end": str(d.get("end") or "")[:10], "contacts_only": bool(d.get("contacts_only"))}
    for k in ("start", "end"):
        if v[k]:
            try:
                date.fromisoformat(v[k])
            except ValueError:
                raise ValueError("Date invalide") from None
    if v["on"] and not v["text"]:
        raise ValueError("Écris le message de la réponse automatique")
    accounts.patch(acc_id, lambda a: a["mail"].__setitem__("vacation", v))
    return jsonify(v | {"active": bool(vacation_of(accounts.get(g.user["name"], acc_id)))})


# --- Boucle -----------------------------------------------------------------------------------------------

def loop():
    tick = 0
    while True:
        time.sleep(30)
        tick += 1
        try:
            _send_due()
            if tick % 20 == 0:  # toutes les 10 minutes
                _check_followups()
        except Exception as e:  # noqa: BLE001
            print("mails programmés", e, flush=True)


def start():
    os.makedirs(QUEUE_DIR, exist_ok=True)
    mail.AFTER_SCREEN.extend([on_answer, on_vacation])
    threading.Thread(target=loop, daemon=True).start()
