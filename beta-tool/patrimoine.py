"""Outil « Patrimoine » : ce que tu possèdes et ce que tu dois, au même endroit.

- Placements : actions et ETF (relevé Revolut importé en CSV, ou saisis à la main), actions et fonds de
  l'entreprise (épargne salariale, RSU / ESPP) avec leur date de disponibilité ; cours mis à jour
  automatiquement quand le symbole est connu, convertis en euros (taux de la BCE).
- Crédits : capital restant dû, mensualité, intérêts restants, date de fin, calculés à partir du contrat.
- Immobilier : biens, valeur, loyers, taxe foncière (aussi repérée dans Paperasse), charges.
- Projet locatif : simulateur d'achat pour louer (mensualité, rendement, cash-flow, endettement).

Tout reste sur le NAS ; seuls les symboles des valeurs sont envoyés pour obtenir les cours."""

import csv
import io
import os
import re
import threading
import time
import uuid
from datetime import date

import requests
from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("patrimoine", __name__)
QUOTE_URL = os.environ.get("QUOTE_URL", "https://query1.finance.yahoo.com/v8/finance/chart/{sym}")
STOOQ_URL = os.environ.get("STOOQ_URL", "https://stooq.com/q/l/?s={sym}&f=sd2t2ohlcv&h&e=csv")
FX_URL = os.environ.get("FX_URL", "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
KINDS = {"action": "Action", "etf": "ETF / tracker", "fonds": "Fonds", "salariale": "Épargne salariale (PEE, PERCO)", "rsu": "Actions de l'entreprise (RSU, ESPP)",
         "crypto": "Crypto", "obligation": "Obligation", "autre": "Autre placement"}
LOAN_KINDS = {"immo": "Crédit immobilier", "conso": "Crédit à la consommation", "auto": "Crédit auto", "travaux": "Prêt travaux", "etudiant": "Prêt étudiant", "autre": "Autre prêt"}
PROP_KINDS = {"principale": "Résidence principale", "locatif": "Locatif", "secondaire": "Résidence secondaire", "terrain": "Terrain / parking"}
EMPTY = {"positions": [], "trades": [], "loans": [], "properties": [], "projects": [], "imports": []}
_lock = threading.Lock()


def key(user):
    return "patrimoine/" + re.sub(r"[^\w-]", "_", user)


def load(user):
    d = store.load(key(user), EMPTY)
    for k, v in EMPTY.items():
        d.setdefault(k, type(v)())
    return d


def num(v, default=None):
    s = str(v if v is not None else "").replace(" ", "").replace(" ", "").replace("€", "").replace("%", "").strip()
    if not s:
        return default
    m = re.search(r"-?[\d.,]+", s)
    if not m:
        return default
    s = m[0]
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return default


# --- Cours et change ---------------------------------------------------------------------------------------

def fx_rates():
    """{devise: unités pour 1 €} (BCE), gardé 12 h."""
    c = store.load("patrimoine/change", {})
    if time.time() - c.get("at", 0) < 43200 and c.get("rates"):
        return c["rates"]
    try:
        xml = requests.get(FX_URL, timeout=15).text
        rates = {m[0]: float(m[1]) for m in re.findall(r"currency=['\"](\w{3})['\"]\s+rate=['\"]([\d.]+)['\"]", xml)}
    except (requests.RequestException, ValueError):
        rates = {}
    if rates:
        rates["EUR"] = 1.0
        store.save("patrimoine/change", {"at": time.time(), "rates": rates})
        return rates
    return c.get("rates") or {"EUR": 1.0}


def to_eur(amount, currency, rates=None):
    if amount is None:
        return None
    currency = (currency or "EUR").upper()
    if currency == "GBX":  # pence
        amount, currency = amount / 100, "GBP"
    rates = rates or fx_rates()
    r = rates.get(currency)
    return amount / r if r else (amount if currency == "EUR" else None)


def quote(sym):
    """(cours, devise) d'un symbole (Yahoo Finance, sinon Stooq), ou (None, None)."""
    try:
        r = requests.get(QUOTE_URL.format(sym=requests.utils.quote(sym)), timeout=12, headers={"User-Agent": "Mozilla/5.0 (BetaTool)"})
        meta = r.json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        if price:
            return float(price), meta.get("currency") or "USD"
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        pass
    try:
        s = sym.lower() if "." in sym else sym.lower() + ".us"
        rows = list(csv.DictReader(io.StringIO(requests.get(STOOQ_URL.format(sym=s), timeout=12).text)))
        if rows and rows[0].get("Close") not in (None, "", "N/D"):
            return float(rows[0]["Close"]), "USD" if s.endswith(".us") else None
    except (requests.RequestException, ValueError, KeyError):
        pass
    return None, None


def refresh_quotes(user, force=False):
    d = load(user)
    cache = store.load("patrimoine/cours", {})
    syms = {p.get("symbol") or p.get("ticker") for p in d["positions"] if (p.get("symbol") or p.get("ticker")) and p.get("price_manual") in (None, "")}
    n = 0
    for sym in syms:
        c = cache.get(sym) or {}
        if not force and time.time() - c.get("at", 0) < 3600 * 4:
            continue
        price, cur = quote(sym)
        if price:
            cache[sym] = {"price": price, "currency": cur or c.get("currency") or "USD", "at": time.time()}
            n += 1
        else:
            cache[sym] = {**c, "error": True, "tried": time.time()}
    store.save("patrimoine/cours", cache)
    return n


def loop():
    while True:
        time.sleep(3600)
        try:
            for name in os.listdir(store.path("patrimoine")):
                if name.endswith(".json") and name not in ("cours.json", "change.json"):
                    refresh_quotes(name[:-5])
        except Exception as e:  # noqa: BLE001
            print("patrimoine", e, flush=True)


def start():
    os.makedirs(store.path("patrimoine"), exist_ok=True)
    threading.Thread(target=loop, daemon=True).start()


# --- Revolut ---------------------------------------------------------------------------------------------------

def parse_revolut(text):
    """Relevé « Trading » de Revolut (CSV) → opérations [{date, ticker, type, qty, price, amount, currency}]."""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or not any(k and k.strip().lower() == "ticker" for k in rows[0]):
        raise ValueError("Ce fichier n'est pas un relevé Revolut : exporte « Relevé de compte » au format Excel / CSV depuis l'onglet Investir de l'appli.")
    out = []
    for r in rows:
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        typ = r.get("type", "").upper()
        cur = r.get("currency") or ""
        m = re.match(r"([A-Z]{3})\s", r.get("total amount", "")) or re.match(r"([A-Z]{3})\s", r.get("price per share", ""))
        cur = cur or (m[1] if m else "USD")
        kind = "buy" if typ.startswith("BUY") else "sell" if typ.startswith("SELL") else "dividend" if "DIVIDEND" in typ else "split" if "SPLIT" in typ else \
            "fee" if "FEE" in typ else "topup" if "TOP-UP" in typ or "TOPUP" in typ else "withdraw" if "WITHDRAW" in typ else "transfer" if "TRANSFER" in typ else "other"
        dt = r.get("date", "")[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", dt):
            m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", r.get("date", ""))
            dt = f"{m[3]}-{int(m[2]):02d}-{int(m[1]):02d}" if m else ""
        out.append({"date": dt, "ticker": r.get("ticker", "").upper(), "type": kind, "qty": num(r.get("quantity"), 0) or 0,
                    "price": num(r.get("price per share")), "amount": num(r.get("total amount"), 0) or 0, "currency": cur.upper()})
    return out


def rebuild_positions(d, account="Revolut"):
    """Recalcule les lignes du compte à partir des opérations (quantité et prix de revient moyen)."""
    pos = {}
    for t in sorted([t for t in d["trades"] if t.get("account") == account], key=lambda t: t["date"]):
        if not t["ticker"]:
            continue
        p = pos.setdefault(t["ticker"], {"qty": 0.0, "cost": 0.0, "currency": t["currency"], "dividends": 0.0})
        if t["type"] == "buy" and t["qty"]:
            p["qty"] += t["qty"]
            p["cost"] += abs(t["amount"]) or (t["price"] or 0) * t["qty"]
        elif t["type"] == "sell" and t["qty"]:
            if p["qty"] > 0:
                p["cost"] *= max(0.0, (p["qty"] - t["qty"]) / p["qty"])
            p["qty"] -= t["qty"]
        elif t["type"] == "split" and t["qty"]:
            p["qty"] += t["qty"]
        elif t["type"] == "dividend":
            p["dividends"] += abs(t["amount"])
    keep = [x for x in d["positions"] if x.get("account") != account or not x.get("auto")]
    for tick, p in pos.items():
        if p["qty"] <= 1e-9:
            continue
        old = next((x for x in d["positions"] if x.get("account") == account and x.get("ticker") == tick and x.get("auto")), {})
        keep.append({**old, "id": old.get("id") or uuid.uuid4().hex[:8], "auto": True, "account": account, "kind": old.get("kind") or "action",
                     "name": old.get("name") or tick, "ticker": tick, "symbol": old.get("symbol") or tick, "qty": round(p["qty"], 8),
                     "pru": round(p["cost"] / p["qty"], 4) if p["qty"] else None, "currency": p["currency"], "dividends": round(p["dividends"], 2)})
    d["positions"] = keep


# --- Crédits ----------------------------------------------------------------------------------------------------

def months_between(start, today=None):
    today = today or date.today()
    s = date.fromisoformat(start)
    return max(0, (today.year - s.year) * 12 + today.month - s.month - (1 if today.day < s.day else 0))


def loan_state(l, today=None):
    c, n = float(l.get("capital") or 0), int(l.get("months") or 0)
    r = float(l.get("rate") or 0) / 100 / 12
    if c <= 0 or n <= 0:
        return {}
    pay = c / n if r == 0 else c * r / (1 - (1 + r) ** -n)
    if l.get("payment"):  # mensualité du contrat si elle est connue (arrondis de la banque)
        pay = float(l["payment"])
    k = min(n, months_between(l["start"], today)) if l.get("start") else 0
    rest = max(0.0, c * (1 + r) ** k - pay * (((1 + r) ** k - 1) / r if r else k))
    ins = float(l.get("insurance") or 0)
    total_int = pay * n - c
    remaining_int = max(0.0, pay * (n - k) - rest)
    s = date.fromisoformat(l["start"]) if l.get("start") else date.today()
    end_m = s.month - 1 + n
    end = date(s.year + end_m // 12, end_m % 12 + 1, min(s.day, 28))
    yearly = []
    bal = c
    for m in range(1, n + 1):
        it = bal * r
        bal = max(0.0, bal - (pay - it))
        if m % 12 == 0 or m == n:
            yearly.append(round(bal, 2))
    return {"payment": round(pay, 2), "insurance": round(ins, 2), "monthly": round(pay + ins, 2), "paid_months": k, "left_months": n - k,
            "remaining": round(rest, 2), "progress": round((c - rest) / c * 100, 1), "interest_total": round(total_int, 2),
            "interest_left": round(remaining_int, 2), "insurance_left": round(ins * (n - k), 2), "end": end.isoformat(), "yearly": yearly, "done": k >= n}


# --- Synthèse ---------------------------------------------------------------------------------------------------

def valued(d):
    rates = fx_rates()
    cache = store.load("patrimoine/cours", {})
    out = []
    for p in d["positions"]:
        sym = p.get("symbol") or p.get("ticker")
        manual = p.get("price_manual")
        if manual not in (None, ""):
            price, cur, at = float(manual), p.get("currency") or "EUR", p.get("price_at")
        else:
            c = cache.get(sym) or {}
            price, cur, at = c.get("price"), c.get("currency") or p.get("currency") or "USD", c.get("at")
        qty = float(p.get("qty") or 0)
        value = price * qty if price is not None else None
        cost = (p.get("pru") or 0) * qty if p.get("pru") else None
        v_eur, c_eur = to_eur(value, cur, rates), to_eur(cost, p.get("currency") or cur, rates)
        out.append({**p, "price": price, "price_currency": cur, "price_at": at, "value": value, "value_eur": round(v_eur, 2) if v_eur is not None else None,
                    "cost_eur": round(c_eur, 2) if c_eur is not None else None,
                    "gain_eur": round(v_eur - c_eur, 2) if v_eur is not None and c_eur is not None else None,
                    "gain_pct": round((v_eur / c_eur - 1) * 100, 1) if v_eur and c_eur else None,
                    "locked": bool(p.get("available") and p["available"] > date.today().isoformat()), "quote_error": bool((cache.get(sym) or {}).get("error")) and manual in (None, "")})
    return out


def papers_taxes():
    """Taxes foncières trouvées dans Paperasse : [{year, amount, issuer, id, due, paid}]."""
    try:
        import paperasse
        docs = paperasse.load()["docs"].values()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for doc in docs:
        if doc.get("type") == "Taxe foncière":
            out.append({"id": doc["id"], "year": (doc.get("date") or doc.get("due") or "")[:4], "amount": doc.get("amount"), "due": doc.get("due"), "paid": doc.get("paid"),
                        "title": doc.get("title") or doc.get("name")})
    return sorted(out, key=lambda x: x["year"], reverse=True)


def income_month(user):
    """Revenus mensuels moyens (Budget, 3 derniers mois complets), sinon None."""
    try:
        import budget
        d = budget.load(user)
        if not d["tx"]:
            return None
        months = budget.months_back(4)[:-1]
        vals = [budget.summary(d, m)["income"] for m in months]
        vals = [v for v in vals if v > 0]
        return round(sum(vals) / len(vals), 2) if vals else None
    except Exception:  # noqa: BLE001
        return None


def loan_hints(user, loans):
    """Prélèvements de prêt repérés dans le Budget mais pas encore saisis ici."""
    try:
        import budget
        rec = budget.recurring(budget.load(user))
    except Exception:  # noqa: BLE001
        return []
    known = [float(l.get("payment") or loan_state(l).get("payment") or 0) for l in loans]
    out = []
    for r in rec:
        if r["active"] and r["period"] == "mois" and re.search(r"pret|credit|echeance|emprunt|cofidis|cetelem|sofinco|franfinance|oney|floa", budget.plain(r["label"])):
            if not any(abs(k - r["amount"]) < 2 for k in known):
                out.append({"label": r["name"], "amount": r["amount"], "since": r["first"]})
    return out


def overview(user):
    d = load(user)
    pos = valued(d)
    loans = [l | {"state": loan_state(l)} for l in d["loans"]]
    props = d["properties"]
    inv = sum(p["value_eur"] or 0 for p in pos)
    re_value = sum(float(p.get("value") or p.get("price") or 0) for p in props)
    debt = sum(l["state"].get("remaining", 0) for l in loans if l["state"])
    monthly_debt = sum(l["state"].get("monthly", 0) for l in loans if l["state"] and not l["state"].get("done"))
    taxes = papers_taxes()
    return {"positions": pos, "loans": loans, "properties": props, "projects": d["projects"], "imports": d["imports"][:5],
            "totals": {"investments": round(inv, 2), "real_estate": round(re_value, 2), "debt": round(debt, 2), "net": round(inv + re_value - debt, 2),
                       "monthly_debt": round(monthly_debt, 2), "locked": round(sum(p["value_eur"] or 0 for p in pos if p["locked"]), 2),
                       "gain": round(sum(p["gain_eur"] or 0 for p in pos), 2),
                       "dividends": round(sum(to_eur(p.get("dividends") or 0, p.get("currency")) or 0 for p in pos), 2)},
            "income": income_month(user), "taxes": taxes, "loan_hints": loan_hints(user, d["loans"]),
            "kinds": KINDS, "loan_kinds": LOAN_KINDS, "prop_kinds": PROP_KINDS}


# --- Routes -----------------------------------------------------------------------------------------------------

@bp.get("/api/patrimoine")
def get_all():
    return jsonify(overview(g.user["name"]))


@bp.post("/api/patrimoine/import")
def import_revolut():
    user = g.user["name"]
    f = request.files.get("file")
    if not f:
        raise ValueError("Choisis le relevé Revolut (CSV)")
    raw = f.read(10 * 1024 * 1024)
    text = next((raw.decode(enc) for enc in ("utf-8-sig", "cp1252") if _decodes(raw, enc)), raw.decode("utf-8", "replace"))
    trades = parse_revolut(text)
    account = (request.form.get("account") or "Revolut").strip()[:40]
    out = {}

    def go(d):
        seen = {(t["date"], t["ticker"], t["type"], t["qty"], t["amount"]) for t in d["trades"] if t.get("account") == account}
        new = [t | {"account": account} for t in trades if (t["date"], t["ticker"], t["type"], t["qty"], t["amount"]) not in seen]
        d["trades"] += new
        rebuild_positions(d, account)
        d["imports"].insert(0, {"at": time.time(), "file": (f.filename or "")[:80], "account": account, "added": len(new)})
        d["imports"] = d["imports"][:20]
        out.update(added=len(new), skipped=len(trades) - len(new), lines=len([p for p in d["positions"] if p.get("account") == account]))
    store.update(key(user), EMPTY, go)
    refresh_quotes(user, force=True)
    return jsonify(out)


def _decodes(raw, enc):
    try:
        raw.decode(enc)
        return True
    except UnicodeDecodeError:
        return False


def _clean_position(f, old=None):
    p = dict(old or {"id": uuid.uuid4().hex[:8]})
    for k, n in (("name", 80), ("ticker", 20), ("symbol", 24), ("isin", 12), ("account", 40), ("note", 400), ("currency", 3), ("doc", 40)):
        if k in f:
            p[k] = str(f[k] or "").strip()[:n]
    p["ticker"], p["symbol"] = p.get("ticker", "").upper(), p.get("symbol", "").upper()
    p["currency"] = (p.get("currency") or "EUR").upper()
    if f.get("kind") in KINDS:
        p["kind"] = f["kind"]
    for k in ("qty", "pru", "price_manual"):
        if k in f:
            p[k] = num(f[k])
    if "price_manual" in f:
        p["price_at"] = time.time() if p["price_manual"] is not None else None
    if "available" in f:
        a = str(f["available"] or "")[:10]
        if a:
            date.fromisoformat(a)
        p["available"] = a
    if not p.get("name"):
        raise ValueError("Donne un nom à la ligne (ex. Apple, Fonds PEE Actions)")
    if not p.get("qty"):
        raise ValueError("Indique la quantité (nombre d'actions ou de parts)")
    return p


@bp.post("/api/patrimoine/positions")
def add_position():
    user = g.user["name"]
    p = _clean_position(request.get_json(force=True))
    store.update(key(user), EMPTY, lambda d: d["positions"].append(p))
    refresh_quotes(user, force=True)
    return jsonify(p)


@bp.put("/api/patrimoine/positions/<pid>")
def edit_position(pid):
    user, f = g.user["name"], request.get_json(force=True)

    def go(d):
        p = next((x for x in d["positions"] if x["id"] == pid), None)
        if not p:
            raise ValueError("Ligne introuvable")
        p.update(_clean_position(f, p))
    store.update(key(user), EMPTY, go)
    refresh_quotes(user, force=True)
    return jsonify(ok=True)


@bp.delete("/api/patrimoine/positions/<pid>")
def del_position(pid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("positions", [x for x in d["positions"] if x["id"] != pid]))
    return jsonify(ok=True)


@bp.post("/api/patrimoine/quotes")
def quotes_now():
    n = refresh_quotes(g.user["name"], force=True)
    return jsonify(updated=n)


def _clean(f, fields, old=None):
    o = dict(old or {"id": uuid.uuid4().hex[:8]})
    for k, kind in fields.items():
        if k not in f:
            continue
        if kind == "num":
            o[k] = num(f[k])
        elif kind == "date":
            v = str(f[k] or "")[:10]
            if v:
                date.fromisoformat(v)
            o[k] = v
        else:
            o[k] = str(f[k] or "").strip()[:kind]
    return o


LOAN_FIELDS = {"name": 80, "lender": 60, "kind": 20, "capital": "num", "rate": "num", "months": "num", "start": "date", "insurance": "num", "payment": "num", "property": 20, "note": 400}
PROP_FIELDS = {"name": 80, "kind": 20, "city": 80, "surface": "num", "price": "num", "fees": "num", "works": "num", "bought": "date", "value": "num",
               "rent": "num", "charges": "num", "taxe_fonciere": "num", "pno": "num", "note": 400}


def _check_loan(l):
    if not l.get("name"):
        raise ValueError("Donne un nom au crédit (ex. Prêt appartement)")
    if not l.get("capital") or not l.get("months") or l.get("rate") is None or not l.get("start"):
        raise ValueError("Indique le montant emprunté, le taux, la durée et la date de début (voir l'offre de prêt ou le tableau d'amortissement)")
    if l["months"] > 480 or l["capital"] <= 0 or l["rate"] < 0 or l["rate"] > 30:
        raise ValueError("Valeurs du crédit invalides")
    l["months"] = int(l["months"])
    if l.get("kind") not in LOAN_KINDS:
        l["kind"] = "immo"
    return l


@bp.post("/api/patrimoine/loans")
def add_loan():
    l = _check_loan(_clean(request.get_json(force=True), LOAN_FIELDS))
    store.update(key(g.user["name"]), EMPTY, lambda d: d["loans"].append(l))
    return jsonify(l | {"state": loan_state(l)})


@bp.put("/api/patrimoine/loans/<lid>")
def edit_loan(lid):
    f = request.get_json(force=True)

    def go(d):
        l = next((x for x in d["loans"] if x["id"] == lid), None)
        if not l:
            raise ValueError("Crédit introuvable")
        l.update(_check_loan(_clean(f, LOAN_FIELDS, l)))
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/patrimoine/loans/<lid>")
def del_loan(lid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("loans", [x for x in d["loans"] if x["id"] != lid]))
    return jsonify(ok=True)


@bp.post("/api/patrimoine/properties")
def add_prop():
    p = _clean(request.get_json(force=True), PROP_FIELDS)
    if not p.get("name"):
        raise ValueError("Donne un nom au bien (ex. Appartement Lyon 3e)")
    store.update(key(g.user["name"]), EMPTY, lambda d: d["properties"].append(p))
    return jsonify(p)


@bp.put("/api/patrimoine/properties/<pid>")
def edit_prop(pid):
    f = request.get_json(force=True)

    def go(d):
        p = next((x for x in d["properties"] if x["id"] == pid), None)
        if not p:
            raise ValueError("Bien introuvable")
        p.update(_clean(f, PROP_FIELDS, p))
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/patrimoine/properties/<pid>")
def del_prop(pid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("properties", [x for x in d["properties"] if x["id"] != pid]))
    return jsonify(ok=True)


@bp.post("/api/patrimoine/projects")
def save_project():
    f = request.get_json(force=True)
    pr = {"id": f.get("id") or uuid.uuid4().hex[:8], "name": str(f.get("name") or "Projet")[:80],
          "inputs": {k: v for k, v in (f.get("inputs") or {}).items() if isinstance(v, (int, float, str)) and len(str(v)) < 40}, "at": time.time()}

    def go(d):
        d["projects"] = [p for p in d["projects"] if p["id"] != pr["id"]] + [pr]
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(pr)


@bp.delete("/api/patrimoine/projects/<pid>")
def del_project(pid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("projects", [x for x in d["projects"] if x["id"] != pid]))
    return jsonify(ok=True)


def count(user):
    return None
