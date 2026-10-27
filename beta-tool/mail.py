"""Outil « Mails » : lis et envoie tes mails (iCloud, Gmail, Outlook, Orange, Free…) depuis
Bêta Tool, par IMAP et SMTP. Les mails restent chez ton fournisseur : rien n'est copié sur le NAS,
sauf les pièces jointes que tu choisis d'y enregistrer (ou d'envoyer à Paperasse).

L'affichage des mails HTML est isolé (iframe sans script) et les images distantes, qui servent
souvent à pister l'ouverture des mails, sont bloquées tant que tu ne les autorises pas.
Les nouveaux mails de la boîte de réception déclenchent une notification push."""

import base64
import email
import email.header
import email.policy
import email.utils
import html
import imaplib
import os
import re
import smtplib
import ssl
import threading
import time
import uuid
from collections import OrderedDict
from email.message import EmailMessage

from flask import Blueprint, Response, g, jsonify, request

import accounts
import activity
import phishing
import store

bp = Blueprint("mail", __name__)
RECEIVE_DIR = os.environ.get("RECEIVE_DIR", "/depots")
WORK_DIR = os.environ.get("WORK_DIR", "/work")
PAGE = 50
POLL = int(os.environ.get("MAIL_POLL_SECONDS", "120"))
MAX_SEND = 25 * 1024 ** 2
SPECIAL = ["inbox", "drafts", "sent", "archive", "junk", "trash", "all", "flagged"]
GUESS = {  # dossiers sans attribut « special-use »
    "sent": ["sent", "sent messages", "sent items", "envoyés", "éléments envoyés", "messages envoyés", "inbox.sent"],
    "trash": ["trash", "deleted", "deleted messages", "deleted items", "corbeille", "éléments supprimés", "inbox.trash"],
    "junk": ["junk", "spam", "bulk mail", "courrier indésirable", "indésirables", "inbox.junk", "inbox.spam"],
    "drafts": ["drafts", "brouillons", "inbox.drafts"],
    "archive": ["archive", "archives", "éléments archivés", "archivés", "inbox.archive"],
}
NAMES = {"inbox": "Boîte de réception", "drafts": "Brouillons", "sent": "Envoyés", "archive": "Archives", "junk": "Indésirables",
         "trash": "Corbeille", "all": "Tous les messages", "flagged": "Suivis"}
_ctx = ssl.create_default_context()


# --- UTF-7 modifié (noms de dossiers IMAP, RFC 3501) ---------------------------------

def utf7_decode(s):
    def dec(m):
        b = m.group(1)
        if not b:
            return "&"
        b = b.replace(",", "/")
        return base64.b64decode(b + "=" * (-len(b) % 4)).decode("utf-16-be")
    return re.sub(r"&([A-Za-z0-9+,]*)-", dec, s)


def utf7_encode(s):
    out, buf = [], []

    def flush():
        if buf:
            out.append("&" + base64.b64encode("".join(buf).encode("utf-16-be")).decode().rstrip("=").replace("/", ",") + "-")
            buf.clear()
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7e:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            buf.append(ch)
    flush()
    return "".join(out)


def q(name):
    return '"' + utf7_encode(name).replace("\\", "\\\\").replace('"', '\\"') + '"'


# --- Connexions ------------------------------------------------------------------

def _connect(acc):
    m = acc["mail"]
    host, port, sec = m["imap_host"], int(m["imap_port"]), m["imap_sec"]
    try:
        if sec == "ssl":
            c = imaplib.IMAP4_SSL(host, port, ssl_context=_ctx, timeout=30)
        else:
            c = imaplib.IMAP4(host, port, timeout=30)
            if sec == "starttls":
                c.starttls(_ctx)
    except (OSError, imaplib.IMAP4.error) as e:
        raise ValueError(f"Impossible de joindre le serveur {host} ({e.__class__.__name__}) : vérifie l'adresse et le port") from None
    try:
        if m.get("auth") == "oauth":
            tok = accounts.token(acc, "ms_mail")
            c.authenticate("XOAUTH2", lambda _: f"user={m['username']}\x01auth=Bearer {tok}\x01\x01".encode())
        else:
            c.login(m["username"], accounts.secret(acc).get("password", ""))
    except imaplib.IMAP4.error as e:
        c.shutdown()
        msg = str(e)
        if acc["provider"] in ("icloud", "gmail", "yahoo"):
            raise ValueError("Connexion refusée : il faut un mot de passe d'application (pas ton mot de passe habituel)") from None
        if acc["provider"] == "microsoft":
            raise ValueError("Outlook a refusé la connexion : vérifie que l'accès IMAP est activé (Outlook.com → Paramètres → Courrier → Transférer et IMAP)") from None
        raise ValueError(f"Identifiant ou mot de passe refusé ({msg[:80]})") from None
    try:  # les capacités changent souvent après la connexion (MOVE, UIDPLUS…)
        typ, dat = c.capability()
        c._bt_caps = set(dat[0].decode().upper().split()) if typ == "OK" else None
    except imaplib.IMAP4.error:
        c._bt_caps = None
    return c


