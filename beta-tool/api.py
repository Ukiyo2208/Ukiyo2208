"""API externe de Bêta Tool (/api/v1) : mails, agenda et contacts pour d'autres applis
(Home Assistant, Raccourcis iPhone, n8n, scripts…).

Chaque membre crée ses jetons dans Réglages → API, avec les droits choisis (lecture des mails,
envoi, agenda, contacts…). Un jeton s'utilise dans l'en-tête « Authorization: Bearer bt_… » ;
il ne donne accès qu'aux données de son propriétaire et peut être révoqué à tout moment.
Seul son empreinte (SHA-256) est gardée sur le NAS."""

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta
from functools import wraps

from flask import Blueprint, g, jsonify, request

import auth
import settings
import store

bp = Blueprint("api", __name__)
SCOPES = {
    "mails:read": "Lire les mails",
    "mails:send": "Envoyer des mails",
    "agenda:read": "Lire l'agenda",
    "agenda:write": "Ajouter et modifier des événements",
    "contacts:read": "Lire les contacts",
    "contacts:write": "Ajouter et modifier des contacts",
    "assistant:use": "Commandes vocales et widget (courses, tâches, rendez-vous, résumé du jour)",
}
TOOL_OF = {"mails": "mails", "agenda": "agenda", "contacts": "contacts", "assistant": None}


# --- Jetons ------------------------------------------------------------------------------------

def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def tokens():
    return store.load("api/jetons", {"tokens": []})["tokens"]


def resolve(token):
    """(utilisateur, droits) pour un jeton valide, sinon None. Note la date de dernière utilisation."""
    if not token.startswith("bt_"):
        return None
    h = _hash(token)
    t = next((t for t in tokens() if hmac.compare_digest(t["hash"], h)), None)
    if not t or (t.get("expires") and t["expires"] < time.time()):
        return None
    if auth.mode() == "accounts":
        u = auth.find(t["user"])
        if not u:
            return None
        user = {"name": u["name"], "role": u["role"]}
    else:
        user = {"name": t["user"], "role": "admin"}
    if time.time() - t.get("used", 0) > 60:  # pas d'écriture à chaque appel
        def go(d):
            for x in d["tokens"]:
                if x["id"] == t["id"]:
                    x["used"], x["ip"] = time.time(), request.remote_addr
        store.update("api/jetons", {"tokens": []}, go)
    return user, set(t["scopes"])


def need(scope):
    """Décorateur : droit demandé (les sessions du navigateur ont tous les droits de leur compte)."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            scopes = getattr(g, "api_scopes", None)
            if scopes != "*" and scope not in (scopes or set()):
                return jsonify(error=f"Ce jeton n'a pas le droit « {scope} »"), 403
            tool = TOOL_OF[scope.split(":")[0]]
            if tool and not settings.enabled(tool):
                return jsonify(error="Cet outil est désactivé dans les réglages"), 404
            return fn(*a, **kw)
        return wrapper
    return deco


@bp.get("/api/me/tokens")
def my_tokens():
    if getattr(g, "api_scopes", None) not in (None, "*"):
        raise PermissionError("Les jetons se gèrent depuis Bêta Tool, pas avec un jeton")
    mine = [{k: v for k, v in t.items() if k not in ("hash", "user")} for t in tokens() if t["user"] == g.user["name"]]
    return jsonify(tokens=sorted(mine, key=lambda t: -t["created"]), scopes=SCOPES, base=request.host_url.rstrip("/") + "/api/v1",
                   open=auth.mode() != "accounts")


@bp.post("/api/me/tokens")
def new_token():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name") or "").strip()[:60]
    scopes = [s for s in d.get("scopes") or [] if s in SCOPES]
    if not name:
        raise ValueError("Donne un nom au jeton (ex. Home Assistant)")
    if not scopes:
        raise ValueError("Choisis au moins un droit")
    days = int(d.get("days") or 0)
    token = "bt_" + secrets.token_urlsafe(32)
    entry = {"id": secrets.token_hex(6), "user": g.user["name"], "name": name, "scopes": scopes, "hash": _hash(token),
             "prefix": token[:7] + "…", "created": time.time(), "expires": time.time() + days * 86400 if days > 0 else None, "used": 0}
    store.update("api/jetons", {"tokens": []}, lambda x: x["tokens"].append(entry))
    return jsonify(token=token, id=entry["id"])


@bp.delete("/api/me/tokens/<tid>")
def revoke(tid):
    def go(d):
        before = len(d["tokens"])
        d["tokens"] = [t for t in d["tokens"] if not (t["id"] == tid and t["user"] == g.user["name"])]
        return before != len(d["tokens"])
    if not store.update("api/jetons", {"tokens": []}, go):
        raise ValueError("Jeton introuvable")
    return jsonify(ok=True)


# --- API v1 ------------------------------------------------------------------------------------

def _json_view(resp):
    """Réponse d'une route interne → objet Python."""
    return resp.get_json() if hasattr(resp, "get_json") else resp


