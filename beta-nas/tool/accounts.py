"""Comptes en ligne : boîtes mail (IMAP/SMTP) et agendas externes (iCloud, Google, Outlook,
CalDAV, liens .ics) raccordés par chaque membre de la maison.

Les mots de passe et jetons sont chiffrés (AES-GCM) avec une clé gardée dans DATA_DIR.
Connexions :
  - iCloud, Gmail, Yahoo… : adresse + mot de passe d'application (IMAP/SMTP, CalDAV iCloud) ;
  - Outlook / Hotmail / Microsoft 365 : connexion Microsoft (code à saisir sur microsoft.com/devicelogin),
    avec l'identifiant d'application enregistré par l'administrateur (Réglages → Comptes en ligne) ;
  - Google Agenda : connexion Google (copie de l'adresse de retour), ou adresse secrète .ics en lecture seule."""

import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlencode, urlparse

import requests
from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("accounts", __name__)
_lock = threading.RLock()
_flows = {}  # connexions Microsoft / Google en cours

MS_LOGIN = os.environ.get("MS_LOGIN_URL", "https://login.microsoftonline.com").rstrip("/")
GOOGLE_AUTH = os.environ.get("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
GOOGLE_TOKEN = os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
GOOGLE_REDIRECT = "http://127.0.0.1:53682/"
MS_SCOPES = {
    "mail": "offline_access openid email https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    "cal": "offline_access openid email https://graph.microsoft.com/Calendars.ReadWrite",
}
GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/calendar"

# Serveurs connus : (imap, port, sécurité), (smtp, port, sécurité), le serveur enregistre-t-il seul les mails envoyés
SERVERS = {
    "icloud": (("imap.mail.me.com", 993, "ssl"), ("smtp.mail.me.com", 587, "starttls"), False),
    "gmail": (("imap.gmail.com", 993, "ssl"), ("smtp.gmail.com", 465, "ssl"), True),
    "microsoft": (("outlook.office365.com", 993, "ssl"), ("smtp-mail.outlook.com", 587, "starttls"), True),
    "yahoo": (("imap.mail.yahoo.com", 993, "ssl"), ("smtp.mail.yahoo.com", 465, "ssl"), False),
    "orange": (("imap.orange.fr", 993, "ssl"), ("smtp.orange.fr", 465, "ssl"), False),
    "free": (("imap.free.fr", 993, "ssl"), ("smtp.free.fr", 465, "ssl"), False),
    "sfr": (("imap.sfr.fr", 993, "ssl"), ("smtp.sfr.fr", 465, "ssl"), False),
    "laposte": (("imap.laposte.net", 993, "ssl"), ("smtp.laposte.net", 465, "ssl"), False),
    "gmx": (("imap.gmx.com", 993, "ssl"), ("mail.gmx.com", 465, "ssl"), False),
    "proton": (("127.0.0.1", 1143, "starttls"), ("127.0.0.1", 1025, "starttls"), True),
}
DOMAINS = {
    "icloud": ["icloud.com", "me.com", "mac.com"],
    "gmail": ["gmail.com", "googlemail.com"],
    "microsoft": ["outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "msn.com"],
    "yahoo": ["yahoo.com", "yahoo.fr", "ymail.com"],
    "orange": ["orange.fr", "wanadoo.fr"],
    "free": ["free.fr"],
    "sfr": ["sfr.fr", "neuf.fr"],
    "laposte": ["laposte.net"],
    "gmx": ["gmx.com", "gmx.fr", "gmx.net"],
}
LABELS = {"icloud": "iCloud", "gmail": "Gmail", "google": "Google", "microsoft": "Outlook", "yahoo": "Yahoo", "orange": "Orange",
          "free": "Free", "sfr": "SFR", "laposte": "La Poste", "gmx": "GMX", "imap": "IMAP", "caldav": "CalDAV", "ics": "Lien .ics"}


# --- Chiffrement -------------------------------------------------------------------

def _key():
    p = store.path("accounts", "cle.bin")
    with _lock:
        if not os.path.exists(p):
            os.makedirs(os.path.dirname(p), exist_ok=True)
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(os.urandom(32))
        with open(p, "rb") as f:
            return f.read()


def seal(obj):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    return base64.b64encode(nonce + AESGCM(_key()).encrypt(nonce, json.dumps(obj).encode(), b"bt-accounts")).decode()


def unseal(blob):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not blob:
        return {}
    raw = base64.b64decode(blob)
    return json.loads(AESGCM(_key()).decrypt(raw[:12], raw[12:], b"bt-accounts"))


# --- Stockage ------------------------------------------------------------------------

def _all():
    return store.load("accounts/comptes", {"accounts": []})["accounts"]


def of(user):
    return [a for a in _all() if a["owner"] == user]


def get(user, acc_id):
    a = next((a for a in _all() if a["id"] == acc_id and a["owner"] == user), None)
    if not a:
        raise ValueError("Compte introuvable")
    return a


def everyone():
    return _all()


def save(acc):
    def go(d):
        d["accounts"] = [x for x in d["accounts"] if x["id"] != acc["id"]] + [acc]
    store.update("accounts/comptes", {"accounts": []}, go)


def patch(acc_id, fn):
    """Modifie un compte sous verrou (fn reçoit le compte) ; renvoie le compte à jour."""
    def go(d):
        for a in d["accounts"]:
            if a["id"] == acc_id:
                fn(a)
                return a
        return None
    return store.update("accounts/comptes", {"accounts": []}, go)


def remove(user, acc_id):
    get(user, acc_id)
    store.update("accounts/comptes", {"accounts": []}, lambda d: d.__setitem__("accounts", [a for a in d["accounts"] if a["id"] != acc_id]))


def secret(acc):
    return unseal(acc.get("secret"))


def set_secret(acc_id, **values):
    def go(a):
        s = unseal(a.get("secret"))
        s.update(values)
        a["secret"] = seal(s)
    patch(acc_id, go)


def public(a):
    out = {k: v for k, v in a.items() if k not in ("secret", "owner")}
    out["provider_label"] = LABELS.get(a["provider"], a["provider"])
    return out


def find_or_new(user, provider, email):
    email = (email or "").strip().lower()
    for a in of(user):
        if a["provider"] == provider and a.get("email", "").lower() == email and email:
            return a
    return {"id": uuid.uuid4().hex[:10], "owner": user, "provider": provider, "email": email, "label": email or LABELS.get(provider, provider),
            "created": time.time(), "mail": None, "cal": None, "secret": seal({})}


# --- OAuth (Microsoft, Google) ----------------------------------------------------------

def oauth_config():
    cfg = store.load("accounts/oauth", {})
    return {"ms_client_id": cfg.get("ms_client_id") or os.environ.get("MS_CLIENT_ID", ""),
            "google_client_id": cfg.get("google_client_id") or os.environ.get("GOOGLE_CLIENT_ID", ""),
            "google_client_secret": cfg.get("google_client_secret") or os.environ.get("GOOGLE_CLIENT_SECRET", "")}


def _claims(id_token):
    try:
        part = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (IndexError, ValueError, AttributeError):
        return {}


def _token_fields(r):
    return {"access": r["access_token"], "refresh": r.get("refresh_token"), "expires": time.time() + int(r.get("expires_in", 3600)) - 60}


def token(acc, key):
    """Jeton d'accès valide pour `key` (ms_mail, ms_cal, google), renouvelé si besoin."""
    s = secret(acc)
    t = s.get(key)
    if not t:
        raise ValueError("Ce compte n'est plus connecté : reconnecte-le")
    if t.get("expires", 0) > time.time():
        return t["access"]
    cfg = oauth_config()
    if key.startswith("ms_"):
        r = requests.post(f"{MS_LOGIN}/common/oauth2/v2.0/token", timeout=20, data={
            "client_id": cfg["ms_client_id"], "grant_type": "refresh_token", "refresh_token": t["refresh"],
            "scope": MS_SCOPES[key[3:]]})
    else:
        r = requests.post(GOOGLE_TOKEN, timeout=20, data={
            "client_id": cfg["google_client_id"], "client_secret": cfg["google_client_secret"],
            "grant_type": "refresh_token", "refresh_token": t["refresh"]})
    if r.status_code != 200:
        raise ValueError("La connexion a expiré : reconnecte ce compte (Réglages → Comptes en ligne)")
    new = _token_fields(r.json())
    new["refresh"] = new["refresh"] or t["refresh"]
    set_secret(acc["id"], **{key: new})
    return new["access"]


def ms_start(user, purpose):
    cid = oauth_config()["ms_client_id"]
    if not cid:
        raise ValueError("La connexion Microsoft n'est pas configurée : un administrateur doit renseigner l'identifiant d'application (Réglages → Comptes en ligne)")
    r = requests.post(f"{MS_LOGIN}/common/oauth2/v2.0/devicecode", data={"client_id": cid, "scope": MS_SCOPES[purpose]}, timeout=20)
    if r.status_code != 200:
        raise ValueError(f"Microsoft a refusé la demande : {r.json().get('error_description', r.status_code) if r.headers.get('content-type', '').startswith('application/json') else r.status_code}")
    d = r.json()
    flow = secrets.token_urlsafe(12)
    _flows[flow] = {"owner": user, "kind": "ms", "purpose": purpose, "device_code": d["device_code"], "expires": time.time() + int(d.get("expires_in", 900))}
    return {"flow": flow, "code": d["user_code"], "url": d.get("verification_uri", "https://microsoft.com/devicelogin"), "interval": int(d.get("interval", 5))}


def ms_poll(user, flow_id):
    f = _flows.get(flow_id)
    if not f or f["owner"] != user or f["kind"] != "ms":
        raise ValueError("Connexion introuvable : recommence")
    if time.time() > f["expires"]:
        _flows.pop(flow_id, None)
        raise ValueError("Le code a expiré : recommence")
    r = requests.post(f"{MS_LOGIN}/common/oauth2/v2.0/token", timeout=20, data={
        "client_id": oauth_config()["ms_client_id"], "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": f["device_code"]})
    d = r.json()
    if r.status_code != 200:
        if d.get("error") in ("authorization_pending", "slow_down"):
            return None
        _flows.pop(flow_id, None)
        raise ValueError({"authorization_declined": "Connexion refusée", "expired_token": "Le code a expiré : recommence"}.get(
            d.get("error"), d.get("error_description", "Connexion Microsoft impossible").split("\r\n")[0]))
    _flows.pop(flow_id, None)
    c = _claims(d.get("id_token", ""))
    email = c.get("email") or c.get("preferred_username") or ""
    return f["purpose"], email, _token_fields(d)


def google_start(user):
    cfg = oauth_config()
    if not cfg["google_client_id"]:
        raise ValueError("La connexion Google n'est pas configurée (Réglages → Comptes en ligne)")
    verifier = secrets.token_urlsafe(48)
    flow = secrets.token_urlsafe(12)
    _flows[flow] = {"owner": user, "kind": "google", "verifier": verifier, "expires": time.time() + 900}
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return {"flow": flow, "url": GOOGLE_AUTH + "?" + urlencode({
        "client_id": cfg["google_client_id"], "redirect_uri": GOOGLE_REDIRECT, "response_type": "code", "scope": GOOGLE_SCOPES,
        "access_type": "offline", "prompt": "consent", "state": flow, "code_challenge": challenge, "code_challenge_method": "S256"})}


def google_finish(user, flow_id, pasted):
    f = _flows.get(flow_id)
    if not f or f["owner"] != user or f["kind"] != "google" or time.time() > f["expires"]:
        raise ValueError("Connexion expirée : recommence")
    pasted = (pasted or "").strip()
    q = parse_qs(urlparse(pasted).query) if "://" in pasted or "code=" in pasted else {"code": [pasted]}
    if "code=" in pasted and "://" not in pasted:
        q = parse_qs(pasted.split("?", 1)[-1])
    if q.get("error"):
        raise ValueError("Connexion refusée")
    code = (q.get("code") or [""])[0]
    if not code:
        raise ValueError("Je ne trouve pas le code dans cette adresse : copie toute l'adresse de la page")
    cfg = oauth_config()
    r = requests.post(GOOGLE_TOKEN, timeout=20, data={
        "client_id": cfg["google_client_id"], "client_secret": cfg["google_client_secret"], "code": code,
        "code_verifier": f["verifier"], "grant_type": "authorization_code", "redirect_uri": GOOGLE_REDIRECT})
    if r.status_code != 200:
        raise ValueError("Google a refusé le code (déjà utilisé ou expiré) : recommence")
    _flows.pop(flow_id, None)
    d = r.json()
    return _claims(d.get("id_token", "")).get("email", ""), _token_fields(d)


# --- Détection des serveurs mail ---------------------------------------------------------

def provider_of(email):
    domain = email.rsplit("@", 1)[-1].lower()
    return next((p for p, ds in DOMAINS.items() if domain in ds), None)


def detect(email):
    """Réglages IMAP/SMTP probables pour une adresse : fournisseurs connus, puis base Thunderbird, puis devinette."""
    email = (email or "").strip()
    if "@" not in email:
        raise ValueError("Adresse mail invalide")
    local, domain = email.rsplit("@", 1)
    p = provider_of(email)
    if p:
        (ih, ip, isec), (sh, sp, ssec), auto = SERVERS[p]
        return {"provider": p, "imap_host": ih, "imap_port": ip, "imap_sec": isec, "smtp_host": sh, "smtp_port": sp, "smtp_sec": ssec,
                "username": email, "auto_sent": auto}
    try:
        r = requests.get(f"https://autoconfig.thunderbird.net/v1.1/{domain}", timeout=8)
        if r.status_code == 200:
            x = ET.fromstring(r.content)
            inc = next(s for s in x.iter("incomingServer") if s.get("type") == "imap")
            out = next(s for s in x.iter("outgoingServer") if s.get("type") == "smtp")
            sec = lambda s: {"SSL": "ssl", "STARTTLS": "starttls"}.get(s.findtext("socketType"), "none")
            user = (inc.findtext("username") or "%EMAILADDRESS%").replace("%EMAILADDRESS%", email).replace("%EMAILLOCALPART%", local)
            return {"provider": "imap", "imap_host": inc.findtext("hostname"), "imap_port": int(inc.findtext("port")), "imap_sec": sec(inc),
                    "smtp_host": out.findtext("hostname"), "smtp_port": int(out.findtext("port")), "smtp_sec": sec(out), "username": user, "auto_sent": False}
    except Exception:  # noqa: BLE001
        pass
    return {"provider": "imap", "imap_host": f"imap.{domain}", "imap_port": 993, "imap_sec": "ssl",
            "smtp_host": f"smtp.{domain}", "smtp_port": 465, "smtp_sec": "ssl", "username": email, "auto_sent": False}


# --- Routes ----------------------------------------------------------------------------

@bp.get("/api/accounts")
def list_accounts():
    cfg = oauth_config()
    return jsonify(accounts=[public(a) for a in of(g.user["name"])],
                   oauth={"microsoft": bool(cfg["ms_client_id"]), "google": bool(cfg["google_client_id"] and cfg["google_client_secret"])})


@bp.post("/api/accounts/detect")
def detect_route():
    return jsonify(detect((request.get_json(silent=True) or {}).get("email")))


def _finish(acc, want_mail, want_cal, mail_cfg=None, password=None, cal_cfg=None):
    """Teste puis enregistre les services demandés sur un compte."""
    import extcal
    import mail
    if password is not None:
        s = unseal(acc["secret"])
        s["password"] = password
        acc["secret"] = seal(s)
    if want_mail:
        acc["mail"] = {**(acc.get("mail") or {"notify": True}), **mail_cfg}
        mail.test(acc)
    if want_cal:
        acc["cal"] = {**(acc.get("cal") or {}), **cal_cfg}
        acc["cal"]["calendars"] = extcal.discover(acc)
        if not acc.get("label"):  # lien .ics sans nom : celui du calendrier
            acc["label"] = acc["cal"]["calendars"][0]["name"]
    save(acc)
    return public(acc)


@bp.post("/api/accounts")
def add():
    """Compte à mot de passe (iCloud, Gmail, autre IMAP, CalDAV) ou lien .ics."""
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    provider = d.get("provider")
    email = str(d.get("email") or "").strip()
    password = str(d.get("password") or "").replace(" ", "") if provider in ("icloud", "gmail") else str(d.get("password") or "")
    want_mail, want_cal = bool(d.get("mail")), bool(d.get("cal"))
    if provider == "ics":
        url = str(d.get("url") or "").strip()
        if not re.match(r"(https?|webcals?)://", url):
            raise ValueError("Colle l'adresse du calendrier (elle commence par https:// ou webcal://)")
        acc = find_or_new(user, "ics", "")
        acc["label"] = str(d.get("name") or "").strip()[:60]
        return jsonify(_finish(acc, False, True, cal_cfg={"kind": "ics", "url": url}))
    if provider == "caldav":
        url = str(d.get("url") or "").strip()
        if not re.match(r"https?://", url):
            raise ValueError("Adresse du serveur CalDAV invalide (https://…)")
        acc = find_or_new(user, "caldav", email or d.get("username"))
        acc["label"] = str(d.get("name") or "").strip()[:60] or urlparse(url).hostname
        acc["username"] = str(d.get("username") or email)
        return jsonify(_finish(acc, False, True, password=password, cal_cfg={"kind": "caldav", "url": url}))
    if not email or "@" not in email:
        raise ValueError("Indique ton adresse mail")
    if not password:
        raise ValueError("Indique le mot de passe")
    if not (want_mail or want_cal):
        raise ValueError("Choisis au moins les mails ou l'agenda")
    if provider == "icloud":
        acc = find_or_new(user, "icloud", email)
        acc["username"] = email
        (ih, ip, isec), (sh, sp, ssec), auto = SERVERS["icloud"]
        mail_cfg = {"imap_host": ih, "imap_port": ip, "imap_sec": isec, "smtp_host": sh, "smtp_port": sp, "smtp_sec": ssec, "username": email, "auto_sent": auto, "auth": "password"}
        return jsonify(_finish(acc, want_mail, want_cal, mail_cfg, password, {"kind": "caldav", "url": "https://caldav.icloud.com/"}))
    # Gmail, Yahoo, Orange… ou serveur IMAP réglé à la main
    det = detect(email)
    cfg = {k: d.get(k) or det[k] for k in ("imap_host", "imap_port", "imap_sec", "smtp_host", "smtp_port", "smtp_sec", "username")}
    cfg["imap_port"], cfg["smtp_port"] = int(cfg["imap_port"]), int(cfg["smtp_port"])
    if cfg["imap_sec"] not in ("ssl", "starttls", "none") or cfg["smtp_sec"] not in ("ssl", "starttls", "none"):
        raise ValueError("Sécurité inconnue")
    cfg.update(auto_sent=bool(d["auto_sent"]) if "auto_sent" in d else det["auto_sent"], auth="password")
    prov = det["provider"] if det["provider"] in SERVERS else "imap"
    acc = find_or_new(user, prov, email)
    return jsonify(_finish(acc, True, False, cfg, password))


@bp.put("/api/accounts/<acc_id>")
def edit(acc_id):
    d = request.get_json(silent=True) or {}
    get(g.user["name"], acc_id)

    def go(a):
        if d.get("label"):
            a["label"] = str(d["label"]).strip()[:60]
        if a.get("mail"):
            if "notify" in d:
                a["mail"]["notify"] = bool(d["notify"])
            if "filter" in d:
                a["mail"]["filter"] = bool(d["filter"])
            if "signature" in d:
                a["mail"]["signature"] = str(d["signature"] or "")[:2000]
            if d.get("name") is not None:
                a["mail"]["name"] = str(d["name"]).strip()[:80]
        for c in (a.get("cal") or {}).get("calendars", []):
            u = (d.get("calendars") or {}).get(c["id"])
            if u:
                if re.fullmatch(r"#[0-9a-fA-F]{6}", str(u.get("color", ""))):
                    c["color"] = u["color"]
                if "on" in u:
                    c["on"] = bool(u["on"])
    return jsonify(public(patch(acc_id, go)))


@bp.post("/api/accounts/<acc_id>/refresh")
def refresh_calendars(acc_id):
    import extcal
    acc = get(g.user["name"], acc_id)
    if not acc.get("cal"):
        raise ValueError("Ce compte n'a pas d'agenda")
    fresh = extcal.discover(acc)
    old = {c["id"]: c for c in acc["cal"].get("calendars", [])}
    for c in fresh:  # garde couleur et affichage choisis
        if c["id"] in old:
            c["color"], c["on"] = old[c["id"]].get("color", c["color"]), old[c["id"]].get("on", True)
    return jsonify(public(patch(acc_id, lambda a: a["cal"].__setitem__("calendars", fresh))))


@bp.delete("/api/accounts/<acc_id>")
def delete(acc_id):
    what = request.args.get("only")
    if what in ("mail", "cal"):
        acc = get(g.user["name"], acc_id)
        other = "cal" if what == "mail" else "mail"
        if acc.get(other):
            patch(acc_id, lambda a: a.__setitem__(what, None))
            return jsonify(ok=True)
    remove(g.user["name"], acc_id)
    import mail
    mail._pool.drop(acc_id)  # ferme la connexion IMAP gardée ouverte
    return jsonify(ok=True)


@bp.post("/api/accounts/oauth/microsoft/start")
def ms_start_route():
    purpose = (request.get_json(silent=True) or {}).get("purpose")
    if purpose not in MS_SCOPES:
        raise ValueError("Usage inconnu")
    return jsonify(ms_start(g.user["name"], purpose))


@bp.post("/api/accounts/oauth/microsoft/poll")
def ms_poll_route():
    user = g.user["name"]
    res = ms_poll(user, (request.get_json(silent=True) or {}).get("flow"))
    if res is None:
        return jsonify(pending=True)
    purpose, email, tok = res
    acc = find_or_new(user, "microsoft", email)
    acc["username"] = email
    s = unseal(acc["secret"])
    s["ms_" + purpose] = tok
    acc["secret"] = seal(s)
    save(acc)  # le jeton est gardé même si le test échoue
    if purpose == "mail":
        (ih, ip, isec), (sh, sp, ssec), auto = SERVERS["microsoft"]
        return jsonify(_finish(acc, True, False, {"imap_host": ih, "imap_port": ip, "imap_sec": isec, "smtp_host": sh, "smtp_port": sp,
                                                   "smtp_sec": ssec, "username": email, "auto_sent": auto, "auth": "oauth"}))
    return jsonify(_finish(acc, False, True, cal_cfg={"kind": "graph"}))


@bp.post("/api/accounts/oauth/google/start")
def google_start_route():
    return jsonify(google_start(g.user["name"]))


@bp.post("/api/accounts/oauth/google/finish")
def google_finish_route():
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    email, tok = google_finish(user, d.get("flow"), d.get("url"))
    acc = find_or_new(user, "google", email)
    s = unseal(acc["secret"])
    s["google"] = tok
    acc["secret"] = seal(s)
    return jsonify(_finish(acc, False, True, cal_cfg={"kind": "google"}))


@bp.get("/api/accounts/oauth-config")
def oauth_get():
    if g.user.get("role") != "admin":
        raise PermissionError("Réservé aux administrateurs")
    cfg = oauth_config()
    return jsonify(ms_client_id=cfg["ms_client_id"], google_client_id=cfg["google_client_id"], google_secret_set=bool(cfg["google_client_secret"]),
                   redirect=GOOGLE_REDIRECT)


@bp.put("/api/accounts/oauth-config")
def oauth_set():
    if g.user.get("role") != "admin":
        raise PermissionError("Réservé aux administrateurs")
    d = request.get_json(silent=True) or {}

    def go(cfg):
        for k in ("ms_client_id", "google_client_id", "google_client_secret"):
            if k in d and (k != "google_client_secret" or d[k]):
                cfg[k] = str(d[k] or "").strip()[:200]
    store.update("accounts/oauth", {}, go)
    return oauth_get()
