"""Comptes professionnels Microsoft 365 en lecture seule, par Microsoft Graph (sans IMAP ni mot de passe
d'application) : lire les mails et les pièces jointes, lire le calendrier, recevoir les notifications des
nouveaux mails, et, si on l'a choisi, ranger des mails dans des dossiers (déplacer, archiver, lu / non lu).

Jamais d'envoi, de réponse, de suppression ni de modification du calendrier : les droits demandés à
Microsoft sont seulement Mail.Read (ou Mail.ReadWrite pour pouvoir ranger), Calendars.Read et User.Read.
Les identifiants de mail sont « immuables » (ils ne changent pas quand le mail est déplacé)."""

import base64
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests

import accounts

GRAPH = os.environ.get("GRAPH_URL", "https://graph.microsoft.com/v1.0").rstrip("/")
PAGE = 50
ROLES = {"inbox": "inbox", "sentitems": "sent", "drafts": "drafts", "deleteditems": "trash", "junkemail": "junk", "archive": "archive"}
NAMES = {"inbox": "Boîte de réception", "sent": "Envoyés", "drafts": "Brouillons", "trash": "Éléments supprimés",
         "junk": "Courrier indésirable", "archive": "Archives"}
ORDRE = ["inbox", "archive", "sent", "drafts", "junk", "trash"]
CHAMPS = "id,subject,from,toRecipients,receivedDateTime,isRead,flag,hasAttachments,importance,bodyPreview"
LECTURE_SEULE = "Compte professionnel en lecture seule : cette action n'est pas possible."


def est_graph(acc):
    return bool(acc.get("mail")) and acc["mail"].get("kind") == "graph"


def peut_ranger(acc):
    return est_graph(acc) and bool(acc["mail"].get("move"))


def _cle(acc):
    return acc["mail"].get("token") or "ms_pro"


def _appel(acc, methode, chemin, cle=None, brut=False, **kw):
    try:
        r = requests.request(methode, chemin if chemin.startswith("http") else GRAPH + chemin, timeout=30, headers={
            "Authorization": "Bearer " + accounts.token(acc, cle or _cle(acc)), "Prefer": 'IdType="ImmutableId"',
            "ConsistencyLevel": "eventual", **kw.pop("headers", {})}, **kw)
    except requests.RequestException as e:
        raise ValueError(f"Microsoft 365 injoignable ({e.__class__.__name__})") from None
    if r.status_code >= 400:
        try:
            msg = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = str(r.status_code)
        if r.status_code == 403:
            msg += " (droit refusé par ton entreprise ou non accordé à la connexion)"
        raise ValueError(f"Microsoft 365 a refusé la demande : {msg}")
    if brut:
        return r
    return r.json() if r.content else {}


def _dossier(nom):
    """« INBOX » (valeur par défaut de la page) → dossier connu « inbox » de Microsoft."""
    return "inbox" if not nom or nom.upper() == "INBOX" else nom


def _adresse(x):
    a = (x or {}).get("emailAddress") or {}
    return {"name": a.get("name") or "", "email": (a.get("address") or "").lower()}


