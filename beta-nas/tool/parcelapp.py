"""Colis ⇄ appli Parcel (iPhone, iPad, Mac) avec son API (abonnement Premium).

- Les numéros de suivi repérés dans les mails sont ajoutés à Parcel tout seuls.
- L'état des colis suivis par Parcel (y compris les commandes Amazon reliées dans l'appli Parcel)
  revient dans l'outil Colis et dans « Ma journée ».

Parcel limite son API à 20 requêtes par heure : la synchro se fait toutes les 30 minutes au plus,
une seule lecture à chaque fois. Chaque compte Bêta Tool utilise sa propre clé (chiffrée sur le NAS)."""

import os
import re
import threading
import time
import unicodedata
import uuid

import requests

import activity
import store

API = os.environ.get("PARCEL_API_URL", "https://api.parcel.app/external").rstrip("/")
EVERY = 1800  # secondes entre deux synchros automatiques
# état Parcel → état Bêta Tool
STATUS = {0: "livre", 1: None, 2: "transit", 3: "relais", 4: "tournee", 5: "inconnu", 6: "incident", 7: "incident", 8: "prepare"}
# noms à chercher dans la liste des transporteurs de Parcel pour chaque transporteur de Bêta Tool
NAMES = {"colissimo": ["colissimo", "la poste"], "chronopost": ["chronopost"], "ups": ["ups"], "dhl": ["dhl"], "dpd": ["dpd france", "dpd"],
         "gls": ["gls france", "gls"], "mondialrelay": ["mondial relay"], "relaiscolis": ["relais colis"], "colisprive": ["colis prive"],
         "amazon": ["amazon logistics", "amazon"], "fedex": ["fedex"], "vinted": ["vinted go", "vinted"]}
_carriers = {"at": 0, "list": {}}
_lock = threading.Lock()


def plain(s):
    return unicodedata.normalize("NFKD", str(s or "").lower()).encode("ascii", "ignore").decode().strip()


# --- Réglages par compte -------------------------------------------------------------------------------

def config(user):
    return store.load("colis/parcel", {}).get(user) or {}


def key_of(user):
    c = config(user)
    if not c.get("key"):
        return ""
    import accounts
    try:
        return accounts.unseal(c["key"])
    except Exception:  # noqa: BLE001
        return ""


def set_config(user, key=None, push=None):
    import accounts

    def go(d):
        c = d.setdefault(user, {})
        if key is not None:
            if key:
                c["key"] = accounts.seal(key)
                c.pop("error", None)
            else:
                d[user] = {}
                return
        if push is not None:
            c["push"] = bool(push)
    store.update("colis/parcel", {}, go)


def _note(user, **kw):
    store.update("colis/parcel", {}, lambda d: d.setdefault(user, {}).update(kw))


# --- API Parcel -----------------------------------------------------------------------------------------

def _call(method, path, key, **kw):
    r = requests.request(method, f"{API}/{path}", headers={"api-key": key, "Content-Type": "application/json"}, timeout=20, **kw)
    if r.status_code == 401:
        raise ValueError("Clé Parcel refusée : vérifie-la (Parcel Premium nécessaire)")
    if r.status_code == 429:
        raise ValueError("Parcel limite à 20 requêtes par heure : réessaie un peu plus tard")
    try:
        data = r.json()
    except ValueError:
        raise ValueError(f"Réponse inattendue de Parcel (HTTP {r.status_code})")
    if isinstance(data, dict) and data.get("success") is False:
        raise ValueError(f"Parcel : {data.get('error_message') or 'erreur'}")
    return data


def carriers():
    """{code: nom} des transporteurs de Parcel (liste publique, gardée 24 h)."""
    with _lock:
        if time.time() - _carriers["at"] < 86400 and _carriers["list"]:
            return _carriers["list"]
    try:
        data = requests.get(f"{API}/supported_carriers.json", timeout=20).json()
    except (requests.RequestException, ValueError):
        return _carriers["list"]
    out = {}
    if isinstance(data, dict):
        for k, v in data.items():
            out[str(k)] = v if isinstance(v, str) else (v.get("name") if isinstance(v, dict) else str(v))
    elif isinstance(data, list):
        for c in data:
            if isinstance(c, dict) and (c.get("code") or c.get("carrier_code")):
                out[str(c.get("code") or c.get("carrier_code"))] = c.get("name") or c.get("title") or ""
    with _lock:
        _carriers.update(at=time.time(), list=out)
    return out


def code_for(carrier):
    """Code Parcel d'un transporteur de Bêta Tool, ou None."""
    lst = carriers()
    for name in NAMES.get(carrier, [carrier]):
        if name.replace(" ", "") in lst:
            return name.replace(" ", "")
        for code, label in lst.items():
            if plain(label) == name:
                return code
        for code, label in lst.items():
            if plain(label).startswith(name):
                return code
    return "amazon" if carrier == "amazon" else None