@bp.get("/api/v1")
def index():
    return jsonify(name="Bêta Tool API", version=1, user=g.user["name"], scopes=sorted(g.api_scopes) if g.api_scopes != "*" else "*",
                   docs=request.host_url.rstrip("/") + "/api/v1/openapi.json")


@bp.get("/api/v1/me")
def me():
    return jsonify(user=g.user["name"], role=g.user["role"], scopes=sorted(g.api_scopes) if g.api_scopes != "*" else sorted(SCOPES))


# Mails

@bp.get("/api/v1/mail/accounts")
@need("mails:read")
def mail_accounts():
    import accounts
    import mail
    return jsonify([{"id": a["id"], "label": a["label"], "email": a.get("email"), "provider": a["provider"], "unread": mail._unread.get(a["id"])}
                    for a in accounts.of(g.user["name"]) if a.get("mail")])


@bp.get("/api/v1/mail/unread")
@need("mails:read")
def mail_unread():
    import accounts
    import mail
    accs = [a for a in accounts.of(g.user["name"]) if a.get("mail")]
    per = {a["id"]: mail._unread.get(a["id"], 0) for a in accs}
    return jsonify(total=sum(per.values()), accounts=[{"id": a["id"], "label": a["label"], "unread": per[a["id"]]} for a in accs])


@bp.get("/api/v1/mail/messages")
@need("mails:read")
def mail_messages():
    import mail
    acc = mail.account(request.args.get("account") or _first_mail_account())
    folder = request.args.get("folder") or "INBOX"
    limit = max(1, min(200, int(request.args.get("limit", 20) or 20)))
    page = max(0, int(request.args.get("page", 0) or 0))
    with mail.session(acc) as c:
        total = mail.select(c, folder)
        uids = mail.search_uids(c, (request.args.get("q") or "").strip()[:200], request.args.get("unread") in ("1", "true")) if total else []
        items = mail.summaries(c, [u.decode() for u in uids[page * limit:(page + 1) * limit]], acc)
    return jsonify(account=acc["id"], folder=folder, total=len(uids), messages=items)


@bp.get("/api/v1/mail/messages/<acc_id>/<int:uid>")
@need("mails:read")
def mail_message(acc_id, uid):
    import mail
    acc = mail.account(acc_id)
    folder = request.args.get("folder") or "INBOX"
    with mail.session(acc) as c:
        mail.select(c, folder)
        out = mail.read(acc, c, folder, str(uid))
        if request.args.get("mark_read") in ("1", "true"):
            mail.select(c, folder, readonly=False)
            c.uid("STORE", str(uid), "+FLAGS", "(\\Seen)")
    if request.args.get("html") not in ("1", "true"):
        out.pop("html", None)
    return jsonify(out)


@bp.post("/api/v1/mail/send")
@need("mails:send")
def mail_send():
    import mail
    d = request.get_json(silent=True) or {}
    acc = mail.account(d.get("account") or _first_mail_account())
    warn = mail.send_message(acc, {k: str(d.get(k) or "") for k in ("to", "cc", "bcc", "subject", "text")} | {"signature": "1" if d.get("signature", True) else "0"})
    return jsonify(ok=True, warning=warn)


def _first_mail_account():
    import accounts
    acc = next((a for a in accounts.of(g.user["name"]) if a.get("mail")), None)
    if not acc:
        raise ValueError("Aucune boîte mail raccordée")
    return acc["id"]


# Agenda

@bp.get("/api/v1/calendars")
@need("agenda:read")
def calendars():
    import agenda
    return jsonify(_json_view(agenda.overview())["calendars"])


