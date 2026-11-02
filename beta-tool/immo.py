"""Outil « Immobilier » : préparer un achat et gérer une location.

- Annonces suivies : un lien (SeLoger, Leboncoin, PAP, Bien'ici, agence…) → prix, surface, ville ;
  revérifiées deux fois par jour, avec une alerte si le prix baisse.
- Prix du quartier : ventes réelles des dernières années (données publiques DVF de l'État),
  prix médian au m², par nombre de pièces, autour d'une adresse.
- Location : locataires, loyers reçus ou en retard (repérés dans le Budget), quittances en PDF
  envoyées par mail, révision annuelle avec l'indice IRL, état des lieux avec photos, dépôt de garantie.
- Déclaration : récapitulatif de l'année (loyers, charges, intérêts d'emprunt), micro ou réel, et les
  cases à remplir.

Les biens et les crédits sont ceux de l'outil Patrimoine."""

import csv
import io
import json
import math
import os
import re
import statistics
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from html import unescape

import requests
from flask import Blueprint, Response, g, jsonify, request, send_file

import activity
import store

bp = Blueprint("immo", __name__)
GEO_URL = os.environ.get("GEO_ADRESSE_URL", "https://api-adresse.data.gouv.fr/search/")
DVF_URL = os.environ.get("DVF_URL", "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/communes/{dep}/{code}.csv")
IRL_URL = os.environ.get("IRL_URL", "https://www.bdm.insee.fr/series/sdmx/data/SERIES_BDM/001515333")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Accept-Language": "fr-FR,fr;q=0.9"}
EMPTY = {"listings": [], "tenants": [], "payments": [], "edl": [], "works": {}, "landlord": {}}
ROOMS = ["Entrée", "Séjour", "Cuisine", "Chambre", "Salle de bain", "WC", "Balcon / terrasse", "Cave / parking"]
STATES = {"neuf": "Neuf", "bon": "Bon état", "usage": "État d'usage", "mauvais": "Mauvais état"}
MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def key(user):
    return "immo/" + re.sub(r"[^\w-]", "_", user)


def load(user):
    d = store.load(key(user), EMPTY)
    for k, v in EMPTY.items():
        d.setdefault(k, type(v)())
    return d


def num(v, default=None):
    import patrimoine
    return patrimoine.num(v, default)


def props(user):
    import patrimoine
    return patrimoine.load(user)


# --- Annonces -------------------------------------------------------------------------------------------------------

def _jsonld(html):
    out = []
    for blob in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            data = json.loads(unescape(blob.strip()))
        except ValueError:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                out.append(x)
                stack += [v for v in x.values() if isinstance(v, (dict, list))]
            elif isinstance(x, list):
                stack += x
    return out


def parse_listing(html, url=""):
    """Prix, surface, pièces, ville, titre et photo d'une page d'annonce (JSON-LD, Open Graph, puis texte)."""
    out = {}
    meta = lambda p: (re.search(rf'<meta[^>]+(?:property|name)=["\']{p}["\'][^>]+content=["\']([^"\']+)', html, re.I) or [None, None])[1]
    out["title"] = unescape(meta("og:title") or (re.search(r"<title>(.*?)</title>", html, re.S | re.I) or [None, ""])[1]).strip()[:160]
    out["image"] = meta("og:image")
    desc = unescape(meta("og:description") or meta("description") or "")
    for x in _jsonld(html):
        offers = x.get("offers")
        if isinstance(offers, list):
            offers = offers[0] if offers else None
        if isinstance(offers, dict) and offers.get("price") and not out.get("price"):
            out["price"] = num(offers["price"])
        if x.get("price") and not out.get("price"):
            out["price"] = num(x["price"])
        fs = x.get("floorSize")
        if fs and not out.get("surface"):
            out["surface"] = num(fs.get("value") if isinstance(fs, dict) else fs)
        if x.get("numberOfRooms") and not out.get("rooms"):
            out["rooms"] = num(x["numberOfRooms"].get("value") if isinstance(x["numberOfRooms"], dict) else x["numberOfRooms"])
        addr = x.get("address")
        if isinstance(addr, dict):
            out.setdefault("city", addr.get("addressLocality"))
            out.setdefault("postcode", addr.get("postalCode"))
    text = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I))))
    blob = " ".join([out.get("title") or "", desc, text[:20000]])
    if not out.get("price"):
        prices = [num(m) for m in re.findall(r"(\d{2,3}(?:[\s .]\d{3})+|\d{5,7})\s?(?:€|euros?)", blob)]
        prices = [p for p in prices if p and 15000 <= p <= 20000000]
        out["price"] = prices[0] if prices else None
    if not out.get("surface"):
        m = re.search(r"(\d{1,4}(?:[,.]\d{1,2})?)\s?m(?:²|2)\b", blob)
        out["surface"] = num(m[1]) if m else None
    if not out.get("rooms"):
        m = re.search(r"(\d{1,2})\s?pi[èe]ces?", blob, re.I) or re.search(r"\b[TF](\d)\b", blob)
        out["rooms"] = int(m[1]) if m else None
    if not out.get("postcode"):
        m = re.search(r"\b((?:0[1-9]|[1-8]\d|9[0-5]|2[AB])\d{3})\b[\s,-]*([A-ZÉÈ][\w'éèêàç-]+(?:[\s-][A-ZÉÈ][\w'éèêàç-]+)*)", blob)
        if m:
            out["postcode"] = m[1]
            out["city"] = out.get("city") or m[2]
    out["site"] = re.sub(r"^www\.", "", (re.match(r"https?://([^/]+)", url) or [None, ""])[1])
    return {k: v for k, v in out.items() if v not in (None, "")}


