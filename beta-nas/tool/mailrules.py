"""Règles de tri automatique des mails : « si le mail vient de… / contient… / est une newsletter…
alors le ranger dans…, le marquer comme lu, le suivre, le mettre à la corbeille, envoyer la facture
à Paperasse, ne pas me notifier ».

Les règles de chaque compte Bêta Tool s'appliquent aux nouveaux mails de la boîte de réception
(juste après le filtre anti-faux mails), et à la demande sur les mails déjà reçus."""

import email
import email.policy
import re
import time
import uuid

from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("mailrules", __name__)
FIELDS = ("from", "to", "subject", "body", "newsletter", "attachment", "book")
OPS = ("contains", "not_contains", "is", "ends")
ACTIONS = ("move", "read", "star", "trash", "paperasse", "silent")


def rules(user):
    return store.load("mail/regles", {}).get(user, [])


def _save(user, items):
    store.update("mail/regles", {}, lambda d: d.__setitem__(user, items))


# --- Évaluation ----------------------------------------------------------------------------

def features(msg, user):
    import mail
    import phishing
    sender = phishing.parseaddr(mail.dec(msg["From"]))
    hp = msg.get_body(preferencelist=("plain", "html"))
    try:
        body = hp.get_content() if hp is not None else ""
    except (LookupError, KeyError):
        body = ""
    if hp is not None and hp.get_content_type() == "text/html":
        body = re.sub(r"<[^>]+>", " ", body)
    books = set()
    try:
        import contacts
        for c in contacts.all_contacts(user):
            if any(e["value"].lower() == sender[1].lower() for e in c["emails"]):
                books.add(c["book"])
    except Exception:  # noqa: BLE001
        pass
    return {"from": f"{sender[0]} <{sender[1]}>".lower(), "from_addr": sender[1].lower(),
            "to": f"{mail.dec(msg['To'])}, {mail.dec(msg['Cc'])}".lower(), "subject": mail.dec(msg["Subject"]).lower(),
            "body": body[:30000].lower(), "books": books,
            "newsletter": bool(msg["List-Unsubscribe"] or msg["List-Id"] or str(msg["Precedence"] or "").lower() in ("bulk", "list")),
            "attachment": any(not p.is_multipart() and p.get_filename() for p in msg.walk())}


def matches(cond, f):
    field, op, value = cond.get("field"), cond.get("op", "contains"), str(cond.get("value") or "").strip().lower()
    if field in ("newsletter", "attachment"):
        return f[field] == (value != "no")
    if field == "book":
        return bool(f["books"]) if value == "any" else not f["books"] if value == "none" else value in f["books"]
    text = f.get(field, "")
    if field == "from" and op in ("is", "ends"):
        text = f["from_addr"]
    words = [w.strip() for w in value.split(",") if w.strip()] or [""]
    if op == "contains":
        return any(w in text for w in words)
    if op == "not_contains":
        return not any(w in text for w in words)
    if op == "is":
        return any(text == w for w in words)
    if op == "ends":
        return any(text.endswith(w if w.startswith(("@", ".")) else "@" + w) or text.endswith("." + w.lstrip("@")) for w in words)
    return False


def plan_for(msg, user, account_id, items=None):
    """Actions à faire pour un mail : {"move": dossier | None, "trash", "read", "star", "paperasse", "silent", "rules": [noms]}."""
    f = features(msg, user)
    out = {"move": None, "trash": False, "read": False, "star": False, "paperasse": False, "silent": False, "rules": []}
    for r in items if items is not None else rules(user):
        if not r.get("on", True) or (r.get("account") not in (None, "", "*", account_id)):
            continue
        conds = r.get("conditions") or []
        if not conds:
            continue
        ok = all(matches(c, f) for c in conds) if r.get("match", "all") == "all" else any(matches(c, f) for c in conds)
        if not ok:
            continue
        out["rules"].append(r["name"])
        for a in r.get("actions") or []:
            t = a.get("type")
            if t == "move" and a.get("folder"):
                out["move"] = out["move"] or a["folder"]
            elif t in ("trash", "read", "star", "paperasse", "silent"):
                out[t] = True
        if out["move"] or out["trash"]:
            break  # le mail quitte la boîte : on s'arrête là
    return out


def execute(acc, c, folder, plans):
    """Applique les plans {uid: plan} dans le dossier ouvert ; renvoie les uid sortis du dossier."""
    import mail
    if not plans:
        return set()
    mail.select(c, folder, readonly=False)
    for flag, key in (("\\Seen", "read"), ("\\Flagged", "star")):
        ids = [u for u, p in plans.items() if p[key]]
        if ids:
            c.uid("STORE", ",".join(ids), "+FLAGS", f"({flag})")
    for uid, p in plans.items():  # factures et documents vers Paperasse
        if p["paperasse"]:
            try:
                _to_paperasse(acc, c, folder, uid)
            except Exception as e:  # noqa: BLE001
                print("règles paperasse", e, flush=True)
    gone = set()
    names = {f["name"]: f for f in mail.folders(acc, c)}
    trash = next((n for n, f in names.items() if f["role"] == "trash"), None)
    targets = {}
    for uid, p in plans.items():
        dest = trash if p["trash"] else p["move"]
        if dest and dest != folder:
            targets.setdefault(dest, []).append(uid)
    for dest, ids in targets.items():
        if dest not in names:
            c.create(mail.q(dest))
            c.subscribe(mail.q(dest))
        mail.select(c, folder, readonly=False)
        ids_s = ",".join(ids)
        if "MOVE" in mail.caps(c):
            typ, _ = c.uid("MOVE", ids_s, mail.q(dest))
        else:
            typ, _ = c.uid("COPY", ids_s, mail.q(dest))
            if typ == "OK":
                c.uid("STORE", ids_s, "+FLAGS", "(\\Deleted)")
                c.uid("EXPUNGE", ids_s) if "UIDPLUS" in mail.caps(c) else c.expunge()
        if typ == "OK":
            gone.update(ids)
    mail.select(c, folder)
    return gone


