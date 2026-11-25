"""Outil « Colis » : les numéros de suivi sont repérés tout seuls dans les mails (confirmation de
commande, « votre colis est expédié »…), et l'avancement est mis à jour par les mails suivants du
transporteur (expédié, en cours de livraison, disponible en point relais, livré).

Sans clé d'API, rien n'est demandé aux transporteurs : seuls tes mails servent. Avec une clé
« Suivi » gratuite de La Poste (developer.laposte.fr), Colissimo / Chronopost / La Poste sont aussi
interrogés toutes les 2 heures."""

import os
import re
import threading
import time
import uuid
from html import unescape
from urllib.parse import parse_qs, quote, urlparse

import requests
from flask import Blueprint, g, jsonify, request

import activity
import store

bp = Blueprint("colis", __name__)
LAPOSTE = os.environ.get("LAPOSTE_URL", "https://api.laposte.fr/suivi/v2/idships/")

CARRIERS = {
    "colissimo": ("Colissimo", "https://www.laposte.fr/outils/suivre-vos-envois?code={n}"),
    "chronopost": ("Chronopost", "https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT={n}"),
    "ups": ("UPS", "https://www.ups.com/track?loc=fr_FR&tracknum={n}"),
    "dhl": ("DHL", "https://www.dhl.com/fr-fr/home/suivi.html?tracking-id={n}"),
    "dpd": ("DPD", "https://trace.dpd.fr/fr/trace/{n}"),
    "gls": ("GLS", "https://gls-group.com/FR/fr/suivi-colis?match={n}"),
    "mondialrelay": ("Mondial Relay", "https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition={n}"),
    "relaiscolis": ("Relais Colis", "https://www.relaiscolis.com/suivi-de-colis/index/tracking/?reference={n}"),
    "colisprive": ("Colis Privé", "https://www.colisprive.fr/moncolis/pages/detailColis.aspx?numColis={n}"),
    "amazon": ("Amazon Logistics", "https://www.amazon.fr/progress-tracker/package/?trackingId={n}"),
    "fedex": ("FedEx", "https://www.fedex.com/fedextrack/?trknbr={n}"),
    "vinted": ("Vinted Go", "https://www.vinted.fr/"),
    "parcel": ("Suivi Parcel", "https://web.parcelapp.net/"),
}
KEYWORDS = [("colissimo", r"colissimo|laposte|la poste"), ("chronopost", r"chronopost"), ("ups", r"\bups\b"), ("dhl", r"\bdhl\b"),
            ("dpd", r"\bdpd\b|predict"), ("gls", r"\bgls\b"), ("mondialrelay", r"mondial ?relay"), ("relaiscolis", r"relais ?colis"),
            ("colisprive", r"colis ?priv[ée]"), ("amazon", r"amazon"), ("fedex", r"fed ?ex"), ("vinted", r"vinted")]