def fetch_listing(url):
    r = requests.get(url, headers=UA, timeout=20, allow_redirects=True)
    if r.status_code in (404, 410):
        return {"gone": True}
    if r.status_code >= 400:
        raise ValueError(f"Le site refuse la lecture automatique (HTTP {r.status_code}) : complète les infos à la main")
    raw = r.content[:3_000_000]
    try:
        html = raw.decode("utf-8")
    except UnicodeDecodeError:
        html = raw.decode(r.encoding or "cp1252", "replace")
    return parse_listing(html, url)


def check_listings(user, notify=True):
    def go(d):
        for l in d["listings"]:
            if l.get("status") not in (None, "active") or not l.get("url"):
                continue
            try:
                info = fetch_listing(l["url"])
            except (ValueError, requests.RequestException):
                continue
            l["checked"] = time.time()
            if info.get("gone"):
                l["status"] = "retiree"
                if notify:
                    activity.log(user, "immo", f"Annonce retirée : {l.get('title') or l['url']}", "#/immo/annonces")
                continue
            p = info.get("price")
            if p and l.get("price") and abs(p - l["price"]) >= 1:
                l["history"].append({"at": time.time(), "price": p})
                if p < l["price"] and notify:
                    activity.log(user, "immo", f"Baisse de prix : {l.get('title') or l.get('city') or 'annonce'} passe de {int(l['price']):,} € à {int(p):,} €".replace(",", " "),
                                 "#/immo/annonces", title="🏠 Baisse de prix")
                l["price"] = p
    store.update(key(user), EMPTY, go)


# --- Prix du quartier (DVF) -----------------------------------------------------------------------------------------

def geocode(q):
    r = requests.get(GEO_URL, params={"q": q, "limit": 1}, timeout=12).json()
    f = (r.get("features") or [None])[0]
    if not f:
        raise ValueError("Adresse ou ville introuvable")
    pr, (lon, lat) = f["properties"], f["geometry"]["coordinates"]
    return {"label": pr.get("label"), "citycode": pr.get("citycode"), "city": pr.get("city"), "type": pr.get("type"), "lat": lat, "lon": lon}