class _Pool:
    """Une connexion IMAP gardée ouverte par compte (2 minutes sans activité)."""

    def __init__(self):
        self.items = {}
        self.lock = threading.Lock()

    def get(self, acc):
        with self.lock:
            slot = self.items.setdefault(acc["id"], {"lock": threading.Lock(), "conn": None, "used": 0})
        return slot

    def prune(self):
        with self.lock:
            for slot in self.items.values():
                if slot["conn"] and time.time() - slot["used"] > 120 and slot["lock"].acquire(blocking=False):
                    try:
                        slot["conn"].logout()
                    except Exception:  # noqa: BLE001
                        pass
                    slot["conn"] = None
                    slot["lock"].release()

    def drop(self, acc_id):
        with self.lock:
            slot = self.items.pop(acc_id, None)
        if slot and slot["conn"]:
            try:
                slot["conn"].logout()
            except Exception:  # noqa: BLE001
                pass


_pool = _Pool()


class session:
    """with session(acc) as c: … — connexion du pool, rouverte si elle a été coupée."""

    def __init__(self, acc):
        self.acc, self.slot = acc, _pool.get(acc)

    def __enter__(self):
        self.slot["lock"].acquire()
        c = self.slot["conn"]
        if c is not None and time.time() - self.slot["used"] > 20:
            try:
                c.noop()
            except Exception:  # noqa: BLE001
                c = None
        if c is None:
            try:
                c = _connect(self.acc)
            except Exception:
                self.slot["lock"].release()
                raise
        self.slot["conn"] = c
        return c

    def __exit__(self, exc_type, exc, tb):
        if exc_type and issubclass(exc_type, (imaplib.IMAP4.abort, OSError)):
            self.slot["conn"] = None
        self.slot["used"] = time.time()
        self.slot["lock"].release()
        if exc_type and issubclass(exc_type, imaplib.IMAP4.error) and not issubclass(exc_type, imaplib.IMAP4.abort):
            raise ValueError(f"Le serveur a refusé l'opération : {exc}") from None
        if exc_type and issubclass(exc_type, (imaplib.IMAP4.abort, OSError)):
            raise ValueError("La connexion au serveur mail a été coupée : réessaie") from None
        return False


def caps(c):
    return getattr(c, "_bt_caps", None) or {(x if isinstance(x, str) else x.decode()).upper() for x in c.capabilities}


def test(acc):
    c = _connect(acc)
    try:
        c.logout()
    except Exception:  # noqa: BLE001
        pass


def account(acc_id):
    acc = accounts.get(g.user["name"], acc_id)
    if not acc.get("mail"):
        raise ValueError("Ce compte n'a pas de boîte mail")
    return acc


def _ok(typ, data, what="opération"):
    if typ != "OK":
        raise ValueError(f"Le serveur a refusé l'{what} : {(data[0] or b'').decode(errors='replace')[:120] if data else ''}")
    return data


# --- Dossiers ----------------------------------------------------------------------

LIST_RE = re.compile(r'\((?P<flags>[^)]*)\) (?:"(?P<sep>[^"]*)"|NIL) (?P<name>.+)$')


def folders(acc, c):
    _, data = c.list()
    out = []
    for raw in data:
        if not raw:
            continue
        if isinstance(raw, tuple):  # nom envoyé en littéral
            line = raw[0].decode(errors="replace").rsplit("{", 1)[0] + '"' + raw[1].decode(errors="replace") + '"'
        else:
            line = raw.decode(errors="replace")
        m = LIST_RE.match(line)
        if not m:
            continue
        flags = m["flags"].lower().split()
        name = m["name"].strip()
        if name.startswith('"'):
            name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        if "\\noselect" in flags or "\\nonexistent" in flags:
            continue
        real = utf7_decode(name)
        role = next((r for r in SPECIAL if "\\" + r in flags), None)
        if real.upper() == "INBOX":
            role = "inbox"
        out.append({"name": real, "sep": m["sep"] or "/", "role": role})
    for role, names in GUESS.items():
        if not any(f["role"] == role for f in out):
            hit = next((f for f in out if f["role"] is None and f["name"].lower().split(f["sep"])[-1] in names), None) or \
                next((f for f in out if f["role"] is None and f["name"].lower() in names), None)
            if hit:
                hit["role"] = role
    for f in out:
        short = f["name"].split(f["sep"])[-1] if f["sep"] else f["name"]
        f["label"] = NAMES.get(f["role"]) or short
        f["depth"] = 0 if f["role"] or f["name"].startswith("[Gmail]") else f["name"].count(f["sep"]) if f["sep"] else 0
    out.sort(key=lambda f: (SPECIAL.index(f["role"]) if f["role"] else 99, f["name"].lower()))
    return out


def role_folder(acc, c, role):
    return next((f["name"] for f in folders(acc, c) if f["role"] == role), None)


def select(c, folder, readonly=True):
    typ, data = c.select(q(folder), readonly=readonly)
    if typ != "OK":
        raise ValueError("Dossier introuvable")
    return int(data[0] or 0)


# --- Lecture -------------------------------------------------------------------------

def dec(value):
    if not value:
        return ""
    try:
        return str(email.header.make_header(email.header.decode_header(value)))
    except Exception:  # noqa: BLE001
        return str(value)


def addr_list(value):
    return [{"name": dec(n), "email": a} for n, a in email.utils.getaddresses([value or ""]) if a or n]


def _fetch_parts(data):
    """Regroupe la réponse de UID FETCH : [(meta, en-têtes)]."""
    out, cur = [], None
    for item in data:
        if isinstance(item, tuple):
            if cur:
                out.append(cur)
            cur = [item[0].decode(errors="replace"), item[1]]
        elif item and cur:
            cur[0] += item.decode(errors="replace")
    if cur:
        out.append(cur)
    return out