URL_PARAMS = {  # liens de suivi : (motif de domaine, paramètres possibles, transporteur)
    "laposte.fr": (["code", "id"], "colissimo"), "colissimo.fr": (["parcelnumber", "code"], "colissimo"),
    "chronopost.fr": (["listeNumerosLT", "listeNumeros"], "chronopost"), "ups.com": (["tracknum", "InquiryNumber1"], "ups"),
    "dhl.": (["tracking-id", "AWB", "piececode"], "dhl"), "dpd.fr": (["parcelNumber", "exp"], "dpd"), "gls-group": (["match"], "gls"),
    "mondialrelay": (["NumeroExpedition", "numeroExpedition"], "mondialrelay"), "fedex.com": (["trknbr", "tracknumbers"], "fedex"),
    "colisprive": (["numColis"], "colisprive"), "relaiscolis": (["reference"], "relaiscolis"),
}
PATTERNS = [  # numéros reconnaissables à leur forme
    ("ups", r"\b1Z[0-9A-Z]{16}\b"), ("amazon", r"\bTBA\d{12}\b"), ("chronopost", r"\b[A-Z]{2}\d{9}[A-Z]{2}\b"),
    ("colissimo", r"\b\d[A-Z]\d{11}\b"), ("dhl", r"\bJ?JD\d{12,20}\b"),
]
CONTEXT_NUM = r"(?:num[ée]ro de (?:suivi|colis|tracking|exp[ée]dition)|n° de suivi|suivi (?:de|du) colis|tracking (?:number|id)|lettre de transport)\s*:?\s*([A-Z0-9]{8,30})"
STATUS = [  # du plus avancé au moins avancé
    ("livre", "Livré", r"(a [ée]t[ée]|est|bien) (livr[ée]|remis)|livraison effectu[ée]e|delivered|colis livr[ée]"),
    ("relais", "Disponible au retrait", r"disponible (en|au|dans votre) (point|relais|bureau|locker|consigne)|à retirer|pr[êe]t (à|a) (être )?retir|avis de passage"),
    ("tournee", "En cours de livraison", r"en cours de livraison|sera livr[ée] aujourd|livraison aujourd|out for delivery|votre livreur|arrive aujourd"),
    ("transit", "En route", r"en cours d'acheminement|en transit|en route|achemin|in transit|arriv[ée] (au|sur) (site|centre)"),
    ("expedie", "Expédié", r"exp[ée]di[ée]|pris en charge|remis au transporteur|shipped|a quitt[ée]|est parti"),
    ("prepare", "En préparation", r"commande (confirm[ée]e|valid[ée]e|en pr[ée]paration)|pr[ée]paration de votre commande"),
]
ORDER = [s[0] for s in reversed(STATUS)]
LABEL = {k: v for k, v, _ in STATUS} | {"incident": "Incident", "inconnu": "En attente d'infos"}


def load(user):
    return store.load("colis/" + user, {"parcels": []})["parcels"]


def save(user, parcels):
    store.save("colis/" + user, {"parcels": parcels})


def tracking_url(p):
    tpl = CARRIERS.get(p["carrier"], ("", "https://www.google.com/search?q={n}"))[1]
    return tpl.format(n=quote(p["number"]))


# --- Repérage dans un mail -------------------------------------------------------------------------

def _text_of(msg):
    import mail
    out = [mail.dec(msg["Subject"]), str(msg["From"] or "")]
    links = []
    for part in msg.walk():
        if part.get_content_maintype() != "text" or part.get_filename():
            continue
        try:
            body = part.get_content()
        except (LookupError, KeyError):
            continue
        if part.get_content_subtype() == "html":
            links += re.findall(r"href\s*=\s*[\"']([^\"']+)", body, re.I)
            body = unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)))
        else:
            links += re.findall(r"https?://\S+", body)
        out.append(body)
    return re.sub(r"[ \t\r\f\v]+", " ", "\n".join(out))[:60000], links


def find_numbers(msg):
    """[(transporteur, numéro)] trouvés dans un mail."""
    text, links = _text_of(msg)
    low = text.lower()
    context = [c for c, pat in KEYWORDS if re.search(pat, low)]
    found = []
    for url in links:
        try:
            u = urlparse(unescape(url))
        except ValueError:
            continue
        for dom, (params, carrier) in URL_PARAMS.items():
            if dom in (u.hostname or ""):
                qs = parse_qs(u.query)
                for p in params:
                    for v in qs.get(p, []):
                        for n in re.split(r"[,;\s]+", v):
                            if re.fullmatch(r"[A-Za-z0-9]{8,35}", n):
                                found.append((carrier, n.upper()))
                m = re.search(r"/(?:trace|suivi|tracking)/([A-Z0-9]{10,30})\b", u.path, re.I)
                if m:
                    found.append((carrier, m[1].upper()))
    for carrier, pat in PATTERNS:
        for n in re.findall(pat, text):
            if carrier == "colissimo" and not re.search(r"colissimo|la ?poste|colis|suivi", low):
                continue
            found.append((carrier, n))
    if re.search(r"colis|livraison|exp[ée]di|suivi|tracking|shipment|parcel", low):
        for n in re.findall(CONTEXT_NUM, text, re.I):
            n = n.upper()
            if sum(ch.isdigit() for ch in n) >= 6:
                carrier = next((c for c, pat in PATTERNS if re.fullmatch(pat.strip("\\b"), n)), None) or (context[0] if context else "inconnu")
                found.append((carrier, n))
    seen, out = set(), []
    for c, n in found:
        if n not in seen:
            seen.add(n)
            out.append((c if c in CARRIERS else (context[0] if context else "inconnu"), n))
    return out[:5]