def _to_paperasse(acc, c, folder, uid):
    import os
    import paperasse
    import settings
    import mail
    if not settings.enabled("paperasse"):
        return
    typ, data = c.uid("FETCH", uid, "(BODY.PEEK[])")
    parts = mail._fetch_parts(data) if typ == "OK" else []
    if not parts:
        return
    msg = email.message_from_bytes(parts[0][1], policy=email.policy.default)
    for part in msg.walk():
        name = part.get_filename()
        if part.is_multipart() or not name or not name.lower().endswith((".pdf", ".jpg", ".jpeg", ".png", ".heic")):
            continue
        tmp_dir = os.path.join(mail.WORK_DIR, "paperasse-entrants")
        os.makedirs(tmp_dir, exist_ok=True)
        tmp = os.path.join(tmp_dir, uuid.uuid4().hex[:8] + os.path.splitext(name)[1].lower())
        with open(tmp, "wb") as f:
            f.write(part.get_payload(decode=True) or b"")
        paperasse.enqueue(tmp, mail.dec(name), acc["owner"], source="mail")


def run(acc, c, folder, items):
    """items : [(uid, message)] déjà lus. Renvoie (uid sortis, uid à ne pas notifier)."""
    user_rules = rules(acc["owner"])
    if not user_rules:
        return set(), set()
    plans = {uid: plan_for(msg, acc["owner"], acc["id"], user_rules) for uid, msg in items}
    plans = {u: p for u, p in plans.items() if p["rules"]}
    gone = execute(acc, c, folder, plans)
    return gone, {u for u, p in plans.items() if p["silent"]}


# --- Routes ------------------------------------------------------------------------------------

def _clean(d):
    name = str(d.get("name") or "").strip()[:80]
    conds = [{"field": c.get("field"), "op": c.get("op") if c.get("op") in OPS else "contains", "value": str(c.get("value") or "")[:300]}
             for c in d.get("conditions") or [] if c.get("field") in FIELDS]
    acts = [{"type": a.get("type"), "folder": str(a.get("folder") or "").strip()[:120]} for a in d.get("actions") or [] if a.get("type") in ACTIONS]
    acts = [a for a in acts if a["type"] != "move" or a["folder"]]
    if not conds:
        raise ValueError("Ajoute au moins une condition")
    if any(c["field"] in ("from", "to", "subject", "body") and not c["value"].strip() for c in conds):
        raise ValueError("Une condition est vide")
    if not acts:
        raise ValueError("Choisis au moins une action")
    return {"name": name or "Règle", "on": bool(d.get("on", True)), "account": d.get("account") or "*",
            "match": "any" if d.get("match") == "any" else "all", "conditions": conds, "actions": acts}


@bp.get("/api/mail/rules")
def list_rules():
    return jsonify(rules(g.user["name"]))


@bp.post("/api/mail/rules")
def add_rule():
    r = _clean(request.get_json(silent=True) or {}) | {"id": uuid.uuid4().hex[:8], "created": time.time()}
    _save(g.user["name"], rules(g.user["name"]) + [r])
    return jsonify(r)


@bp.put("/api/mail/rules/<rid>")
def edit_rule(rid):
    d = request.get_json(silent=True) or {}
    items = rules(g.user["name"])
    r = next((r for r in items if r["id"] == rid), None)
    if not r:
        raise ValueError("Règle introuvable")
    if set(d) == {"on"}:
        r["on"] = bool(d["on"])
    elif "move" in d:  # changer l'ordre
        i = items.index(r)
        j = max(0, min(len(items) - 1, i + (1 if d["move"] == "down" else -1)))
        items[i], items[j] = items[j], items[i]
    else:
        r.update(_clean(d))
    _save(g.user["name"], items)
    return jsonify(ok=True)


@bp.delete("/api/mail/rules/<rid>")
def delete_rule(rid):
    _save(g.user["name"], [r for r in rules(g.user["name"]) if r["id"] != rid])
    return jsonify(ok=True)


@bp.post("/api/mail/rules/apply")
def apply_now():
    """Applique les règles aux 300 derniers mails de la boîte de réception d'un compte."""
    import mail
    acc = mail.account((request.get_json(silent=True) or {}).get("account") or "")
    with mail.session(acc) as c:
        total = mail.select(c, "INBOX")
        uids = [u.decode() for u in mail.search_uids(c, "")[:300]] if total else []
        items = []
        if uids:
            typ, data = c.uid("FETCH", ",".join(uids), "(UID BODY.PEEK[]<0.100000>)")
            for meta, raw in mail._fetch_parts(data) if typ == "OK" else []:
                m = re.search(r"UID (\d+)", meta)
                if m:
                    items.append((m[1], email.message_from_bytes(raw, policy=email.policy.default)))
        user_rules = rules(acc["owner"])
        plans = {u: plan_for(msg, acc["owner"], acc["id"], user_rules) for u, msg in items}
        plans = {u: p for u, p in plans.items() if p["rules"]}
        gone = execute(acc, c, "INBOX", plans)
    return jsonify(matched=len(plans), moved=len(gone))