def our_carrier(code):
    code = plain(code)
    name = plain(carriers().get(code, code))
    for ours, names in NAMES.items():
        if any(n in name or n.replace(" ", "") == code for n in names):
            return ours
    return "parcel"


def push(user, p):
    """Ajoute un colis de Bêta Tool dans Parcel (une requête). Renvoie True si c'est fait."""
    key = key_of(user)
    if not key or p.get("parcel") or not config(user).get("push", True):
        return False
    code = code_for(p["carrier"])
    if not code:
        return False
    _call("POST", "add-delivery/", key, json={"tracking_number": p["number"], "carrier_code": code, "description": p["label"][:60],
                                              "language": "fr", "send_push_confirmation": False})
    return True


# --- Synchro --------------------------------------------------------------------------------------------

def sync(user, force=False):
    """Lit les colis de Parcel et met à jour l'outil Colis. Renvoie {added, updated, pushed}."""
    import colis
    key = key_of(user)
    if not key:
        return {"added": 0, "updated": 0, "pushed": 0}
    c = config(user)
    if not force and time.time() - c.get("last", 0) < EVERY - 60:
        return {"added": 0, "updated": 0, "pushed": 0}
    out = {"added": 0, "updated": 0, "pushed": 0}
    # d'abord, envoyer à Parcel les colis repérés dans les mails (au plus 5 par synchro : limite de 20 requêtes/heure)
    parcels = colis.load(user)
    for p in [p for p in parcels if not p["archived"] and p["status"] != "livre" and not p.get("parcel") and not p.get("parcel_skip")][:5]:
        try:
            if push(user, p):
                p["parcel"] = True
                out["pushed"] += 1
            else:
                p["parcel_skip"] = True  # transporteur inconnu de Parcel
        except ValueError as e:
            if "déjà" in str(e) or "exist" in str(e).lower():
                p["parcel"] = True
            else:
                _note(user, error=str(e), last=time.time())
                colis.save(user, parcels)
                return out
    try:
        data = _call("GET", "deliveries/", key, params={"filter_mode": "recent"})
    except (ValueError, requests.RequestException) as e:
        _note(user, error=str(e), last=time.time())
        colis.save(user, parcels)
        return out
    news = []
    for d in data.get("deliveries") or []:
        number = re.sub(r"\s", "", str(d.get("tracking_number") or "")).upper()
        if not number:
            continue
        st = STATUS.get(d.get("status_code"))
        events = d.get("events") or []
        p = next((x for x in parcels if x["number"].upper() == number), None)
        if not p:
            p = {"id": uuid.uuid4().hex[:8], "carrier": our_carrier(d.get("carrier_code", "")), "number": number,
                 "label": (d.get("description") or "Colis")[:60], "status": st or "inconnu", "steps": [], "created": time.time(),
                 "updated": time.time(), "archived": False, "link": None, "subject": "", "parcel": True}
            parcels.insert(0, p)
            out["added"] += 1
            if st != "livre":
                news.append((p, "nouveau"))
        p["parcel"] = True
        if d.get("carrier_code"):
            p["parcel_carrier"] = d["carrier_code"]
        if d.get("date_expected"):
            p["expected"] = str(d["date_expected"])[:25]
            if d.get("date_expected_end"):
                p["expected_end"] = str(d["date_expected_end"])[:25]
        # historique : les étapes de Parcel (de la plus récente à la plus ancienne)
        known = {s.get("text") for s in p["steps"]}
        for ev in reversed(events[:15]):
            text = " · ".join(x for x in (ev.get("event"), ev.get("location")) if x)[:160]
            if text and text not in known:
                p["steps"].append({"at": time.time(), "status": st or p["status"], "text": text, "date": ev.get("date")})
                known.add(text)
        if st and st != p["status"]:
            p["status"], p["updated"] = st, time.time()
            if st == "livre":
                p["delivered"] = p.get("delivered") or time.time()
            out["updated"] += 1
            news.append((p, st))
    colis.save(user, parcels)
    _note(user, last=time.time(), error=None, count=len(data.get("deliveries") or []))
    for p, what in news:
        if what == "nouveau":
            activity.log(user, "colis", f"{p['label']} · {colis.LABEL.get(p['status'], '')}", "#/colis", title="📦 Nouveau colis (Parcel)")
        else:
            activity.log(user, "colis", f"{p['label']} : {colis.LABEL[what].lower()}", "#/colis", title=f"📦 Colis {colis.LABEL[what].lower()}")
    return out


def loop():
    while True:
        time.sleep(300)
        try:
            for user in list(store.load("colis/parcel", {})):
                if key_of(user):
                    sync(user)
        except Exception as e:  # noqa: BLE001
            print("parcel", e, flush=True)


def start():
    threading.Thread(target=loop, daemon=True).start()