def status_of(text):
    low = text.lower()
    for key, _, pat in STATUS:
        if re.search(pat, low):
            return key
    if re.search(r"incident|retard|probl[èe]me de livraison|retourn[ée] à l'exp[ée]diteur|adresse (incompl|incorrect)", low):
        return "incident"
    return None


def merchant_of(msg):
    import mail
    name = mail.dec(msg["From"]).split("<")[0].strip().strip('"') or ""
    carriers = "|".join(p for _, p in KEYWORDS)
    if re.search(carriers, name.lower()) and not re.search(r"amazon|vinted", name.lower()):
        m = re.search(r"(?:de|from|chez)\s+([A-Z][\w.&' -]{2,30})", mail.dec(msg["Subject"]))
        return m[1].strip() if m else name
    return name or "Colis"


def scan_message(user, msg, link=None, notify=True):
    """Ajoute les colis trouvés dans un mail, ou met à jour leur état. Renvoie les colis touchés."""
    import mail
    nums = find_numbers(msg)
    if not nums:
        return []
    text, _ = _text_of(msg)
    st = status_of(mail.dec(msg["Subject"]) + "\n" + text[:4000])
    parcels = load(user)
    touched, changes = [], []
    for carrier, number in nums:
        p = next((x for x in parcels if x["number"] == number), None)
        if not p:
            p = {"id": uuid.uuid4().hex[:8], "carrier": carrier, "number": number, "label": merchant_of(msg)[:60], "status": st or "inconnu",
                 "steps": [], "created": time.time(), "updated": time.time(), "archived": False, "link": link, "subject": mail.dec(msg["Subject"])[:120]}
            parcels.insert(0, p)
            changes.append((p, "nouveau"))
        elif st and st != p["status"] and (st == "incident" or p["status"] not in ORDER or ORDER.index(st) > ORDER.index(p["status"])):
            p["status"], p["updated"] = st, time.time()
            changes.append((p, st))
        if st and (not p["steps"] or p["steps"][-1]["status"] != st):
            p["steps"].append({"at": time.time(), "status": st, "text": mail.dec(msg["Subject"])[:120]})
        if p["carrier"] == "inconnu" and carrier != "inconnu":
            p["carrier"] = carrier
        if st == "livre":
            p["delivered"] = p.get("delivered") or time.time()
        touched.append(p)
    save(user, parcels)
    if notify:
        for p, what in changes:
            if what == "nouveau":
                if p["status"] not in ("livre",):
                    activity.log(user, "colis", f"{p['label']} · {CARRIERS.get(p['carrier'], ('Transporteur',))[0]} · {LABEL[p['status']]}", "#/colis", title="📦 Nouveau colis suivi")
            else:
                activity.log(user, "colis", f"{p['label']} : {LABEL[what].lower()}", "#/colis", title=f"📦 Colis {LABEL[what].lower()}")
    return touched


# --- La Poste (facultatif) ---------------------------------------------------------------------------

def laposte_key():
    return store.load("colis/config", {}).get("laposte_key") or os.environ.get("LAPOSTE_API_KEY", "")


LAPOSTE_CODES = {"DI1": "livre", "DI2": "livre", "AG1": "relais", "MD2": "tournee", "ET1": "transit", "ET2": "transit", "ET3": "transit",
                 "ET4": "transit", "EP1": "expedie", "DR1": "expedie", "PC1": "expedie", "PC2": "expedie", "RE1": "incident", "ND1": "incident"}