@bp.get("/api/v1/events")
@need("agenda:read")
def events():
    import agenda
    try:
        start = datetime.fromisoformat((request.args.get("start") or datetime.now().date().isoformat())[:10])
        end = datetime.fromisoformat(request.args["end"][:10]) if request.args.get("end") else start + timedelta(days=7)
    except ValueError:
        raise ValueError("Dates invalides (format AAAA-MM-JJ)") from None
    return jsonify(agenda.all_events(g.user["name"], start, end))


@bp.post("/api/v1/events")
@need("agenda:write")
def event_create():
    import agenda
    return agenda.create()


@bp.put("/api/v1/events/<path:uid>")
@need("agenda:write")
def event_update(uid):
    import agenda
    return agenda.update(uid)


@bp.delete("/api/v1/events/<path:uid>")
@need("agenda:write")
def event_delete(uid):
    import agenda
    return agenda.delete(uid)


# Contacts

@bp.get("/api/v1/addressbooks")
@need("contacts:read")
def addressbooks():
    import contacts
    return jsonify([contacts.public_book(b) for b in contacts.books(g.user["name"])])


@bp.get("/api/v1/contacts")
@need("contacts:read")
def contact_list():
    import contacts
    return jsonify(_json_view(contacts.list_contacts())["contacts"])


@bp.get("/api/v1/contacts/<cid>")
@need("contacts:read")
def contact_get(cid):
    import contacts
    return contacts.get_contact(cid)


@bp.post("/api/v1/contacts")
@need("contacts:write")
def contact_create():
    import contacts
    return contacts.create_contact()


@bp.put("/api/v1/contacts/<cid>")
@need("contacts:write")
def contact_update(cid):
    import contacts
    return contacts.update_contact(cid)


@bp.delete("/api/v1/contacts/<cid>")
@need("contacts:write")
def contact_delete(cid):
    import contacts
    return contacts.delete_contact(cid)


# --- Assistant : commandes vocales et widget ----------------------------------------------------------

@bp.post("/api/v1/command")
@need("assistant:use")
def v1_command():
    """Phrase en langage courant (Siri, Google Assistant, Home Assistant…) → action + phrase à dire."""
    import commande
    d = request.get_json(silent=True) or {}
    return jsonify(commande.run(g.user["name"], d.get("text") or request.args.get("text")))


@bp.get("/api/v1/widget")
@need("assistant:use")
def v1_widget():
    """Résumé compact pour un widget d'écran d'accueil (Scriptable, KWGT, Home Assistant…)."""
    import journee
    b = journee.build(g.user["name"])
    w = b.get("weather") or {}
    out = {"date": b["date"], "fete": b.get("fete"), "summary": journee.summary(b),
           "weather": {k: w.get(k) for k in ("emoji", "label", "min", "max", "rain")} if w else None,
           "events": [{"time": e.get("time") or "", "title": e["text"]} for e in (b.get("events") or [])[:4]],
           "bins": b.get("bins") or [], "tasks": [t["text"] for t in (b.get("tasks") or [])[:4]], "tasks_count": len(b.get("tasks") or []),
           "unread": (b.get("mail") or {}).get("unread"), "parcels": len(b.get("parcels") or []), "budget": b.get("budget")}
    return jsonify(out)


# --- Description OpenAPI ---------------------------------------------------------------------------

def _op(summary, scope, params=(), body=None, tag=""):
    op = {"summary": summary, "tags": [tag], "security": [{"jeton": [scope]}] if scope else [],
          "parameters": [{"name": n, "in": where, "required": req, "schema": {"type": "string"}, "description": desc} for n, where, req, desc in params],
          "responses": {"200": {"description": "OK"}, "401": {"description": "Jeton absent, invalide ou révoqué"}, "403": {"description": "Droit manquant"}}}
    if body:
        op["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": body}}}}
    return op