def _ts(iso):
    try:
        return datetime.fromisoformat((iso or "").replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def test(acc):
    _appel(acc, "GET", "/me/mailFolders/inbox?$select=id")


# --- Dossiers ---------------------------------------------------------------------------------------

def folders(acc):
    roles = {}
    for connu, role in ROLES.items():
        try:
            roles[_appel(acc, "GET", f"/me/mailFolders/{connu}?$select=id")["id"]] = role
        except ValueError:
            pass
    out = []

    def ajouter(liste, profondeur, parent=""):
        for f in liste:
            role = roles.get(f["id"])
            nom = f.get("displayName") or "Dossier"
            out.append({"name": f["id"], "label": NAMES.get(role) or nom, "role": role, "sep": "/", "depth": 0 if role else profondeur,
                        "unread": f.get("unreadItemCount", 0) if role in (None, "inbox") else None, "path": f"{parent}{nom}"})
            if f.get("childFolderCount") and profondeur < 2:
                enfants = _appel(acc, "GET", f"/me/mailFolders/{f['id']}/childFolders?$top=100").get("value", [])
                ajouter(enfants, profondeur + 1, f"{parent}{nom}/")
    ajouter(_appel(acc, "GET", "/me/mailFolders?$top=100").get("value", []), 0)
    out.sort(key=lambda f: (ORDRE.index(f["role"]) if f["role"] in ORDRE else 99, f["path"].lower()))
    return out


# --- Liste et lecture -------------------------------------------------------------------------------

def _resume(m):
    import phishing
    de = [_adresse(m.get("from"))] if m.get("from") else []
    out = {"uid": m["id"], "from": de, "to": [_adresse(x) for x in m.get("toRecipients") or []],
           "subject": m.get("subject") or "(sans objet)", "date": _ts(m.get("receivedDateTime")), "seen": bool(m.get("isRead")),
           "flagged": (m.get("flag") or {}).get("flagStatus") == "flagged", "answered": False, "size": 0,
           "attach": bool(m.get("hasAttachments")), "preview": (m.get("bodyPreview") or "")[:200]}
    if de:
        v = phishing.analyze(f"{de[0]['name']} <{de[0]['email']}>", out["subject"])
        if v["level"] != "ok":
            out["security"] = {"level": v["level"], "reasons": v["reasons"]}
    return out


def messages(acc, dossier, page=0, recherche="", non_lus=False):
    params = {"$top": str(PAGE), "$select": CHAMPS, "$count": "true"}
    if recherche:
        params["$search"] = '"' + recherche.replace('"', " ") + '"'
        if page:
            params["$skip"] = str(page * PAGE)
    else:
        params["$orderby"] = "receivedDateTime desc"
        params["$skip"] = str(page * PAGE)
        if non_lus:
            params["$filter"] = "isRead eq false"
    d = _appel(acc, "GET", f"/me/mailFolders/{quote(_dossier(dossier), safe='')}/messages", params=params)
    items = [_resume(m) for m in d.get("value", [])]
    total = d.get("@odata.count", len(items) + (PAGE if d.get("@odata.nextLink") else 0) + page * PAGE)
    return {"messages": items, "total": total, "page": page, "more": bool(d.get("@odata.nextLink"))}


def pieces(acc, uid):
    return _appel(acc, "GET", f"/me/messages/{quote(uid, safe='')}/attachments?$select=id,name,size,contentType,isInline,contentId").get("value", [])


def read(acc, dossier, uid, marquer_lu=False):
    import mail
    m = _appel(acc, "GET", f"/me/messages/{quote(uid, safe='')}", params={
        "$select": CHAMPS + ",body,ccRecipients,replyTo,internetMessageId"})
    corps = (m.get("body") or {}).get("content") or ""
    if (m.get("body") or {}).get("contentType") == "html":
        corps = mail.clean_html(corps)
    else:
        corps = mail.text_to_html(corps)
    jointes = pieces(acc, uid) if m.get("hasAttachments") else []
    for p in jointes:  # images intégrées (cid:) en data: URI
        if p.get("isInline") and str(p.get("contentType", "")).startswith("image/") and p.get("size", 0) < 3 * 1024 ** 2:
            try:
                brut = _appel(acc, "GET", f"/me/messages/{quote(uid, safe='')}/attachments/{quote(p['id'], safe='')}/$value", brut=True).content
                corps = corps.replace(f"cid:{p.get('contentId') or p['name']}", f"data:{p['contentType']};base64,{base64.b64encode(brut).decode()}")
            except ValueError:
                pass
    if marquer_lu and peut_ranger(acc) and not m.get("isRead"):
        try:
            _appel(acc, "PATCH", f"/me/messages/{quote(uid, safe='')}", json={"isRead": True})
        except ValueError:
            pass
    r = _resume(m)
    return {**r, "folder": dossier, "cc": [_adresse(x) for x in m.get("ccRecipients") or []],
            "reply_to": [_adresse(x) for x in m.get("replyTo") or []], "message_id": m.get("internetMessageId") or "", "references": "",
            "html": corps, "text": re.sub(r"<[^>]+>", " ", corps)[:200000], "remote_images": bool(mail.REMOTE.search(corps)),
            "attachments": [{"n": i, "name": p.get("name") or "piece-jointe", "size": p.get("size", 0), "type": p.get("contentType")}
                            for i, p in enumerate(x for x in jointes if not x.get("isInline"))],
            "unsubscribe": None, "invite": None, "readonly": True, "can_move": peut_ranger(acc),
            "security": {"level": r.get("security", {}).get("level", "ok"), "reasons": r.get("security", {}).get("reasons", []), "score": 0, "trusted": False}}


def piece(acc, uid, n):
    """(nom, type, contenu) de la n-ième pièce jointe (hors images intégrées)."""
    jointes = [p for p in pieces(acc, uid) if not p.get("isInline")]
    if not 0 <= n < len(jointes):
        raise ValueError("Pièce jointe introuvable")
    p = jointes[n]
    brut = _appel(acc, "GET", f"/me/messages/{quote(uid, safe='')}/attachments/{quote(p['id'], safe='')}/$value", brut=True).content
    return p.get("name") or "piece-jointe", p.get("contentType") or "application/octet-stream", brut


# --- Ranger (seulement si le compte a été connecté avec « pouvoir ranger ») ---------------------------

def action(acc, op, uids, vers=None):
    if not peut_ranger(acc):
        raise ValueError("Ce compte professionnel est en lecture seule. Pour ranger des mails, reconnecte-le avec « pouvoir ranger les mails ».")
    if op in ("read", "unread"):
        for u in uids:
            _appel(acc, "PATCH", f"/me/messages/{quote(u, safe='')}", json={"isRead": op == "read"})
        return
    if op in ("star", "unstar"):
        for u in uids:
            _appel(acc, "PATCH", f"/me/messages/{quote(u, safe='')}", json={"flag": {"flagStatus": "flagged" if op == "star" else "notFlagged"}})
        return
    if op == "archive":
        vers = "archive"
    elif op == "junk":
        vers = "junkemail"
    elif op == "notjunk":
        vers = "inbox"
    elif op != "move":
        raise ValueError(LECTURE_SEULE + " (supprimer ou envoyer n'est jamais permis sur un compte pro)")
    if not vers:
        raise ValueError("Choisis le dossier de destination")
    for u in uids:
        _appel(acc, "POST", f"/me/messages/{quote(u, safe='')}/move", json={"destinationId": _dossier(vers)})


# --- Notifications des nouveaux mails ---------------------------------------------------------------

def nouveaux(acc, etat):
    """Nouveaux mails de la boîte de réception depuis le dernier passage ; met à jour etat[acc] et le nombre de non lus."""
    import mail
    inbox = _appel(acc, "GET", "/me/mailFolders/inbox?$select=unreadItemCount")
    mail._unread[acc["id"]] = int(inbox.get("unreadItemCount", 0))
    avant = (etat.get(acc["id"]) or {}).get("depuis")
    maintenant = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not avant:
        etat[acc["id"]] = {"depuis": maintenant}
        return []
    d = _appel(acc, "GET", "/me/mailFolders/inbox/messages", params={
        "$filter": f"receivedDateTime gt {avant}", "$orderby": "receivedDateTime desc", "$top": "20", "$select": CHAMPS})
    liste = [_resume(m) for m in d.get("value", [])]
    if liste:
        dernier = max(m["date"] for m in liste)
        etat[acc["id"]] = {"depuis": datetime.fromtimestamp(dernier + 1, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    return [m for m in liste if not m["seen"]]


# --- Rappels des rendez-vous du calendrier pro ------------------------------------------------------

_agenda_pro = {}  # compte -> (instant de lecture, événements des prochaines 24 h)


def rappels(sent, maintenant):
    """Rappel avant chaque rendez-vous du calendrier pro (celui réglé dans Outlook, sinon 15 min avant).
    Le calendrier est relu toutes les 5 minutes au plus ; `sent` mémorise les rappels déjà envoyés."""
    from datetime import timedelta

    import activity
    import extcal
    for acc in accounts.everyone():
        cal = acc.get("cal") or {}
        if not acc.get("pro") or cal.get("kind") != "graph":
            continue
        lu, evenements = _agenda_pro.get(acc["id"], (0, []))
        if time.time() - lu > 300:
            evenements = []
            for c in cal.get("calendars", []):
                if c.get("on", True):
                    try:
                        evenements += [dict(e, agenda=c["name"]) for e in extcal.graph_events(acc, c, maintenant - timedelta(hours=1),
                                                                                              maintenant + timedelta(days=1))]
                    except ValueError as e:
                        print("agenda pro", acc.get("label"), e, flush=True)
            _agenda_pro[acc["id"]] = (time.time(), evenements)
        for e in evenements:
            if e["allday"]:
                continue
            debut = datetime.fromisoformat(e["start"])
            avant = e["reminder"] if e.get("reminder") is not None else 15
            moment = debut - timedelta(minutes=avant)
            cle = f"pro|{acc['id']}|{e['ref']}|{e['start']}"
            if not (moment <= maintenant < moment + timedelta(minutes=10)) or cle in sent:
                continue
            sent[cle] = time.time()
            ou = f" · {e['location']}" if e.get("location") else ""
            activity.log(acc["owner"], "agenda", f"{e['title']} · à {debut.strftime('%Hh%M').replace('h00', 'h')}{ou}", "#/agenda",
                         title=f"Rendez-vous pro · {acc.get('label') or 'Outlook'}")