def laposte_refresh(user):
    key = laposte_key()
    if not key:
        return 0
    parcels = load(user)
    n = 0
    for p in parcels:
        if p["archived"] or p["status"] == "livre" or p["carrier"] not in ("colissimo", "chronopost"):
            continue
        try:
            r = requests.get(LAPOSTE + quote(p["number"]), headers={"X-Okapi-Key": key, "Accept": "application/json"}, params={"lang": "fr_FR"}, timeout=15)
            if r.status_code != 200:
                continue
            ship = r.json().get("shipment", {})
            events = ship.get("event") or []
        except (requests.RequestException, ValueError):
            continue
        if not events:
            continue
        last = events[0]
        st = LAPOSTE_CODES.get(last.get("code"), p["status"])
        if st != p["status"]:
            p["status"], p["updated"] = st, time.time()
            p["steps"].append({"at": time.time(), "status": st, "text": last.get("label", "")[:120]})
            if st == "livre":
                p["delivered"] = time.time()
            activity.log(user, "colis", f"{p['label']} : {LABEL[st].lower()}", "#/colis", title=f"📦 Colis {LABEL[st].lower()}")
            n += 1
    save(user, parcels)
    return n


def refresher():
    import auth
    while True:
        time.sleep(7200)
        try:
            if laposte_key():
                for u in ([x["name"] for x in auth.users()] if auth.mode() == "accounts" else ["local"]):
                    laposte_refresh(u)
        except Exception as e:  # noqa: BLE001
            print("colis", e, flush=True)


def on_mail(acc, uid, msg):
    import settings
    if settings.enabled("colis"):
        scan_message(acc["owner"], msg, f"#/mails/{acc['id']}?uid={uid}")


def start():
    import journee
    import mail
    mail.AFTER_SCREEN.append(on_mail)
    journee.SOURCES["parcels"] = ("colis", brief)
    threading.Thread(target=refresher, daemon=True).start()
    import parcelapp
    parcelapp.start()


def brief(user, today):
    out = []
    for p in load(user):
        if p["archived"]:
            continue
        if p["status"] == "livre" and time.time() - p.get("delivered", 0) > 86400:
            continue
        sub = LABEL[p["status"]] + f" · {CARRIERS.get(p['carrier'], ('',))[0]}".rstrip(" ·")
        if p.get("expected") and p["status"] != "livre":
            try:
                sub += " · prévu le " + time.strftime("%d/%m", time.strptime(p["expected"][:10], "%Y-%m-%d"))
            except ValueError:
                pass
        out.append({"text": p["label"], "sub": sub, "link": "#/colis"})
    return out


# --- Routes --------------------------------------------------------------------------------------------

def public(p):
    return p | {"carrier_name": CARRIERS.get(p["carrier"], ("Transporteur",))[0], "status_label": LABEL.get(p["status"], p["status"]), "url": tracking_url(p)}


@bp.get("/api/colis")
def list_parcels():
    parcels = load(g.user["name"])
    # les colis livrés depuis plus de 10 jours passent dans l'historique
    for p in parcels:
        if p["status"] == "livre" and not p["archived"] and time.time() - p.get("delivered", p["updated"]) > 10 * 86400:
            p["archived"] = True
    import parcelapp
    pc = parcelapp.config(g.user["name"])
    return jsonify(parcels=[public(p) for p in parcels], carriers={k: v[0] for k, v in CARRIERS.items()}, laposte=bool(laposte_key()),
                   parcel={"on": bool(pc.get("key")), "push": pc.get("push", True), "last": pc.get("last"), "error": pc.get("error"), "count": pc.get("count")})


@bp.post("/api/colis")
def add_parcel():
    d = request.get_json(silent=True) or {}
    number = re.sub(r"\s", "", str(d.get("number") or "")).upper()
    if not re.fullmatch(r"[A-Z0-9]{6,35}", number):
        raise ValueError("Numéro de suivi invalide")
    carrier = d.get("carrier") if d.get("carrier") in CARRIERS else next((c for c, pat in PATTERNS if re.fullmatch(pat.strip("\\b"), number)), "colissimo")
    user = g.user["name"]
    parcels = load(user)
    if any(p["number"] == number for p in parcels):
        raise ValueError("Ce colis est déjà suivi")
    p = {"id": uuid.uuid4().hex[:8], "carrier": carrier, "number": number, "label": str(d.get("label") or "Colis").strip()[:60], "status": "inconnu",
         "steps": [], "created": time.time(), "updated": time.time(), "archived": False, "link": None, "subject": ""}
    import parcelapp
    try:
        if parcelapp.push(user, p):
            p["parcel"] = True
    except (ValueError, requests.RequestException):
        pass
    save(user, [p] + parcels)
    laposte_refresh(user)
    return jsonify(public(next(x for x in load(user) if x["id"] == p["id"])))