@bp.get("/api/v1/openapi.json")
def openapi():
    s = {"type": "string"}
    arr = lambda props: {"type": "array", "items": {"type": "object", "properties": props}}
    event = {"title": s, "start": {"type": "string", "example": "2026-11-02T18:30"}, "end": s, "allday": {"type": "boolean"}, "cal": s,
             "location": s, "notes": s, "reminder": {"type": "string", "example": "30"}, "recur": {"type": "string", "enum": ["", "daily", "weekly", "monthly", "yearly"]}}
    contact = {"first": s, "last": s, "org": s, "title": s, "book": s, "birthday": {"type": "string", "example": "1990-05-04"}, "notes": s, "url": s,
               "emails": arr({"type": s, "value": s}), "phones": arr({"type": s, "value": s}),
               "addresses": arr({"type": s, "street": s, "code": s, "city": s, "country": s})}
    paths = {
        "/me": {"get": _op("Utilisateur et droits du jeton", None, tag="Général")},
        "/mail/accounts": {"get": _op("Boîtes mail raccordées", "mails:read", tag="Mails")},
        "/mail/unread": {"get": _op("Nombre de mails non lus (total et par boîte)", "mails:read", tag="Mails")},
        "/mail/messages": {"get": _op("Liste des mails (les plus récents d'abord)", "mails:read", [
            ("account", "query", False, "id de la boîte (par défaut la première)"), ("folder", "query", False, "dossier, INBOX par défaut"),
            ("q", "query", False, "recherche"), ("unread", "query", False, "1 = non lus seulement"), ("limit", "query", False, "1 à 200, 20 par défaut"),
            ("page", "query", False, "page, à partir de 0")], tag="Mails")},
        "/mail/messages/{account}/{uid}": {"get": _op("Un mail (texte, pièces jointes, analyse anti-faux mail)", "mails:read", [
            ("account", "path", True, "id de la boîte"), ("uid", "path", True, "numéro du mail"), ("folder", "query", False, "INBOX par défaut"),
            ("mark_read", "query", False, "1 = marquer comme lu"), ("html", "query", False, "1 = inclure le HTML")], tag="Mails")},
        "/mail/send": {"post": _op("Envoyer un mail", "mails:send", body={"account": s, "to": s, "cc": s, "bcc": s, "subject": s, "text": s,
                                                                          "signature": {"type": "boolean"}}, tag="Mails")},
        "/calendars": {"get": _op("Agendas (Bêta Tool et raccordés)", "agenda:read", tag="Agenda")},
        "/events": {"get": _op("Événements d'une période (7 prochains jours par défaut)", "agenda:read", [
                        ("start", "query", False, "AAAA-MM-JJ"), ("end", "query", False, "AAAA-MM-JJ (exclu)")], tag="Agenda"),
                    "post": _op("Ajouter un événement", "agenda:write", body=event, tag="Agenda")},
        "/events/{uid}": {"put": _op("Modifier un événement", "agenda:write", [("uid", "path", True, "identifiant")], body=event, tag="Agenda"),
                          "delete": _op("Supprimer un événement", "agenda:write", [("uid", "path", True, "identifiant")], tag="Agenda")},
        "/command": {"post": _op("Commande en langage courant ({\"text\": \"ajoute du lait à la liste de courses\"}) ; renvoie « speech » à lire", "assistant:use",
                                 body={"type": "object", "properties": {"text": {"type": "string"}}}, tag="Assistant")},
        "/widget": {"get": _op("Résumé du jour pour un widget", "assistant:use", tag="Assistant")},
        "/addressbooks": {"get": _op("Carnets d'adresses", "contacts:read", tag="Contacts")},
        "/contacts": {"get": _op("Contacts", "contacts:read", [("q", "query", False, "recherche"), ("book", "query", False, "id du carnet")], tag="Contacts"),
                      "post": _op("Ajouter un contact", "contacts:write", body=contact, tag="Contacts")},
        "/contacts/{id}": {"get": _op("Un contact", "contacts:read", [("id", "path", True, "identifiant")], tag="Contacts"),
                           "put": _op("Modifier un contact", "contacts:write", [("id", "path", True, "identifiant")], body=contact, tag="Contacts"),
                           "delete": _op("Supprimer un contact", "contacts:write", [("id", "path", True, "identifiant")], tag="Contacts")},
    }
    return jsonify({"openapi": "3.0.3", "info": {"title": "Bêta Tool API", "version": "1",
                                                 "description": "Mails, agenda et contacts de ton Bêta Tool. Crée un jeton dans Réglages → API."},
                    "servers": [{"url": request.host_url.rstrip("/") + "/api/v1"}],
                    "components": {"securitySchemes": {"jeton": {"type": "http", "scheme": "bearer", "description": "Jeton bt_… créé dans Réglages → API"}}},
                    "security": [{"jeton": []}], "paths": paths})