# --- Faux mails (voir phishing.py) ------------------------------------------------------

def trust_lists(user):
    """(expéditeurs de confiance, expéditeurs signalés comme faux) : contacts, choix de l'utilisateur, ses propres adresses."""
    d = store.load("mail/expediteurs", {}).get(user, {})
    trusted = set(d.get("fiables", [])) | {a.get("email", "").lower() for a in accounts.of(user) if a.get("email")}
    try:
        import contacts
        trusted |= contacts.emails(user)
    except Exception:  # noqa: BLE001
        pass
    return trusted, set(d.get("faux", []))


def verdicts(acc_id):
    return store.load("mail/verdicts", {}).get(acc_id, {})


def remember(acc_id, msgid, v):
    if not msgid:
        return

    def go(d):
        box = d.setdefault(acc_id, {})
        box[msgid] = {"level": v["level"], "score": v["score"], "reasons": v["reasons"], "at": time.time()}
        if len(box) > 3000:  # garde les plus récents
            for k in sorted(box, key=lambda k: box[k]["at"])[:1000]:
                box.pop(k)
    store.update("mail/verdicts", {}, go)


def judge(msg, trusted=(), blocked=()):
    """Analyse complète d'un mail (en-têtes, texte, liens, pièces jointes)."""
    auth = (msg.get_all("Authentication-Results") or [""])[0]
    html_part = msg.get_body(preferencelist=("html",))
    text_part = msg.get_body(preferencelist=("plain",))
    get = lambda p: p.get_content() if p is not None else ""
    try:
        html_body = get(html_part)
    except (LookupError, KeyError):
        html_body = ""
    try:
        text_body = get(text_part)
    except (LookupError, KeyError):
        text_body = ""
    atts = [dec(p.get_filename()) for p in msg.walk() if not p.is_multipart() and p.get_filename()]
    return phishing.analyze(str(msg["From"] or ""), dec(msg["Subject"]), text_body[:20000], html_body[:200000],
                            str(msg["Reply-To"] or ""), str(auth), atts, trusted, blocked)


def summaries(c, uids, acc=None):
    if not uids:
        return []
    typ, data = c.uid("FETCH", ",".join(uids), "(UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE CONTENT-TYPE "
                                               "REPLY-TO MESSAGE-ID AUTHENTICATION-RESULTS)])")
    _ok(typ, data, "lecture")
    out = {}
    trusted, blocked = trust_lists(acc["owner"]) if acc else ((), ())
    known = verdicts(acc["id"]) if acc else {}
    for meta, head in _fetch_parts(data):
        uid = re.search(r"UID (\d+)", meta)
        if not uid:
            continue
        flags = (re.search(r"FLAGS \(([^)]*)\)", meta) or [None, ""])[1]
        size = re.search(r"RFC822\.SIZE (\d+)", meta)
        h = email.message_from_bytes(head, policy=email.policy.compat32)
        try:
            ts = email.utils.parsedate_to_datetime(h["Date"]).timestamp() if h["Date"] else 0
        except (TypeError, ValueError):
            ts = 0
        ctype = (h.get("Content-Type") or "").lower()
        out[uid[1]] = {"uid": uid[1], "from": addr_list(h["From"])[:1], "to": addr_list(h["To"]), "subject": dec(h["Subject"]) or "(sans objet)",
                       "date": ts, "seen": "\\Seen" in flags, "flagged": "\\Flagged" in flags, "answered": "\\Answered" in flags,
                       "size": int(size[1]) if size else 0, "attach": "multipart/mixed" in ctype or "multipart/report" in ctype}
        v = known.get((h["Message-ID"] or "").strip())  # verdict complet déjà calculé, sinon analyse des seuls en-têtes
        if not v or phishing.parseaddr(dec(h["From"]))[1].lower() in trusted:
            v = phishing.analyze(dec(h["From"]), dec(h["Subject"]), reply_to=h["Reply-To"] or "",
                                 auth=(h.get_all("Authentication-Results") or [""])[0], trusted=trusted, blocked=blocked)
        if v["level"] != "ok":
            out[uid[1]]["security"] = {"level": v["level"], "reasons": v["reasons"]}
    return [out[u] for u in uids if u in out]


def search_uids(c, query, unread=False):
    crit = ["UNSEEN"] if unread else []
    if "SORT" in caps(c):  # tri par date d'arrivée côté serveur (Dovecot, iCloud…)
        if query:
            c.literal = query.encode()
            crit += ["X-GM-RAW" if "X-GM-EXT-1" in caps(c) else "TEXT"]
        typ, data = c.uid("SORT", "(REVERSE ARRIVAL)", "UTF-8", *(crit or ["ALL"]))
        _ok(typ, data, "recherche")
        return data[0].split() if data and data[0] else []
    if query:
        c.literal = query.encode()
        typ, data = c.uid("SEARCH", "CHARSET", "UTF-8", *crit, "X-GM-RAW" if "X-GM-EXT-1" in caps(c) else "TEXT")
    else:
        typ, data = c.uid("SEARCH", *(crit or ["ALL"]))
    _ok(typ, data, "recherche")
    return sorted(data[0].split(), key=int, reverse=True) if data and data[0] else []