@bp.put("/api/colis/<pid>")
def edit_parcel(pid):
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    parcels = load(user)
    p = next((x for x in parcels if x["id"] == pid), None)
    if not p:
        raise ValueError("Colis introuvable")
    if d.get("label"):
        p["label"] = str(d["label"]).strip()[:60]
    if "archived" in d:
        p["archived"] = bool(d["archived"])
    if d.get("status") in LABEL:
        p["status"], p["updated"] = d["status"], time.time()
        p["steps"].append({"at": time.time(), "status": d["status"], "text": "Modifié à la main"})
        if d["status"] == "livre":
            p["delivered"] = time.time()
    if d.get("carrier") in CARRIERS:
        p["carrier"] = d["carrier"]
    save(user, parcels)
    return jsonify(public(p))


@bp.delete("/api/colis/<pid>")
def delete_parcel(pid):
    user = g.user["name"]
    save(user, [p for p in load(user) if p["id"] != pid])
    return jsonify(ok=True)


@bp.post("/api/colis/scan")
def scan_mails():
    """Cherche les colis dans les mails des 60 derniers jours de toutes tes boîtes."""
    import email
    import email.policy
    import accounts
    import mail
    user = g.user["name"]
    found = 0
    for acc in [a for a in accounts.of(user) if a.get("mail")]:
        with mail.session(acc) as c:
            mail.select(c, "INBOX")
            since = time.strftime("%d-%b-%Y", time.localtime(time.time() - 60 * 86400))
            typ, data = c.uid("SEARCH", "SINCE", since)
            uids = (data[0].split() if typ == "OK" and data and data[0] else [])[-300:]
            for i in range(0, len(uids), 50):
                typ, data = c.uid("FETCH", b",".join(uids[i:i + 50]).decode(), "(UID BODY.PEEK[]<0.200000>)")
                for meta, raw in mail._fetch_parts(data) if typ == "OK" else []:
                    m = re.search(r"UID (\d+)", meta)
                    msg = email.message_from_bytes(raw, policy=email.policy.default)
                    found += len(scan_message(user, msg, f"#/mails/{acc['id']}?uid={m[1]}" if m else None, notify=False))
    laposte_refresh(user)
    return jsonify(found=found, parcels=[public(p) for p in load(user)])


@bp.get("/api/colis/config")
def get_config():
    return jsonify(laposte=bool(laposte_key()))


@bp.put("/api/colis/config")
def set_config():
    if g.user.get("role") != "admin":
        raise PermissionError("Réservé aux administrateurs")
    key = str((request.get_json(silent=True) or {}).get("laposte_key") or "").strip()[:200]
    store.update("colis/config", {}, lambda d: d.__setitem__("laposte_key", key))
    return jsonify(laposte=bool(key))


@bp.put("/api/colis/parcel")
def parcel_config():
    """Clé de l'API Parcel (appli iPhone / Mac, Premium) du compte, et envoi automatique des colis."""
    import parcelapp
    user, d = g.user["name"], request.get_json(silent=True) or {}
    if "key" in d:
        key = str(d.get("key") or "").strip()[:200]
        if key:
            parcelapp._call("GET", "deliveries/", key, params={"filter_mode": "active"})  # vérifie la clé avant de la garder
        parcelapp.set_config(user, key=key)
        if key:
            return jsonify(parcelapp.sync(user, force=True) | {"on": True})
        return jsonify(on=False)
    if "push" in d:
        parcelapp.set_config(user, push=bool(d["push"]))
    return jsonify(ok=True)


@bp.post("/api/colis/parcel/sync")
def parcel_sync():
    import parcelapp
    user = g.user["name"]
    c = parcelapp.config(user)
    if not c.get("key"):
        raise ValueError("Ajoute d'abord ta clé Parcel")
    if time.time() - c.get("last", 0) < 300:
        raise ValueError("Synchronisé il y a moins de 5 minutes (Parcel limite à 20 requêtes par heure)")
    return jsonify(parcelapp.sync(user, force=True))


def count(user):
    return sum(1 for p in load(user) if not p["archived"] and p["status"] != "livre") or None