def _dvf_year(code, year):
    path = store.path("immo", "dvf", f"{code}-{year}.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 30 * 86400:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    dep = code[:3] if code.startswith("97") else code[:2]
    r = requests.get(DVF_URL.format(year=year, dep=dep, code=code), timeout=40)
    if r.status_code == 404:
        rows = None
    else:
        r.raise_for_status()
        rows = _dvf_parse(r.text)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    return rows


def _dvf_parse(text):
    """Ventes d'un seul logement (appartement ou maison) : [{date, type, surface, rooms, price, pm2, address, lat, lon}]."""
    muts = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("nature_mutation") != "Vente":
            continue
        m = muts.setdefault(r["id_mutation"], {"rows": [], "value": num(r.get("valeur_fonciere"))})
        m["rows"].append(r)
    out = []
    for m in muts.values():
        homes = [r for r in m["rows"] if r.get("type_local") in ("Appartement", "Maison")]
        if len(homes) != 1 or not m["value"]:
            continue
        r = homes[0]
        s = num(r.get("surface_reelle_bati"))
        if not s or s < 9:
            continue
        pm2 = m["value"] / s
        if not 300 <= pm2 <= 40000:
            continue
        out.append({"date": r["date_mutation"], "type": r["type_local"], "surface": s, "rooms": int(num(r.get("nombre_pieces_principales"), 0) or 0),
                    "price": m["value"], "pm2": round(pm2), "address": " ".join(x for x in (r.get("adresse_numero"), r.get("adresse_suffixe"), r.get("adresse_nom_voie")) if x).title(),
                    "lat": num(r.get("latitude")), "lon": num(r.get("longitude"))})
    return out


def _dist(a, b, c, d):
    p = math.pi / 180
    x = (math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2)
    return 12742000 * math.asin(math.sqrt(x))


def dvf(q, kind="Appartement", radius=None):
    loc = geocode(q)
    code = loc["citycode"]
    year = date.today().year
    sales, years = [], []
    for y in range(year - 1, year - 7, -1):
        try:
            rows = _dvf_year(code, y)
        except (requests.RequestException, ValueError):
            rows = None
        if rows is None:
            continue
        sales += rows
        years.append(y)
        if len(years) >= 3:
            break
    if not years:
        raise ValueError("Pas de données de ventes pour cette commune (ou le NAS n'a pas accès à data.gouv.fr)")
    precise = loc["type"] in ("housenumber", "street")
    radius = radius or (800 if precise else None)
    pick = [s for s in sales if s["type"] == kind]
    if radius:
        near = [s for s in pick if s["lat"] and s["lon"] and _dist(loc["lat"], loc["lon"], s["lat"], s["lon"]) <= radius]
        if len(near) >= 8:
            pick = near
        else:
            radius = None
    if not pick:
        raise ValueError(f"Aucune vente de type « {kind.lower()} » trouvée ici")
    vals = sorted(s["pm2"] for s in pick)
    q = statistics.quantiles(vals, n=4) if len(vals) >= 4 else [vals[0], statistics.median(vals), vals[-1]]
    by_rooms = {}
    for s in pick:
        k = str(min(s["rooms"], 5)) if s["rooms"] else "?"
        by_rooms.setdefault(k, []).append(s["pm2"])
    trend = {}
    for s in pick:
        trend.setdefault(s["date"][:4], []).append(s["pm2"])
    return {"place": loc["label"], "city": loc["city"], "radius": radius, "years": sorted(years), "count": len(pick), "median": round(statistics.median(vals)),
            "q1": round(q[0]), "q3": round(q[2]), "kind": kind,
            "by_rooms": {k: {"median": round(statistics.median(v)), "count": len(v)} for k, v in sorted(by_rooms.items())},
            "trend": {k: round(statistics.median(v)) for k, v in sorted(trend.items())},
            "recent": sorted(pick, key=lambda s: s["date"], reverse=True)[:20]}


# --- Location : loyers, quittances, IRL ------------------------------------------------------------------------------

def month_status(t, pays, month, today=None):
    today = today or date.today()
    due = (t.get("rent") or 0) + (t.get("charges") or 0)
    got = sum(p["amount"] for p in pays if p["tenant"] == t["id"] and p["month"] == month)
    y, m = int(month[:4]), int(month[5:7])
    pay_day = date(y, m, min(int(t.get("pay_day") or 5), 28))
    if got >= due - 1:
        return "paye", got
    if got > 0:
        return "partiel", got
    return ("retard" if today > pay_day + timedelta(days=5) else "attente"), got


def months_of(t, upto=None):
    upto = upto or date.today()
    s = date.fromisoformat(t["start"]) if t.get("start") else upto
    e = min(upto, date.fromisoformat(t["end"])) if t.get("end") else upto
    out, y, m = [], s.year, s.month
    while (y, m) <= (e.year, e.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def match_payments(user):
    """Loyers reçus repérés dans les relevés du Budget (même montant, mois courant ou précédent, nom du locataire ou « loyer »)."""
    try:
        import budget
        tx = [t for t in budget.load(user)["tx"] if t["amount"] > 0]
    except Exception:  # noqa: BLE001
        return 0
    n = 0

    def go(d):
        nonlocal n
        used = {p.get("tx") for p in d["payments"] if p.get("tx")}
        for t in d["tenants"]:
            if t.get("status") == "ended":
                continue
            due = (t.get("rent") or 0) + (t.get("charges") or 0)
            words = [w for w in budget.plain(t.get("name", "")).split() if len(w) >= 3]
            for month in months_of(t)[-3:]:
                if month_status(t, d["payments"], month)[0] == "paye":
                    continue
                for x in tx:
                    if x["id"] in used or abs(x["amount"] - due) > 1.01 or not (x["date"][:7] == month or (x["date"][:7] < month and x["date"] >= (date.fromisoformat(month + "-01") - timedelta(days=6)).isoformat())):
                        continue
                    lab = budget.plain(x["label"])
                    if any(w in lab for w in words) or "loyer" in lab:
                        d["payments"].append({"id": uuid.uuid4().hex[:8], "tenant": t["id"], "month": month, "amount": x["amount"], "date": x["date"], "source": "budget", "tx": x["id"]})
                        used.add(x["id"])
                        n += 1
                        break
    store.update(key(user), EMPTY, go)
    return n


def quittance_pdf(user, t, month, amount, paid_on):
    from fpdf import FPDF
    d = load(user)
    land = d["landlord"]
    prop = next((p for p in props(user)["properties"] if p["id"] == t.get("property")), {})
    y, m = int(month[:4]), int(month[5:7])
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.set_margins(20, 20, 20)
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if os.path.exists(font):
        pdf.add_font("dv", "", font)
        pdf.add_font("dv", "B", font.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf") if os.path.exists(font.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")) else font)
        F = "dv"
    else:
        F = "helvetica"
    pdf.set_font(F, "B", 18)
    pdf.cell(0, 12, f"Quittance de loyer — {MONTHS[m - 1]} {y}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font(F, "", 11)
    left = [("Bailleur", land.get("name") or user), ("Adresse", land.get("address") or "")]
    right = [("Locataire", t.get("name", "")), ("Logement loué", t.get("address") or prop.get("name", "") + (f", {prop['city']}" if prop.get("city") else ""))]
    for (a, b), (c, e) in zip(left, right):
        x = pdf.get_x(), pdf.get_y()
        pdf.set_font(F, "B", 10)
        pdf.cell(85, 6, a)
        pdf.cell(85, 6, c, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(F, "", 11)
        y0 = pdf.get_y()
        pdf.multi_cell(85, 6, b or "—")
        y1 = pdf.get_y()
        pdf.set_xy(105, y0)
        pdf.multi_cell(85, 6, e or "—")
        pdf.set_y(max(y1, pdf.get_y()) + 3)
        del x
    pdf.ln(4)
    rent, charges = t.get("rent") or 0, t.get("charges") or 0
    fmt = lambda v: f"{v:,.2f} €".replace(",", " ").replace(".", ",")
    pdf.set_font(F, "B", 11)
    pdf.cell(0, 8, f"Période : du 1er au {last} {MONTHS[m - 1]} {y}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(F, "", 11)
    for label, v in (("Loyer hors charges", rent), ("Provision pour charges", charges)):
        pdf.cell(120, 8, label, border="B")
        pdf.cell(50, 8, fmt(v), border="B", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(F, "B", 12)
    pdf.cell(120, 10, "Total reçu")
    pdf.cell(50, 10, fmt(amount), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.set_font(F, "", 11)
    pdf.multi_cell(0, 6, f"Je soussigné(e) {land.get('name') or user}, bailleur du logement désigné ci-dessus, déclare avoir reçu de {t.get('name', '')} "
                         f"la somme de {fmt(amount)} au titre du loyer et des charges pour la période du 1er au {last} {MONTHS[m - 1]} {y}, "
                         f"et lui en donne quittance, sous réserve de tous mes droits.")
    pdf.ln(6)
    when = date.fromisoformat(paid_on) if paid_on else date.today()
    pdf.cell(0, 6, f"Paiement reçu le {when.day} {MONTHS[when.month - 1]} {when.year}. Fait le {date.today().day} {MONTHS[date.today().month - 1]} {date.today().year}.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.cell(0, 6, land.get("name") or user, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(12)
    pdf.set_font(F, "", 8)
    pdf.multi_cell(0, 4, "Cette quittance annule tous les reçus qui auraient pu être donnés pour acomptes versés sur la période. "
                         "Le paiement de la présente n'emporte pas présomption de paiement des termes antérieurs.")
    return bytes(pdf.output())


def send_quittance(user, t, month):
    import accounts
    import mail
    import mailplus
    d = load(user)
    pays = [p for p in d["payments"] if p["tenant"] == t["id"] and p["month"] == month]
    if not pays:
        raise ValueError("Aucun paiement enregistré pour ce mois")
    if not t.get("email"):
        raise ValueError("Indique l'adresse mail du locataire")
    acc = next((a for a in accounts.of(user) if a.get("mail")), None)
    if not acc:
        raise ValueError("Ajoute d'abord une boîte mail (Réglages › Mails et agendas) pour envoyer la quittance")
    pdf = quittance_pdf(user, t, month, sum(p["amount"] for p in pays), max(p["date"] for p in pays))
    path = store.path("immo", "quittances", f"{t['id']}-{month}.pdf")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(pdf)
    y, m = int(month[:4]), int(month[5:7])
    name = f"Quittance {MONTHS[m - 1]} {y}.pdf"
    land = d["landlord"].get("name") or user
    mail.send_message(acc, {"to": t["email"], "subject": f"Quittance de loyer — {MONTHS[m - 1]} {y}",
                            "text": f"Bonjour,\n\nVeuillez trouver ci-joint la quittance de loyer pour {MONTHS[m - 1]} {y}.\n\nBien cordialement,\n{land}"},
                      [mailplus._Stored(path, name, "application/pdf")])

    def go(dd):
        for p in dd["payments"]:
            if p["tenant"] == t["id"] and p["month"] == month:
                p["sent"] = time.time()
    store.update(key(user), EMPTY, go)
    return True


def irl_values():
    """{« 2025-T2 » : valeur} de l'indice de référence des loyers (INSEE), gardé 7 jours."""
    c = store.load("immo/irl", {})
    if time.time() - c.get("at", 0) < 7 * 86400 and c.get("values"):
        return c["values"]
    try:
        xml = requests.get(IRL_URL, timeout=20).text
        vals = {f"{m[0][:4]}-T{m[0][-1]}": float(m[1]) for m in re.findall(r'TIME_PERIOD="(\d{4}-Q\d)"\s+OBS_VALUE="([\d.]+)"', xml)}
        if not vals:
            vals = {f"{m[1][:4]}-T{m[1][-1]}": float(m[0]) for m in re.findall(r'OBS_VALUE="([\d.]+)"[^>]*TIME_PERIOD="(\d{4}-Q\d)"', xml)}
    except (requests.RequestException, ValueError):
        vals = {}
    vals = {**c.get("manual", {}), **vals}
    if vals:
        store.update("immo/irl", {}, lambda x: x.update(at=time.time(), values=vals))
    return vals or c.get("values") or c.get("manual") or {}


def revision(t):
    """Nouveau loyer à la date anniversaire : loyer × IRL du même trimestre un an plus tard / IRL de référence."""
    ref = t.get("irl_quarter")
    if not ref or not t.get("irl_value"):
        return None
    vals = irl_values()
    y, q = int(ref[:4]), ref[-1]
    new_q = f"{y + 1}-T{q}"
    if new_q not in vals:
        return {"waiting": new_q}
    new = round(t["rent"] * vals[new_q] / t["irl_value"], 2)
    return {"quarter": new_q, "value": vals[new_q], "rent": new, "delta": round(new - t["rent"], 2)}


def deposit_deadline(t):
    """Restitution du dépôt : 1 mois après la remise des clés si l'état des lieux de sortie est conforme, 2 mois sinon."""
    if not t.get("end"):
        return None
    end = date.fromisoformat(t["end"])
    return {"conforme": (end + timedelta(days=30)).isoformat(), "reserves": (end + timedelta(days=61)).isoformat()}


# --- Déclaration -----------------------------------------------------------------------------------------------------

def loan_year(l, year):
    """(intérêts, assurance) payés sur un crédit pendant l'année."""
    c, n, r = float(l.get("capital") or 0), int(l.get("months") or 0), float(l.get("rate") or 0) / 1200
    if not c or not n or not l.get("start"):
        return 0.0, 0.0
    pay = float(l["payment"]) if l.get("payment") else (c / n if r == 0 else c * r / (1 - (1 + r) ** -n))
    s = date.fromisoformat(l["start"])
    bal, inter, months = c, 0.0, 0
    for k in range(n):
        y, m = s.year + (s.month - 1 + k) // 12, (s.month - 1 + k) % 12 + 1
        it = bal * r
        if y == year:
            inter += it
            months += 1
        bal -= pay - it
        if y > year:
            break
    return round(inter, 2), round(float(l.get("insurance") or 0) * months, 2)


def declaration(user, year):
    d = load(user)
    pat = props(user)
    out = []
    for p in pat["properties"]:
        tenants = [t for t in d["tenants"] if t.get("property") == p["id"]]
        if p.get("kind") != "locatif" and not tenants:
            continue
        furnished = any(t.get("furnished") for t in tenants)
        rents = 0.0
        for t in tenants:
            share = (t.get("rent") or 0) / max(1, (t.get("rent") or 0) + (t.get("charges") or 0))
            rents += sum(x["amount"] * share for x in d["payments"] if x["tenant"] == t["id"] and x["month"].startswith(str(year)))
        loans = [l for l in pat["loans"] if l.get("property") == p["id"]]
        inter = sum(loan_year(l, year)[0] for l in loans)
        ins = sum(loan_year(l, year)[1] for l in loans)
        works = float((d["works"].get(p["id"]) or {}).get(str(year)) or 0)
        charges = {"Taxe foncière (hors ordures ménagères)": p.get("taxe_fonciere") or 0, "Charges de copropriété non récupérables": p.get("charges") or 0,
                   "Assurance propriétaire (PNO)": p.get("pno") or 0, "Intérêts d'emprunt": inter, "Assurance emprunteur": ins,
                   "Travaux d'entretien et d'amélioration": works, "Frais de gestion (forfait)": 20}
        total = sum(charges.values())
        if furnished:
            micro = rents * .5
            regimes = {"micro": {"name": "Micro-BIC (meublé)", "taxable": round(micro), "box": "Case 5ND (recettes brutes) de la déclaration 2042-C-PRO", "amount": round(rents)},
                       "reel": {"name": "Réel (LMNP)", "taxable": None, "box": "Liasse 2031 et 2033, en général faite par un comptable ; l'amortissement du bien efface souvent l'impôt"}}
            best = "micro"
        else:
            micro = rents * .7
            reel = rents - total
            regimes = {"micro": {"name": "Micro-foncier", "taxable": round(micro), "box": "Case 4BE (loyers bruts) de la déclaration 2042", "amount": round(rents),
                                 "possible": rents <= 15000},
                       "reel": {"name": "Réel", "taxable": round(reel), "box": "Formulaire 2044, puis case 4BA (bénéfice) ou 4BB / 4BC (déficit) de la 2042"}}
            best = "reel" if reel < micro or rents > 15000 else "micro"
        out.append({"property": p["id"], "name": p["name"], "furnished": furnished, "rents": round(rents, 2), "charges": {k: round(v, 2) for k, v in charges.items()},
                    "total_charges": round(total, 2), "regimes": regimes, "best": best, "works": works})
    return out


# --- Boucle : annonces, loyers, révisions --------------------------------------------------------------------------

def loop():
    last_listings, last_day = 0, None
    while True:
        time.sleep(600)
        try:
            users = [n[:-5] for n in os.listdir(store.path("immo")) if n.endswith(".json") and n not in ("irl.json",)]
        except OSError:
            continue
        for user in users:
            try:
                if time.time() - last_listings > 12 * 3600:
                    check_listings(user)
                match_payments(user)
                today = date.today()
                if last_day != today and datetime.now().hour >= 9:
                    d = load(user)
                    for t in d["tenants"]:
                        if t.get("status") == "ended":
                            continue
                        month = today.isoformat()[:7]
                        st, _ = month_status(t, d["payments"], month)
                        pay_day = min(int(t.get("pay_day") or 5), 28)
                        if st == "retard" and today.day == pay_day + 6:
                            activity.log(user, "immo", f"Loyer de {MONTHS[today.month - 1]} pas encore reçu : {t.get('name')}", "#/immo/location", kind="err")
                        start = date.fromisoformat(t["start"]) if t.get("start") else None
                        if start and today.month == start.month and today.day == 1 and today.year > start.year:
                            activity.log(user, "immo", f"Révision annuelle du loyer possible pour {t.get('name')} (indice IRL)", "#/immo/location")
            except Exception as e:  # noqa: BLE001
                print("immo", user, e, flush=True)
        if time.time() - last_listings > 12 * 3600:
            last_listings = time.time()
        if datetime.now().hour >= 9:
            last_day = date.today()


def start():
    os.makedirs(store.path("immo"), exist_ok=True)
    import journee
    journee.SOURCES["rent"] = ("immo", tenants_brief)
    threading.Thread(target=loop, daemon=True).start()


# --- Routes ---------------------------------------------------------------------------------------------------------

@bp.get("/api/immo")
def overview():
    user = g.user["name"]
    match_payments(user)
    d = load(user)
    pat = props(user)
    tenants = []
    for t in d["tenants"]:
        months = months_of(t)[-12:]
        tenants.append(t | {"months": [{"month": m, "status": month_status(t, d["payments"], m)[0], "got": month_status(t, d["payments"], m)[1],
                                        "sent": any(p.get("sent") for p in d["payments"] if p["tenant"] == t["id"] and p["month"] == m)} for m in months],
                            "revision": revision(t), "deposit_deadline": deposit_deadline(t),
                            "edl": [e for e in d["edl"] if e["tenant"] == t["id"]]})
    return jsonify(listings=d["listings"], tenants=tenants, landlord=d["landlord"], properties=[{"id": p["id"], "name": p["name"], "city": p.get("city"), "kind": p.get("kind")} for p in pat["properties"]],
                   rooms=ROOMS, states=STATES, irl=dict(sorted(irl_values().items())[-8:]))


@bp.post("/api/immo/listings")
def add_listing():
    user, f = g.user["name"], request.get_json(force=True)
    url = str(f.get("url") or "").strip()
    info, warn = {}, None
    if url:
        if not re.match(r"https?://", url):
            raise ValueError("Colle le lien complet de l'annonce (https://…)")
        try:
            info = fetch_listing(url)
        except (ValueError, requests.RequestException) as e:
            warn = str(e) if isinstance(e, ValueError) else "Impossible d'ouvrir l'annonce : complète les infos à la main"
    l = {"id": uuid.uuid4().hex[:8], "url": url, "status": "active", "added": time.time(), "checked": time.time(), "note": "",
         **{k: info.get(k) for k in ("title", "price", "surface", "rooms", "city", "postcode", "image", "site")}}
    for k in ("price", "surface", "rooms", "rent", "charges", "tf"):
        if f.get(k) not in (None, ""):
            l[k] = num(f[k])
    for k in ("title", "city", "postcode", "address"):
        if f.get(k):
            l[k] = str(f[k])[:120]
    l["history"] = [{"at": time.time(), "price": l["price"]}] if l.get("price") else []
    store.update(key(user), EMPTY, lambda d: d["listings"].insert(0, l))
    return jsonify(listing=l, warning=warn if not l.get("price") else None)


@bp.put("/api/immo/listings/<lid>")
def edit_listing(lid):
    user, f = g.user["name"], request.get_json(force=True)

    def go(d):
        l = next((x for x in d["listings"] if x["id"] == lid), None)
        if not l:
            raise ValueError("Annonce introuvable")
        for k in ("price", "surface", "rooms", "rent", "charges", "tf"):
            if k in f:
                v = num(f[k])
                if k == "price" and v and l.get("price") != v:
                    l.setdefault("history", []).append({"at": time.time(), "price": v})
                l[k] = v
        for k, n in (("title", 160), ("city", 80), ("postcode", 5), ("address", 160), ("note", 1000)):
            if k in f:
                l[k] = str(f[k] or "")[:n]
        if f.get("status") in ("active", "retiree", "visite", "offre", "achete", "abandon"):
            l["status"] = f["status"]
    store.update(key(user), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/immo/listings/<lid>")
def del_listing(lid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("listings", [x for x in d["listings"] if x["id"] != lid]))
    return jsonify(ok=True)


@bp.post("/api/immo/listings/check")
def check_now():
    check_listings(g.user["name"])
    return jsonify(ok=True)


@bp.get("/api/immo/dvf")
def dvf_route():
    q = (request.args.get("q") or "").strip()
    if len(q) < 3:
        raise ValueError("Indique une adresse, un quartier ou une ville")
    kind = "Maison" if request.args.get("kind") == "Maison" else "Appartement"
    try:
        return jsonify(dvf(q, kind, int(request.args["radius"]) if request.args.get("radius") else None))
    except requests.RequestException:
        raise ValueError("Impossible de joindre data.gouv.fr depuis le NAS") from None


TENANT_FIELDS = {"name": 80, "email": 120, "phone": 30, "property": 20, "address": 200, "start": "date", "end": "date", "rent": "num", "charges": "num",
                 "deposit": "num", "pay_day": "num", "irl_quarter": 7, "irl_value": "num", "note": 500, "deposit_returned": "num", "deposit_returned_on": "date"}


def _clean_tenant(f, old=None):
    t = dict(old or {"id": uuid.uuid4().hex[:8], "status": "active"})
    for k, kind in TENANT_FIELDS.items():
        if k not in f:
            continue
        if kind == "num":
            t[k] = num(f[k])
        elif kind == "date":
            v = str(f[k] or "")[:10]
            if v:
                date.fromisoformat(v)
            t[k] = v
        else:
            t[k] = str(f[k] or "").strip()[:kind]
    for k in ("furnished", "auto_send"):
        if k in f:
            t[k] = bool(f[k])
    if f.get("status") in ("active", "ended"):
        t["status"] = f["status"]
    if not t.get("name") or not t.get("rent") or not t.get("start"):
        raise ValueError("Indique le nom du locataire, le loyer et la date d'entrée")
    return t


@bp.post("/api/immo/tenants")
def add_tenant():
    t = _clean_tenant(request.get_json(force=True))
    store.update(key(g.user["name"]), EMPTY, lambda d: d["tenants"].append(t))
    return jsonify(t)


@bp.put("/api/immo/tenants/<tid>")
def edit_tenant(tid):
    f = request.get_json(force=True)

    def go(d):
        t = next((x for x in d["tenants"] if x["id"] == tid), None)
        if not t:
            raise ValueError("Locataire introuvable")
        if f.get("apply_revision"):
            r = revision(t)
            if not r or not r.get("rent"):
                raise ValueError("Indice IRL du trimestre pas encore publié")
            t.update(rent=r["rent"], irl_quarter=r["quarter"], irl_value=r["value"])
            t.setdefault("history", []).append({"at": time.time(), "rent": r["rent"], "irl": r["quarter"]})
        else:
            t.update(_clean_tenant(f, t))
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/immo/tenants/<tid>")
def del_tenant(tid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.update(tenants=[x for x in d["tenants"] if x["id"] != tid], payments=[p for p in d["payments"] if p["tenant"] != tid]))
    return jsonify(ok=True)


@bp.post("/api/immo/tenants/<tid>/payments")
def add_payment(tid):
    user, f = g.user["name"], request.get_json(force=True)
    month = str(f.get("month") or "")[:7]
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("Mois invalide")
    d = load(user)
    t = next((x for x in d["tenants"] if x["id"] == tid), None)
    if not t:
        raise ValueError("Locataire introuvable")
    amount = num(f.get("amount")) or (t.get("rent") or 0) + (t.get("charges") or 0)
    p = {"id": uuid.uuid4().hex[:8], "tenant": tid, "month": month, "amount": amount, "date": str(f.get("date") or date.today().isoformat())[:10], "source": "manuel"}
    store.update(key(user), EMPTY, lambda x: x["payments"].append(p))
    sent = False
    if t.get("auto_send") and t.get("email"):
        try:
            sent = send_quittance(user, t, month)
        except Exception:  # noqa: BLE001
            sent = False
    return jsonify(payment=p, sent=sent)


@bp.delete("/api/immo/tenants/<tid>/payments/<month>")
def del_payment(tid, month):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("payments", [p for p in d["payments"] if not (p["tenant"] == tid and p["month"] == month)]))
    return jsonify(ok=True)


@bp.get("/api/immo/tenants/<tid>/quittance/<month>")
def get_quittance(tid, month):
    user = g.user["name"]
    d = load(user)
    t = next((x for x in d["tenants"] if x["id"] == tid), None)
    pays = [p for p in d["payments"] if p["tenant"] == tid and p["month"] == month]
    if not t or not pays:
        raise ValueError("Aucun paiement enregistré pour ce mois")
    pdf = quittance_pdf(user, t, month, sum(p["amount"] for p in pays), max(p["date"] for p in pays))
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": f'inline; filename="quittance-{month}.pdf"'})


@bp.post("/api/immo/tenants/<tid>/quittance/<month>/send")
def mail_quittance(tid, month):
    user = g.user["name"]
    t = next((x for x in load(user)["tenants"] if x["id"] == tid), None)
    if not t:
        raise ValueError("Locataire introuvable")
    send_quittance(user, t, month)
    return jsonify(ok=True)


@bp.put("/api/immo/landlord")
def set_landlord():
    f = request.get_json(force=True)
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("landlord", {"name": str(f.get("name") or "")[:80], "address": str(f.get("address") or "")[:200]}))
    return jsonify(ok=True)


@bp.put("/api/immo/irl")
def set_irl():
    """Valeurs de l'IRL saisies à la main ({« 2025-T2 » : 146.68}) si l'INSEE n'est pas joignable."""
    f = request.get_json(force=True)
    vals = {k: float(num(v)) for k, v in (f or {}).items() if re.fullmatch(r"\d{4}-T[1-4]", k) and num(v)}
    store.update("immo/irl", {}, lambda x: x.update(manual={**x.get("manual", {}), **vals}, values={**x.get("values", {}), **vals}))
    return jsonify(ok=True)


# État des lieux

@bp.post("/api/immo/tenants/<tid>/edl")
def add_edl(tid):
    user, f = g.user["name"], request.get_json(force=True)
    e = {"id": uuid.uuid4().hex[:8], "tenant": tid, "type": "sortie" if f.get("type") == "sortie" else "entree", "date": str(f.get("date") or date.today().isoformat())[:10],
         "rooms": [{"name": r, "state": "bon", "note": "", "photos": []} for r in (f.get("rooms") or ROOMS)], "meters": {"elec": "", "gaz": "", "eau": ""}, "keys": "", "note": ""}
    store.update(key(user), EMPTY, lambda d: d["edl"].append(e))
    return jsonify(e)


@bp.put("/api/immo/edl/<eid>")
def edit_edl(eid):
    user, f = g.user["name"], request.get_json(force=True)

    def go(d):
        e = next((x for x in d["edl"] if x["id"] == eid), None)
        if not e:
            raise ValueError("État des lieux introuvable")
        if isinstance(f.get("rooms"), list):
            old = {r["name"]: r for r in e["rooms"]}
            e["rooms"] = [{"name": str(r.get("name", ""))[:60], "state": r.get("state") if r.get("state") in STATES else "bon", "note": str(r.get("note", ""))[:1000],
                           "photos": old.get(r.get("name"), {}).get("photos", [])} for r in f["rooms"]]
        if isinstance(f.get("meters"), dict):
            e["meters"] = {k: str(f["meters"].get(k, ""))[:30] for k in ("elec", "gaz", "eau")}
        for k in ("keys", "note", "date"):
            if k in f:
                e[k] = str(f[k] or "")[:1000]
    store.update(key(user), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/immo/edl/<eid>")
def del_edl(eid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("edl", [x for x in d["edl"] if x["id"] != eid]))
    return jsonify(ok=True)


@bp.post("/api/immo/edl/<eid>/photo")
def edl_photo(eid):
    from PIL import Image, ImageOps
    user = g.user["name"]
    room = request.form.get("room", "")
    f = request.files.get("photo")
    if not f:
        raise ValueError("Choisis une photo")
    im = ImageOps.exif_transpose(Image.open(f.stream)).convert("RGB")
    im.thumbnail((1600, 1600))
    pid = uuid.uuid4().hex[:10]
    path = store.path("immo", "edl", eid, pid + ".jpg")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "JPEG", quality=85)

    def go(d):
        e = next(x for x in d["edl"] if x["id"] == eid)
        r = next((x for x in e["rooms"] if x["name"] == room), None)
        if r is None:
            raise ValueError("Pièce introuvable")
        r["photos"].append(pid)
    store.update(key(user), EMPTY, go)
    return jsonify(id=pid)


@bp.get("/api/immo/edl/<eid>/photo/<pid>")
def edl_photo_get(eid, pid):
    user = g.user["name"]
    if not any(e["id"] == eid for e in load(user)["edl"]):
        return jsonify(error="Introuvable"), 404
    path = store.path("immo", "edl", re.sub(r"\W", "", eid), re.sub(r"\W", "", pid) + ".jpg")
    return send_file(path, mimetype="image/jpeg", max_age=86400)


@bp.get("/api/immo/edl/<eid>/pdf")
def edl_pdf(eid):
    from fpdf import FPDF
    user = g.user["name"]
    d = load(user)
    e = next((x for x in d["edl"] if x["id"] == eid), None)
    if not e:
        raise ValueError("État des lieux introuvable")
    t = next((x for x in d["tenants"] if x["id"] == e["tenant"]), {})
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    F = "helvetica"
    if os.path.exists(font):
        pdf.add_font("dv", "", font)
        pdf.add_font("dv", "B", font.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf") if os.path.exists(font.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf")) else font)
        F = "dv"
    pdf.set_font(F, "B", 16)
    kind = "de sortie" if e["type"] == "sortie" else "d'entrée"
    pdf.cell(0, 10, f"État des lieux {kind} — {e['date']}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(F, "", 10)
    pdf.multi_cell(0, 5, f"Bailleur : {d['landlord'].get('name') or user}\nLocataire : {t.get('name', '')}\nLogement : {t.get('address', '')}\n"
                         f"Compteurs : électricité {e['meters'].get('elec') or '—'} · gaz {e['meters'].get('gaz') or '—'} · eau {e['meters'].get('eau') or '—'}\nClés remises : {e.get('keys') or '—'}")
    for r in e["rooms"]:
        pdf.ln(3)
        pdf.set_font(F, "B", 12)
        pdf.cell(0, 7, f"{r['name']} — {STATES.get(r['state'], r['state'])}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(F, "", 10)
        if r.get("note"):
            pdf.multi_cell(0, 5, r["note"])
        x0 = pdf.get_x()
        for i, pid in enumerate(r.get("photos", [])[:6]):
            path = store.path("immo", "edl", eid, pid + ".jpg")
            if os.path.exists(path):
                if pdf.get_y() > 230:
                    pdf.add_page()
                pdf.image(path, x=x0 + (i % 3) * 60, y=pdf.get_y(), w=56)
                if i % 3 == 2 or i == len(r["photos"][:6]) - 1:
                    pdf.ln(44)
    pdf.ln(8)
    pdf.set_font(F, "", 10)
    pdf.multi_cell(0, 5, (e.get("note") or "") + "\n\nSignature du bailleur :                                      Signature du locataire :")
    return Response(bytes(pdf.output()), mimetype="application/pdf", headers={"Content-Disposition": f'inline; filename="etat-des-lieux-{e["date"]}.pdf"'})


@bp.get("/api/immo/declaration")
def declaration_route():
    year = int(request.args.get("year") or date.today().year - 1)
    return jsonify(year=year, properties=declaration(g.user["name"], year))


@bp.put("/api/immo/works")
def set_works():
    f = request.get_json(force=True)
    pid, year = str(f.get("property") or ""), str(f.get("year") or "")
    store.update(key(g.user["name"]), EMPTY, lambda d: d["works"].setdefault(pid, {}).__setitem__(year, num(f.get("amount"), 0)))
    return jsonify(ok=True)


def tenants_brief(user, today):
    """Pour Ma journée : loyers en retard."""
    d = load(user)
    out = []
    for t in d["tenants"]:
        if t.get("status") == "ended":
            continue
        st, _ = month_status(t, d["payments"], today.isoformat()[:7], today)
        if st == "retard":
            out.append({"text": f"Loyer de {t['name']} en retard", "sub": f"{(t.get('rent') or 0) + (t.get('charges') or 0):.0f} € attendus", "late": True, "link": "#/immo/location"})
    return out