_raw_cache = OrderedDict()  # derniers mails ouverts (pièces jointes, réponses)


def raw_message(acc, c, folder, uid):
    key = (acc["id"], folder, uid)
    if key in _raw_cache:
        _raw_cache.move_to_end(key)
        return _raw_cache[key]
    typ, data = c.uid("FETCH", uid, "(BODY.PEEK[])")
    parts = _fetch_parts(data) if typ == "OK" else []
    if not parts:
        raise ValueError("Mail introuvable (déplacé ou supprimé ?)")
    raw = parts[0][1]
    _raw_cache[key] = raw
    while sum(len(v) for v in _raw_cache.values()) > 80 * 1024 ** 2 or len(_raw_cache) > 20:
        _raw_cache.popitem(last=False)
    return raw


def walk_parts(msg):
    """Pièces jointes numérotées dans l'ordre de parcours (le numéro sert à les télécharger)."""
    out = []
    for i, part in enumerate(msg.walk()):
        if part.is_multipart():
            continue
        disp = part.get_content_disposition()
        name = part.get_filename()
        ctype = part.get_content_type()
        if disp == "attachment" or (name and not (disp == "inline" and ctype.startswith("image/") and part.get("Content-ID"))) or ctype == "message/rfc822":
            payload = part.get_payload(decode=True) or b""
            out.append({"n": i, "name": dec(name) if name else ("message.eml" if ctype == "message/rfc822" else f"piece-jointe-{i}"),
                        "type": ctype, "size": len(payload)})
    return out


def part_by_index(msg, n):
    for i, part in enumerate(msg.walk()):
        if i == n and not part.is_multipart():
            return part
    raise ValueError("Pièce jointe introuvable")


