"""Synchro bancaire automatique avec Enable Banking (DSP2, lecture seule).

Chaque compte Bêta Tool utilise sa propre application Enable Banking (mode « restreint », gratuit pour
ses propres comptes) : identifiant de l'application et clé privée, créés sur enablebanking.com.
La banque est reliée une fois (validation dans l'appli de la banque), puis les opérations arrivent
chaque nuit dans le Budget. L'accord est à renouveler tous les 90 jours (règle européenne)."""

import base64
import json
import os
import secrets
import threading
import time
from datetime import date, datetime, timedelta, timezone

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from flask import Blueprint, g, jsonify, redirect, request

import activity
import store

bp = Blueprint("banque", __name__)
API = os.environ.get("ENABLEBANKING_URL", "https://api.enablebanking.com").rstrip("/")


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def config(user):
    return store.load("banque/" + user, {})


def _save(user, fn):
    store.update("banque/" + user, {}, fn)


def _jwt(app_id, pem):
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    now = int(time.time())
    head = _b64(json.dumps({"typ": "JWT", "alg": "RS256", "kid": app_id}).encode())
    body = _b64(json.dumps({"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 3600}).encode())
    sig = key.sign(f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{head}.{body}.{_b64(sig)}"


def _creds(user):
    import accounts
    c = config(user)
    if not c.get("app_id") or not c.get("key"):
        raise ValueError("Ajoute d'abord l'identifiant et la clé de ton application Enable Banking")
    return c["app_id"], accounts.unseal(c["key"])


def call(user, method, path, **kw):
    app_id, pem = _creds(user)
    r = requests.request(method, API + path, headers={"Authorization": "Bearer " + _jwt(app_id, pem), "Content-Type": "application/json"}, timeout=30, **kw)
    if r.status_code == 401:
        raise ValueError("Enable Banking refuse la clé : vérifie l'identifiant de l'application et la clé privée")
    if r.status_code >= 400:
        try:
            msg = r.json().get("message") or r.json().get("error") or r.text[:200]
        except ValueError:
            msg = r.text[:200]
        raise ValueError(f"Enable Banking : {msg}")
    return r.json()


def _rows(txs):
    out = []
    for t in txs:
        amt = float((t.get("transaction_amount") or {}).get("amount") or 0)
        if t.get("credit_debit_indicator") == "DBIT":
            amt = -abs(amt)
        else:
            amt = abs(amt)
        info = " ".join(t.get("remittance_information") or []) if isinstance(t.get("remittance_information"), list) else str(t.get("remittance_information") or "")
        who = ((t.get("creditor") or {}).get("name") if amt < 0 else (t.get("debtor") or {}).get("name")) or ""
        label = " ".join(x for x in (who, info) if x).strip() or t.get("bank_transaction_code", {}).get("description", "") or "Opération"
        d = t.get("booking_date") or t.get("value_date") or t.get("transaction_date")
        if not d:
            continue
        row = {"date": d[:10], "label": label[:200], "amount": round(amt, 2)}
        ref = t.get("entry_reference") or t.get("transaction_id")
        if ref:
            row["fitid"] = "eb-" + str(ref)
        out.append(row)
    return out


def sync(user):
    """Récupère les nouvelles opérations de chaque compte relié et les ajoute au Budget."""
    import budget
    c = config(user)
    if not c.get("accounts"):
        return {"added": 0}
    total = 0
    for acc in c["accounts"]:
        since = acc.get("synced_to") or (date.today() - timedelta(days=89)).isoformat()
        since = (date.fromisoformat(since) - timedelta(days=3)).isoformat()  # chevauchement : les doublons sont ignorés
        txs, key = [], None
        for _ in range(30):
            params = {"date_from": since}
            if key:
                params["continuation_key"] = key
            r = call(user, "GET", f"/accounts/{acc['uid']}/transactions", params=params)
            txs += r.get("transactions") or []
            key = r.get("continuation_key")
            if not key:
                break
        rows = _rows(txs)
        if rows:
            res = budget.import_rows(user, rows, acc.get("label") or "Banque", "Enable Banking")
            total += res["added"]
        acc["synced_to"] = date.today().isoformat()
    _save(user, lambda d: d.update(accounts=c["accounts"], last=time.time(), error=None))
    return {"added": total}


def loop():
    last = None
    while True:
        time.sleep(1800)
        now = datetime.now()
        if now.hour < 4 or last == now.date():
            continue
        last = now.date()
        for name in os.listdir(store.path("banque")) if os.path.isdir(store.path("banque")) else []:
            user = name[:-5]
            c = config(user)
            if not c.get("accounts"):
                continue
            try:
                sync(user)
            except Exception as e:  # noqa: BLE001
                _save(user, lambda d: d.update(error=str(e)[:200]))
            vu = c.get("valid_until", "")[:10]
            if vu and (date.fromisoformat(vu) - date.today()).days in (7, 1):
                activity.log(user, "budget", f"L'accès à ta banque expire le {date.fromisoformat(vu).strftime('%d/%m')} : renouvelle-le dans Budget › Réglages", "#/budget/reglages")


def start():
    os.makedirs(store.path("banque"), exist_ok=True)
    threading.Thread(target=loop, daemon=True).start()


def _origin():
    proto = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    host = request.headers.get("X-Forwarded-Host", request.host).split(",")[0].strip()
    return f"{proto}://{host}"


# --- Routes ---------------------------------------------------------------------------------------------------------

@bp.get("/api/budget/bank")
def status():
    c = config(g.user["name"])
    return jsonify(configured=bool(c.get("app_id") and c.get("key")), app_id=c.get("app_id", ""), bank=c.get("bank"), accounts=c.get("accounts", []),
                   valid_until=c.get("valid_until"), last=c.get("last"), error=c.get("error"), redirect_url=_origin() + "/api/budget/bank/callback")


@bp.put("/api/budget/bank/config")
def set_config():
    import accounts
    user, f = g.user["name"], request.get_json(force=True)
    app_id, pem = str(f.get("app_id") or "").strip(), str(f.get("key") or "").strip()
    if f.get("remove"):
        store.save("banque/" + user, {})
        return jsonify(ok=True)
    if not app_id or "PRIVATE KEY" not in pem:
        raise ValueError("Colle l'identifiant de l'application et le contenu du fichier de clé privée (.pem)")
    try:
        _jwt(app_id, pem)
    except Exception:  # noqa: BLE001
        raise ValueError("Cette clé privée n'est pas lisible : colle tout le contenu du fichier .pem") from None
    _save(user, lambda d: d.update(app_id=app_id, key=accounts.seal(pem)))
    return jsonify(ok=True)


@bp.get("/api/budget/bank/aspsps")
def aspsps():
    r = call(g.user["name"], "GET", "/aspsps", params={"country": request.args.get("country", "FR")})
    q = (request.args.get("q") or "").lower()
    banks = [{"name": a["name"], "logo": a.get("logo")} for a in r.get("aspsps", []) if "personal" in (a.get("psu_types") or ["personal"]) and (not q or q in a["name"].lower())]
    return jsonify(banks=banks[:200])


@bp.post("/api/budget/bank/connect")
def connect():
    user, f = g.user["name"], request.get_json(force=True)
    bank = str(f.get("bank") or "").strip()
    if not bank:
        raise ValueError("Choisis ta banque")
    state = secrets.token_urlsafe(16)
    until = (datetime.now(timezone.utc) + timedelta(days=89)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    r = call(user, "POST", "/auth", json={"access": {"valid_until": until}, "aspsp": {"name": bank, "country": "FR"}, "state": state,
                                          "redirect_url": _origin() + "/api/budget/bank/callback", "psu_type": "personal"})
    _save(user, lambda d: d.update(pending={"state": state, "bank": bank, "at": time.time()}))
    return jsonify(url=r["url"])


@bp.get("/api/budget/bank/callback")
def callback():
    user = g.user["name"]
    c = config(user)
    p = c.get("pending") or {}
    if request.args.get("error"):
        return redirect("/#/budget/reglages?banque=refus")
    if not p or request.args.get("state") != p.get("state") or time.time() - p.get("at", 0) > 1800:
        return redirect("/#/budget/reglages?banque=expire")
    try:
        s = call(user, "POST", "/sessions", json={"code": request.args.get("code", "")})
    except ValueError:
        return redirect("/#/budget/reglages?banque=erreur")
    accs = []
    for a in s.get("accounts") or []:
        iban = (a.get("account_id") or {}).get("iban") or ""
        accs.append({"uid": a["uid"], "label": f"{p['bank']} …{iban[-4:]}" if iban else (a.get("name") or p["bank"]), "iban": iban[-4:]})
    _save(user, lambda d: d.update(session=s.get("session_id"), accounts=accs, bank=p["bank"], valid_until=(s.get("access") or {}).get("valid_until"), pending=None))
    try:
        sync(user)
    except Exception as e:  # noqa: BLE001
        _save(user, lambda d: d.update(error=str(e)[:200]))
    return redirect("/#/budget/reglages?banque=ok")


@bp.post("/api/budget/bank/sync")
def sync_now():
    return jsonify(sync(g.user["name"]))


@bp.post("/api/budget/bank/disconnect")
def disconnect():
    user = g.user["name"]
    c = config(user)
    if c.get("session"):
        try:
            call(user, "DELETE", f"/sessions/{c['session']}")
        except Exception:  # noqa: BLE001
            pass
    _save(user, lambda d: d.update(session=None, accounts=[], bank=None, valid_until=None))
    return jsonify(ok=True)