DANGER = re.compile(r"<(script|iframe|object|embed|form|base|meta|link|frame|frameset|applet)\b[^>]*>(.*?</\1\s*>)?", re.I | re.S)
ON_ATTR = re.compile(r"\s(on[a-z]+)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
JS_URL = re.compile(r"(href|src|action)\s*=\s*([\"']?)\s*(javascript|vbscript|data:text/html)[^\"'\s>]*\2", re.I)
REMOTE = re.compile(r"""(?:src|background)\s*=\s*["']?\s*https?://|url\(\s*["']?https?://""", re.I)


def clean_html(body):
    """Nettoyage de base ; la vraie protection est l'iframe isolée (sandbox + CSP) côté navigateur."""
    body = DANGER.sub("", body)
    body = ON_ATTR.sub("", body)
    return JS_URL.sub(r'\1="#"', body)


def text_to_html(text):
    t = html.escape(text.replace("\r\n", "\n").replace("\r", "\n"))
    t = re.sub(r"(https?://[^\s<>&\"]+)", r'<a href="\1">\1</a>', t)
    lines, out, depth = t.split("\n"), [], 0
    for line in lines:  # citations « > » en blocs
        d = len(re.match(r"^((?:&gt; ?)*)", line)[1].replace(" ", "")) // 4
        while depth < d:
            out.append("<blockquote>")
            depth += 1
        while depth > d:
            out.append("</blockquote>")
            depth -= 1
        out.append(re.sub(r"^(?:&gt; ?)+", "", line) + "<br>")
    out += ["</blockquote>"] * depth
    return f'<div style="white-space:pre-wrap;font-family:inherit">{"".join(out)}</div>'


def body_of(msg):
    html_part = msg.get_body(preferencelist=("html",))
    text_part = msg.get_body(preferencelist=("plain",))
    text = ""
    if text_part is not None:
        try:
            text = text_part.get_content()
        except (LookupError, KeyError):
            text = (text_part.get_payload(decode=True) or b"").decode("latin-1")
    if html_part is not None:
        try:
            body = html_part.get_content()
        except (LookupError, KeyError):
            body = (html_part.get_payload(decode=True) or b"").decode("latin-1")
        body = clean_html(body)
        cids = {}
        for part in msg.walk():  # images intégrées (cid:) en data: URI
            cid = (part.get("Content-ID") or "").strip("<> ")
            if cid and part.get_content_maintype() == "image":
                data = part.get_payload(decode=True) or b""
                if len(data) < 3 * 1024 ** 2:
                    cids[cid] = f"data:{part.get_content_type()};base64,{base64.b64encode(data).decode()}"
        body = re.sub(r"cid:([^\"'\s)>]+)", lambda m: cids.get(m[1], "data:,"), body)
        return body, text, bool(REMOTE.search(body))
    return text_to_html(text), text, False


def read(acc, c, folder, uid):
    raw = raw_message(acc, c, folder, uid)
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    body, text, remote = body_of(msg)
    trusted, blocked = trust_lists(acc["owner"])
    v = judge(msg, trusted, blocked)
    remember(acc["id"], (msg["Message-ID"] or "").strip(), v)
    if v["level"] == "phishing":  # liens désactivés : on ne clique pas par erreur dans un faux mail
        body = re.sub(r"(<a\b[^>]*?)\shref\s*=\s*([\"']).*?\2", r"\1", body, flags=re.I | re.S)
    try:
        ts = email.utils.parsedate_to_datetime(msg["Date"]).timestamp() if msg["Date"] else 0
    except (TypeError, ValueError):
        ts = 0
    return {"uid": uid, "folder": folder, "subject": dec(msg["Subject"]) or "(sans objet)", "from": addr_list(msg["From"]),
            "to": addr_list(msg["To"]), "cc": addr_list(msg["Cc"]), "reply_to": addr_list(msg["Reply-To"]), "date": ts,
            "message_id": msg["Message-ID"] or "", "references": msg["References"] or "", "html": body, "text": text[:200000],
            "remote_images": remote, "attachments": walk_parts(msg),
            "unsubscribe": bool(msg["List-Unsubscribe"]),
            "security": {"level": v["level"], "reasons": v["reasons"], "score": v["score"], "trusted": bool(v.get("trusted"))}}


# --- Envoi -----------------------------------------------------------------------------

def smtp_send(acc, msg):
    m = acc["mail"]
    host, port, sec = m["smtp_host"], int(m["smtp_port"]), m["smtp_sec"]
    try:
        s = smtplib.SMTP_SSL(host, port, context=_ctx, timeout=60) if sec == "ssl" else smtplib.SMTP(host, port, timeout=60)
        if sec == "starttls":
            s.starttls(context=_ctx)
    except OSError as e:
        raise ValueError(f"Impossible de joindre le serveur d'envoi {host} ({e.__class__.__name__})") from None
    try:
        if m.get("auth") == "oauth":
            tok = accounts.token(acc, "ms_mail")
            s.ehlo()
            s.auth("XOAUTH2", lambda challenge=None: f"user={m['username']}\x01auth=Bearer {tok}\x01\x01", initial_response_ok=True)
        elif sec != "none" or s.has_extn("auth"):
            s.login(m["username"], accounts.secret(acc).get("password", ""))
        s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise ValueError("Le serveur d'envoi a refusé l'identifiant ou le mot de passe") from None
    except smtplib.SMTPRecipientsRefused as e:
        raise ValueError("Adresse refusée : " + ", ".join(e.recipients)) from None
    except smtplib.SMTPException as e:
        raise ValueError(f"Envoi refusé par le serveur : {e}") from None
    finally:
        try:
            s.quit()
        except Exception:  # noqa: BLE001
            pass


def build(acc, d, files, original=None):
    m = acc["mail"]
    msg = EmailMessage()
    me = m.get("username") if "@" in m.get("username", "") else acc.get("email")
    msg["From"] = email.utils.formataddr((m.get("name") or "", acc.get("email") or me))
    for k in ("to", "cc"):
        if d.get(k):
            msg[k.capitalize()] = d[k]
    if not (d.get("to") or d.get("cc") or d.get("bcc")):
        raise ValueError("Indique au moins un destinataire")
    for a in email.utils.getaddresses([d.get("to", ""), d.get("cc", ""), d.get("bcc", "")]):
        if a[1] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", a[1]):
            raise ValueError(f"Adresse invalide : {a[1]}")
    msg["Subject"] = d.get("subject", "")
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid(domain=(acc.get("email") or "beta-tool.local").split("@")[-1])
    if original is not None and d.get("mode") in ("reply", "replyall"):
        msg["In-Reply-To"] = original["Message-ID"] or ""
        msg["References"] = ((original["References"] or "") + " " + (original["Message-ID"] or "")).strip()
    text = d.get("text", "")
    if m.get("signature") and d.get("signature", "1") != "0":
        text += "\n\n-- \n" + m["signature"]
    quote_text = ""
    if original is not None and d.get("mode"):
        ob = original.get_body(preferencelist=("plain", "html"))
        try:
            otext = ob.get_content() if ob is not None else ""
        except (LookupError, KeyError):
            otext = ""
        if ob is not None and ob.get_content_type() == "text/html":
            otext = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<(br|/p|/div)[^>]*>", "\n", otext, flags=re.I)))
        try:
            when = email.utils.parsedate_to_datetime(original["Date"]).astimezone().strftime("%d/%m/%Y à %H:%M")
        except (TypeError, ValueError):
            when = original["Date"] or ""
        who = dec(original["From"])
        if d["mode"] == "forward":
            quote_text = f"\n\n---------- Message transféré ----------\nDe : {who}\nDate : {when}\nObjet : {dec(original['Subject'])}\nÀ : {dec(original['To'])}\n\n{otext}"
        else:
            quote_text = f"\n\nLe {when}, {who} a écrit :\n" + "\n".join("> " + l for l in otext.strip().splitlines())
    full = text + quote_text
    msg.set_content(full)
    msg.add_alternative(f"<!doctype html><html><body>{text_to_html(full)}</body></html>", subtype="html")
    total = 0
    for f in files:
        data = f.read()
        total += len(data)
        if total > MAX_SEND:
            raise ValueError("Pièces jointes trop lourdes (25 Mo max.) : partage-les plutôt avec Bêta Drop")
        maintype, _, subtype = (f.mimetype or "application/octet-stream").partition("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype or "octet-stream", filename=f.filename)
    if original is not None and d.get("mode") == "forward" and d.get("keep_attachments", "1") == "1":
        for part in original.walk():
            if not part.is_multipart() and (part.get_content_disposition() == "attachment" or part.get_filename()):
                data = part.get_payload(decode=True) or b""
                total += len(data)
                if total > MAX_SEND:
                    raise ValueError("Pièces jointes trop lourdes (25 Mo max.)")
                mt, _, st = part.get_content_type().partition("/")
                msg.add_attachment(data, maintype=mt, subtype=st, filename=part.get_filename() or "piece-jointe")
    bcc = d.get("bcc", "")
    return msg, bcc


# --- Notifications des nouveaux mails --------------------------------------------------

_unread = {}  # compte → mails non lus dans la boîte de réception (pour le tableau de bord)


def screen(acc, c, uids):
    """Analyse les nouveaux mails de la boîte de réception ; range les faux dans Indésirables. Renvoie les uid déplacés."""
    if not uids:
        return set()
    trusted, blocked = trust_lists(acc["owner"])
    typ, data = c.uid("FETCH", ",".join(uids), "(UID BODY.PEEK[]<0.400000>)")  # les premiers 400 Ko suffisent
    fakes = set()
    for meta, raw in _fetch_parts(data) if typ == "OK" else []:
        uid = re.search(r"UID (\d+)", meta)
        if not uid:
            continue
        msg = email.message_from_bytes(raw, policy=email.policy.default)
        try:
            v = judge(msg, trusted, blocked)
        except Exception:  # noqa: BLE001  mail tronqué ou mal formé
            continue
        remember(acc["id"], (msg["Message-ID"] or "").strip(), v)
        if v["level"] == "phishing":
            fakes.add(uid[1])
    if not fakes or acc["mail"].get("filter") is False:
        return set()
    junk = role_folder(acc, c, "junk")
    if not junk:
        return set()
    select(c, "INBOX", readonly=False)
    ids = ",".join(sorted(fakes, key=int))
    if "MOVE" in caps(c):
        typ, _ = c.uid("MOVE", ids, q(junk))
    else:
        typ, _ = c.uid("COPY", ids, q(junk))
        if typ == "OK":
            c.uid("STORE", ids, "+FLAGS", "(\\Deleted)")
            c.uid("EXPUNGE", ids) if "UIDPLUS" in caps(c) else c.expunge()
    select(c, "INBOX")
    return fakes if typ == "OK" else set()


def poll_once(state):
    for acc in accounts.everyone():
        if not acc.get("mail"):
            continue
        try:
            with session(acc) as c:
                typ, data = c.status("INBOX", "(UIDNEXT UNSEEN UIDVALIDITY)")
                if typ != "OK":
                    continue
                st = dict(re.findall(r"(UIDNEXT|UNSEEN|UIDVALIDITY) (\d+)", data[0].decode()))
                _unread[acc["id"]] = int(st.get("UNSEEN", 0))
                nxt, val = int(st.get("UIDNEXT", 0)), st.get("UIDVALIDITY")
                prev = state.get(acc["id"])
                state[acc["id"]] = {"next": nxt, "validity": val}
                if not prev or prev.get("validity") != val or nxt <= prev["next"]:
                    continue
                select(c, "INBOX")
                typ, data = c.uid("SEARCH", f"UID {prev['next']}:* UNSEEN")
                uids = [u.decode() for u in (data[0].split() if typ == "OK" and data[0] else []) if int(u) >= prev["next"]][-20:]
                moved = screen(acc, c, uids)
                news = [n for n in summaries(c, [u for u in uids if u not in moved], acc)]
            if moved:
                _unread[acc["id"]] = max(0, _unread.get(acc["id"], 0) - len(moved))
            if not news or not acc["mail"].get("notify", True):
                continue
            link = f"#/mails/{acc['id']}"
            if len(news) > 3:
                activity.log(acc["owner"], "mails", f"{len(news)} nouveaux mails · {acc['label']}", link, title=f"Mails · {acc['label']}")
                continue
            for n in news:
                who = (n["from"][0]["name"] or n["from"][0]["email"]) if n["from"] else "?"
                sus = n.get("security", {}).get("level") == "suspect"
                activity.log(acc["owner"], "mails", f"{'⚠️ ' if sus else ''}{who} : {n['subject']}", f"{link}?uid={n['uid']}",
                             title=f"{'Mail suspect' if sus else 'Nouveau mail'} · {acc['label']}")
        except Exception as e:  # noqa: BLE001
            print("mails", acc.get("label"), e, flush=True)


def poller():
    state = store.load("mail/etat", {})
    while True:
        time.sleep(POLL)
        try:
            before = dict(state)
            poll_once(state)
            if state != before:
                store.save("mail/etat", state)
            _pool.prune()
        except Exception as e:  # noqa: BLE001
            print("mails", e, flush=True)


def start():
    threading.Thread(target=poller, daemon=True).start()


def count(user):
    ids = [a["id"] for a in accounts.of(user) if a.get("mail")]
    return sum(_unread.get(i, 0) for i in ids) if ids else None


# --- Routes ------------------------------------------------------------------------------

@bp.get("/api/mail")
def overview():
    accs = [accounts.public(a) for a in accounts.of(g.user["name"]) if a.get("mail")]
    for a in accs:
        a["unread"] = _unread.get(a["id"])
    return jsonify(accounts=accs)


@bp.get("/api/mail/<acc_id>/folders")
def folders_route(acc_id):
    acc = account(acc_id)
    with session(acc) as c:
        fl = folders(acc, c)
        for f in fl[:40]:
            if f["role"] in ("inbox", "drafts") or not f["role"]:  # pas de pastille sur Indésirables ni Corbeille
                typ, data = c.status(q(f["name"]), "(UNSEEN)")
                if typ == "OK":
                    m = re.search(rb"UNSEEN (\d+)", data[0])
                    f["unread"] = int(m[1]) if m else 0
    inbox = next((f for f in fl if f["role"] == "inbox"), None)
    if inbox:
        _unread[acc["id"]] = inbox.get("unread", 0)
    return jsonify(folders=fl)


@bp.get("/api/mail/<acc_id>/messages")
def messages(acc_id):
    acc = account(acc_id)
    folder = request.args.get("folder") or "INBOX"
    page = max(0, int(request.args.get("page", 0) or 0))
    query = (request.args.get("q") or "").strip()[:200]
    with session(acc) as c:
        total = select(c, folder)
        uids = search_uids(c, query, request.args.get("unread") == "1") if total else []
        chunk = [u.decode() for u in uids[page * PAGE:(page + 1) * PAGE]]
        items = summaries(c, chunk, acc)
    return jsonify(messages=items, total=len(uids), page=page, more=len(uids) > (page + 1) * PAGE)


@bp.get("/api/mail/<acc_id>/message")
def message(acc_id):
    acc = account(acc_id)
    folder, uid = request.args.get("folder") or "INBOX", str(int(request.args["uid"]))
    with session(acc) as c:
        select(c, folder)
        out = read(acc, c, folder, uid)
        if request.args.get("peek") != "1":
            select(c, folder, readonly=False)
            c.uid("STORE", uid, "+FLAGS", "(\\Seen)")
    return jsonify(out)


@bp.get("/api/mail/<acc_id>/part")
def part(acc_id):
    acc = account(acc_id)
    folder, uid, n = request.args.get("folder") or "INBOX", str(int(request.args["uid"])), int(request.args["n"])
    with session(acc) as c:
        select(c, folder)
        msg = email.message_from_bytes(raw_message(acc, c, folder, uid), policy=email.policy.default)
    p = part_by_index(msg, n)
    data = p.get_payload(decode=True) if p.get_content_type() != "message/rfc822" else p.get_payload(0).as_bytes()
    name = dec(p.get_filename()) or ("message.eml" if p.get_content_type() == "message/rfc822" else "piece-jointe")
    from urllib.parse import quote
    inline = request.args.get("inline") == "1" and p.get_content_type() in ("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain")
    return Response(data or b"", mimetype=p.get_content_type() if inline else "application/octet-stream", headers={
        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(name)}",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff"})


@bp.post("/api/mail/<acc_id>/part/save")
def save_part(acc_id):
    acc = account(acc_id)
    d = request.get_json(silent=True) or {}
    folder, uid, n = d.get("folder") or "INBOX", str(int(d["uid"])), int(d["n"])
    with session(acc) as c:
        select(c, folder)
        msg = email.message_from_bytes(raw_message(acc, c, folder, uid), policy=email.policy.default)
    p = part_by_index(msg, n)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", dec(p.get_filename()) or "piece-jointe").strip(". ") or "piece-jointe"
    data = p.get_payload(decode=True) or b""
    if d.get("dest") == "paperasse":
        import paperasse
        import settings
        if not settings.enabled("paperasse"):
            raise ValueError("Paperasse est désactivé")
        tmp_dir = os.path.join(WORK_DIR, "paperasse-entrants")
        os.makedirs(tmp_dir, exist_ok=True)
        tmp = os.path.join(tmp_dir, uuid.uuid4().hex[:8] + os.path.splitext(name)[1].lower())
        with open(tmp, "wb") as f:
            f.write(data)
        paperasse.enqueue(tmp, name, g.user["name"], source="mail")
        return jsonify(ok=True, where="Paperasse")
    dest = os.path.join(RECEIVE_DIR, "Pièces jointes")
    os.makedirs(dest, exist_ok=True)
    base, ext = os.path.splitext(name)
    target, i = os.path.join(dest, name), 2
    while os.path.exists(target):
        target, i = os.path.join(dest, f"{base} ({i}){ext}"), i + 1
    with open(target, "wb") as f:
        f.write(data)
    return jsonify(ok=True, where="Fichiers reçus / Pièces jointes", name=os.path.basename(target))


@bp.post("/api/mail/<acc_id>/action")
def action(acc_id):
    acc = account(acc_id)
    d = request.get_json(silent=True) or {}
    folder, op = d.get("folder") or "INBOX", d.get("op")
    uids = ",".join(str(int(u)) for u in d.get("uids") or [])
    if not uids:
        raise ValueError("Aucun mail sélectionné")
    flags = {"read": ("+FLAGS", "\\Seen"), "unread": ("-FLAGS", "\\Seen"), "star": ("+FLAGS", "\\Flagged"), "unstar": ("-FLAGS", "\\Flagged")}
    with session(acc) as c:
        if op in flags:
            select(c, folder, readonly=False)
            _ok(*c.uid("STORE", uids, flags[op][0], f"({flags[op][1]})"))
            return jsonify(ok=True)
        fl = folders(acc, c)
        by_role = {f["role"]: f["name"] for f in fl if f["role"]}
        if op == "move":
            dest = d.get("to")
            if dest not in [f["name"] for f in fl]:
                raise ValueError("Dossier de destination introuvable")
        elif op in ("trash", "archive", "junk", "notjunk"):
            dest = by_role.get({"notjunk": "inbox"}.get(op, op))
            if op == "archive" and not dest and acc["provider"] == "gmail":
                dest = None  # Gmail : archiver = retirer de la boîte de réception
            elif not dest:
                if op == "archive":
                    c.create(q("Archives"))
                    dest = "Archives"
                else:
                    raise ValueError({"trash": "Pas de corbeille sur ce compte", "junk": "Pas de dossier Indésirables sur ce compte"}.get(op, "Dossier introuvable"))
            if op == "trash" and folder == dest:
                op = "delete"
        elif op != "delete":
            raise ValueError("Action inconnue")
        select(c, folder, readonly=False)
        if op == "delete" or (op == "archive" and dest is None):
            _ok(*c.uid("STORE", uids, "+FLAGS", "(\\Deleted)"))
            if "UIDPLUS" in caps(c):
                c.uid("EXPUNGE", uids)
            else:
                c.expunge()
            return jsonify(ok=True)
        if "MOVE" in caps(c):
            _ok(*c.uid("MOVE", uids, q(dest)), "déplacement")
        else:
            _ok(*c.uid("COPY", uids, q(dest)), "déplacement")
            c.uid("STORE", uids, "+FLAGS", "(\\Deleted)")
            if "UIDPLUS" in caps(c):
                c.uid("EXPUNGE", uids)
            else:
                c.expunge()
    return jsonify(ok=True)


@bp.post("/api/mail/<acc_id>/verdict")
def verdict(acc_id):
    """« Ce mail est fiable » (l'expéditeur ne sera plus signalé) ou « C'est un faux mail » (Indésirables, et les suivants aussi)."""
    acc = account(acc_id)
    d = request.get_json(silent=True) or {}
    folder, uid, choice = d.get("folder") or "INBOX", str(int(d["uid"])), d.get("verdict")
    if choice not in ("fiable", "faux"):
        raise ValueError("Choix inconnu")
    with session(acc) as c:
        select(c, folder)
        msg = email.message_from_bytes(raw_message(acc, c, folder, uid), policy=email.policy.default)
        sender = phishing.parseaddr(str(msg["From"] or ""))[1].lower()
        fl = folders(acc, c)
        roles = {f["role"]: f["name"] for f in fl if f["role"]}
        dest = roles.get("junk") if choice == "faux" else (roles.get("inbox") if folder == roles.get("junk") else None)
        if dest and dest != folder:
            select(c, folder, readonly=False)
            if "MOVE" in caps(c):
                _ok(*c.uid("MOVE", uid, q(dest)), "déplacement")
            else:
                _ok(*c.uid("COPY", uid, q(dest)), "déplacement")
                c.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
                c.uid("EXPUNGE", uid) if "UIDPLUS" in caps(c) else c.expunge()
    if sender:
        def go(data):
            lists = data.setdefault(acc["owner"], {"fiables": [], "faux": []})
            keep, drop = ("fiables", "faux") if choice == "fiable" else ("faux", "fiables")
            lists.setdefault(keep, [])
            lists.setdefault(drop, [])
            if sender not in lists[keep]:
                lists[keep].append(sender)
            lists[drop] = [x for x in lists[drop] if x != sender]
        store.update("mail/expediteurs", {}, go)
    msgid = (msg["Message-ID"] or "").strip()
    if msgid:
        store.update("mail/verdicts", {}, lambda data: data.get(acc_id, {}).pop(msgid, None))
    return jsonify(ok=True, moved=bool(dest and dest != folder), sender=sender)


@bp.post("/api/mail/<acc_id>/folders")
def create_folder(acc_id):
    acc = account(acc_id)
    name = str((request.get_json(silent=True) or {}).get("name") or "").strip()[:80]
    if not name:
        raise ValueError("Donne un nom au dossier")
    with session(acc) as c:
        _ok(*c.create(q(name)), "création du dossier")
        c.subscribe(q(name))
    return jsonify(ok=True)


def send_message(acc, d, files=()):
    """Envoie un mail (d : to, cc, bcc, subject, text, et pour une réponse mode / ref_uid / ref_folder).
    Renvoie un avertissement si le mail est parti sans être rangé dans « Envoyés »."""
    original = None
    if d.get("ref_uid") and d.get("mode"):
        with session(acc) as c:
            select(c, d.get("ref_folder") or "INBOX")
            original = email.message_from_bytes(raw_message(acc, c, d.get("ref_folder") or "INBOX", str(int(d["ref_uid"]))), policy=email.policy.default)
    msg, bcc = build(acc, d, files, original)
    if bcc:
        msg["Bcc"] = bcc
    smtp_send(acc, msg)
    del msg["Bcc"]  # pas de copie cachée visible dans « Envoyés »
    try:
        with session(acc) as c:
            if not acc["mail"].get("auto_sent"):
                sent = role_folder(acc, c, "sent")
                if sent:
                    c.append(q(sent), "(\\Seen)", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
            if original is not None and d.get("mode") in ("reply", "replyall"):
                select(c, d.get("ref_folder") or "INBOX", readonly=False)
                c.uid("STORE", str(int(d["ref_uid"])), "+FLAGS", "(\\Answered)")
    except Exception:  # noqa: BLE001
        return "Mail envoyé, mais pas rangé dans « Envoyés »"
    return None


@bp.post("/api/mail/<acc_id>/send")
def send(acc_id):
    warn = send_message(account(acc_id), request.form.to_dict(), request.files.getlist("files"))
    return jsonify(ok=True, warning=warn)

