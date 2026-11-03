"""Outil « Suivi des prix » : l'historique des prix des produits que tu regardes, des alertes de baisse
et la comparaison avec les autres boutiques.

- L'extension de navigateur envoie le prix de chaque fiche produit visitée (ou seulement des produits
  suivis, au choix) : l'historique se construit au fil des visites, sur le NAS.
- Produits suivis : revérifiés chaque jour (par le NAS, ou par l'extension si le site bloque le NAS),
  avec une alerte quand le prix baisse ou passe sous ton prix cible.
- Comparaison : la même référence (code EAN, sinon le nom) cherchée chez d'autres boutiques
  (Amazon, Fnac, Darty, Boulanger, Cdiscount, LDLC…). La recherche passe de préférence par ton
  navigateur (moins souvent bloquée), le NAS lit les pages et garde les résultats.

Données : DATA_DIR/prix/<compte>.json."""

import html as htmllib
import json
import re
import threading
import time
import unicodedata
import uuid
from datetime import date, timedelta
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlparse, urlunparse

import requests
from flask import Blueprint, g, jsonify, request

import activity
import store

bp = Blueprint("prix", __name__)
EMPTY = {"products": [], "shops": None, "settings": {}}
DEFAULTS = {"record_all": True, "notify_drop": True, "min_drop_pct": 1}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
MAX_PRODUCTS = 3000
TRACKING = re.compile(r"^(utm_|gclid|fbclid|msclkid|ref|ref_|tag|psc|th|smid|spm|_ga|mc_|awc|affid|cm_|origin|xtor|ectrans)", re.I)

# Boutiques pour la comparaison : recherche ({q} = EAN ou nom) et forme des liens de fiche produit
SHOPS = [
    {"id": "amazon", "name": "Amazon", "host": "amazon.fr", "search": "https://www.amazon.fr/s?k={q}", "product": r"/dp/[A-Z0-9]{10}"},
    {"id": "fnac", "name": "Fnac", "host": "fnac.com", "search": "https://www.fnac.com/SearchResult/ResultList.aspx?Search={q}", "product": r"fnac\.com/(?:[\w-]+/)?a\d+/"},
    {"id": "darty", "name": "Darty", "host": "darty.com", "search": "https://www.darty.com/nav/recherche?text={q}", "product": r"darty\.com/nav/achat/.+\.html"},
    {"id": "boulanger", "name": "Boulanger", "host": "boulanger.com", "search": "https://www.boulanger.com/resultats?tr={q}", "product": r"boulanger\.com/ref/\d+"},
    {"id": "cdiscount", "name": "Cdiscount", "host": "cdiscount.com", "search": "https://www.cdiscount.com/search/10/{q}.html", "product": r"cdiscount\.com/.+/f-\d+-[\w-]+\.html"},
    {"id": "ldlc", "name": "LDLC", "host": "ldlc.com", "search": "https://www.ldlc.com/recherche/{q}/", "product": r"ldlc\.com/fiche/PB\d+\.html"},
    {"id": "rakuten", "name": "Rakuten", "host": "rakuten.com", "search": "https://fr.shopping.rakuten.com/search/{q}", "product": r"rakuten\.com/(?:offer/buy|mfp)/\d+"},
    {"id": "leclerc", "name": "E.Leclerc", "host": "e.leclerc", "search": "https://www.e.leclerc/recherche?q={q}", "product": r"e\.leclerc/fp/"},
    {"id": "carrefour", "name": "Carrefour", "host": "carrefour.fr", "search": "https://www.carrefour.fr/s?q={q}", "product": r"carrefour\.fr/p/"},
    {"id": "decathlon", "name": "Decathlon", "host": "decathlon.fr", "search": "https://www.decathlon.fr/search?Ntt={q}", "product": r"decathlon\.fr/p/"},
]
# Comparateurs à ouvrir dans un onglet (pas de lecture automatique)
COMPARATORS = [("Idealo", "https://www.idealo.fr/prechcat.html?q={q}"), ("LeDénicheur", "https://ledenicheur.fr/search?search={q}"),
               ("Google Shopping", "https://www.google.com/search?tbm=shop&q={q}")]


def key(user):
    return "prix/" + user


def load(user):
    d = store.load(key(user), EMPTY)
    for k, v in EMPTY.items():
        if d.get(k) is None and v is not None:
            d[k] = type(v)()
    return d


def settings_of(d):
    return {**DEFAULTS, **(d.get("settings") or {})}


def shops_of(d):
    """Boutiques de comparaison : celles par défaut (activables) et celles ajoutées."""
    conf = d.get("shops") or {}
    out = [{**s, "on": conf.get(s["id"], {}).get("on", True), "custom": False} for s in SHOPS]
    out += [{**s, "custom": True} for s in conf.get("_custom", [])]
    return out


# --- Lecture d'une fiche produit ------------------------------------------------------------------

def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").lower()) if unicodedata.category(c) != "Mn")


def to_price(v):
    """« 1 234,56 € », « 1,234.56 », « 12.99 », 12.99 → float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    s = re.sub(r"[^\d,.]", "", str(v).replace(" ", "").replace(" ", ""))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if len(s.split(",")[-1]) <= 2 else s.replace(",", "")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        p = float(s)
    except ValueError:
        return None
    return p if 0 < p < 10_000_000 else None


def clean_url(url):
    """Lien sans paramètres de suivi ; Amazon ramené à /dp/<ASIN>."""
    u = urlparse(url)
    host = u.netloc.lower()
    m = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", u.path)
    if "amazon." in host and m:
        return f"https://{host}/dp/{m[1]}"
    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urlunparse((u.scheme or "https", host, u.path, "", urlencode(q), ""))


def shop_name(url, shops=None):
    """Nom de la boutique : d'après la forme des liens produit des boutiques connues, sinon le nom de domaine."""
    for s in shops or SHOPS:
        try:
            if re.search(s["product"], url):
                return s["name"]
        except re.error:
            pass
    host = urlparse(url).netloc.lower().removeprefix("www.")
    s = next((s for s in SHOPS if host.endswith(s["host"])), None)
    return s["name"] if s else host


def _walk(node):
    if isinstance(node, list):
        for x in node:
            yield from _walk(x)
    elif isinstance(node, dict):
        yield node
        for k in ("@graph", "hasVariant", "mainEntity", "itemListElement", "item"):
            if k in node:
                yield from _walk(node[k])


def _types(n):
    t = n.get("@type")
    return {str(x).lower() for x in (t if isinstance(t, list) else [t])}


def _first(v):
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        v = v.get("url") or v.get("name") or v.get("@id")
    return htmllib.unescape(str(v)).strip() if v else None


def _offer_price(offers):
    """(prix, devise, disponible) depuis Offer / AggregateOffer / liste d'offres."""
    best = None
    for o in _walk(offers):
        ps = o.get("priceSpecification")
        ps = (ps[0] if ps else {}) if isinstance(ps, list) else ps if isinstance(ps, dict) else {}
        p = to_price(o.get("price") or o.get("lowPrice") or ps.get("price"))
        if p is None:
            continue
        avail = str(o.get("availability") or "").lower()
        cand = (p, o.get("priceCurrency") or "EUR", not any(w in avail for w in ("outofstock", "discontinued", "soldout")))
        if best is None or (cand[2] and not best[2]) or (cand[2] == best[2] and p < best[0]):
            best = cand
    return best


def _meta(html, *names):
    for n in names:
        m = re.search(r'<meta[^>]+(?:property|name|itemprop)=["\']' + re.escape(n) + r'["\'][^>]*content=["\']([^"\']+)', html, re.I) \
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name|itemprop)=["\']' + re.escape(n) + r'["\']', html, re.I)
        if m:
            return htmllib.unescape(m[1]).strip()
    return None


def parse_product(html, url=""):
    """Nom, prix, EAN, marque, image d'une fiche produit (JSON-LD, puis microdonnées et balises meta, cas Amazon)."""
    out = {}
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I):
        raw = m[1].strip().removeprefix("<!--").removesuffix("-->").strip()
        try:
            data = json.loads(raw)
        except ValueError:
            try:
                data = json.loads(re.sub(r"[\x00-\x1f]", " ", raw))
            except ValueError:
                continue
        for n in _walk(data):
            if not (_types(n) & {"product", "productgroup", "individualproduct"}):
                continue
            out.setdefault("title", _first(n.get("name")))
            out.setdefault("image", _first(n.get("image")))
            out.setdefault("brand", _first(n.get("brand")))
            for k in ("gtin13", "gtin", "gtin14", "gtin12", "gtin8", "ean"):
                if n.get(k) and not out.get("gtin"):
                    out["gtin"] = re.sub(r"\D", "", str(n[k])) or None
            out.setdefault("mpn", _first(n.get("mpn")))
            out.setdefault("sku", _first(n.get("sku")))
            op = _offer_price(n.get("offers"))
            if op and not out.get("price"):
                out["price"], out["currency"], out["available"] = op
    host = urlparse(url).netloc.lower()
    if "amazon." in host:
        t = re.search(r'id=["\']productTitle["\'][^>]*>\s*(.*?)\s*</span>', html, re.S)
        if t and not out.get("title"):
            out["title"] = htmllib.unescape(re.sub(r"\s+", " ", t[1])).strip()
        if not out.get("price"):
            zone = re.search(r'(?:corePrice(?:Display)?_(?:desktop_)?feature_div|apex_desktop|priceToPay).{0,4000}', html, re.S)
            p = re.search(r'class=["\']a-offscreen["\'][^>]*>([^<]+)<', zone[0] if zone else html)
            if p:
                out["price"], out["currency"] = to_price(htmllib.unescape(p[1])), "EUR"
        a = re.search(r"/dp/([A-Z0-9]{10})", url) or re.search(r'name=["\']ASIN["\'][^>]*value=["\']([A-Z0-9]{10})', html)
        if a:
            out["asin"] = a[1]
        if "price" in out and "available" not in out:
            out["available"] = not re.search(r'id=["\']outOfStock["\']', html)
        img = re.search(r'id=["\']landingImage["\'][^>]+(?:data-old-hires|src)=["\']([^"\']+)', html)
        if img and not out.get("image"):
            out["image"] = img[1]
    if not out.get("price"):
        p = _meta(html, "product:price:amount", "og:price:amount", "price") \
            or (re.search(r'itemprop=["\']price["\'][^>]*content=["\']([^"\']+)', html) or [None, None])[1]
        if p:
            out["price"] = to_price(p)
            out["currency"] = _meta(html, "product:price:currency", "og:price:currency", "priceCurrency") or "EUR"
    out.setdefault("title", None)
    if not out["title"]:
        out["title"] = _meta(html, "og:title") or (re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I) or [None, None])[1]
        out["title"] = htmllib.unescape(re.sub(r"\s+", " ", out["title"] or "")).strip() or None
    if not out.get("image"):
        out["image"] = _meta(html, "og:image")
    if out.get("image"):
        out["image"] = urljoin(url, out["image"])
    out.setdefault("available", True)
    out["currency"] = (out.get("currency") or "EUR").upper()[:3]
    return out if out.get("price") else None


def search_candidates(html, base, pattern, limit=3):
    """Liens de fiches produit trouvés dans une page de résultats de recherche."""
    seen, out = set(), []
    rx = re.compile(pattern)
    for m in re.finditer(r'href=["\']([^"\'#]+)', html):
        u = urljoin(base, htmllib.unescape(m[1]))
        if not u.startswith("http") or not rx.search(u):
            continue
        c = clean_url(u)
        if c not in seen:
            seen.add(c)
            out.append(c)
        if len(out) >= limit:
            break
    return out


STOP = {"de", "du", "des", "la", "le", "les", "et", "en", "pour", "avec", "sans", "un", "une", "the", "and", "for", "with", "noir", "blanc", "gris"}


def tokens(s):
    return [t for t in re.findall(r"[a-z0-9]+", fold(s)) if len(t) >= 2 and t not in STOP]


def same_product(prod, info):
    """La fiche trouvée correspond-elle au produit ? Même EAN, sinon nom très proche (références identiques)."""
    g1, g2 = (prod.get("gtin") or "").lstrip("0"), (info.get("gtin") or "").lstrip("0")
    if g1 and g2:
        return g1 == g2
    a, b = set(tokens(prod.get("title"))), set(tokens(info.get("title")))
    if not a or not b:
        return False
    refs = {t for t in a if re.search(r"\d", t) and re.search(r"[a-z]", t) or len(t) >= 4 and t.isdigit()}
    if refs and not refs <= b:
        return False
    return len(a & b) / len(a) >= 0.6


def query_of(prod):
    if prod.get("gtin"):
        return prod["gtin"]
    words = tokens(prod.get("title"))
    brand = tokens(prod.get("brand"))
    q = (brand[:1] + [w for w in words if w not in brand])[:7]
    return " ".join(q)


# --- Données ------------------------------------------------------------------------------------

def _find(d, url=None, gtin=None, pid=None):
    for p in d["products"]:
        if pid and p["id"] == pid:
            return p, None
        for o in p["offers"]:
            if url and o["url"] == url:
                return p, o
    if gtin:
        g0 = gtin.lstrip("0")
        for p in d["products"]:
            if (p.get("gtin") or "").lstrip("0") == g0:
                return p, None
    return None, None


def _record(user, d, p, o, price, available, source):
    """Met à jour le prix d'une offre ; alerte si le produit est suivi et que le prix baisse."""
    today = date.today().isoformat()
    old = o.get("price")
    o.update(price=price, available=available, checked=time.time(), source=source, error=None)
    h = o.setdefault("history", [])
    if h and h[-1][0] == today:
        h[-1][1] = min(h[-1][1], price) if source != "page" else price
    else:
        h.append([today, price])
    del h[:-730]
    if not p.get("followed") or old is None or price >= old:
        return
    conf = settings_of(d)
    tgt = p.get("target")
    if tgt and price <= tgt and (old > tgt):
        activity.log(user, "prix", f"{p['title'][:70]} : {eur(price)} chez {o['shop']}, sous ton prix cible ({eur(tgt)})", f"#/prix/{p['id']}", title="💸 Prix cible atteint")
    elif conf["notify_drop"] and (old - price) / old * 100 >= conf["min_drop_pct"]:
        activity.log(user, "prix", f"{p['title'][:70]} : {eur(old)} → {eur(price)} chez {o['shop']}", f"#/prix/{p['id']}", title="💸 Baisse de prix")


def eur(n):
    return f"{n:,.2f} €".replace(",", " ").replace(".", ",").replace(",00 €", " €")


def seen(user, url, info, follow=False, source="page"):
    """Une fiche produit vue (extension) ou relue : crée ou met à jour le produit et l'offre."""
    url = clean_url(url)
    price = to_price(info.get("price"))
    if not price:
        raise ValueError("Pas de prix sur cette page")
    out = {}

    def go(d):
        conf = settings_of(d)
        p, o = _find(d, url=url, gtin=info.get("gtin"))
        if not p:
            if not (follow or conf["record_all"]):
                out["skipped"] = True
                return
            p = {"id": uuid.uuid4().hex[:8], "title": (info.get("title") or url)[:200], "image": info.get("image"), "brand": info.get("brand"),
                 "gtin": info.get("gtin"), "mpn": info.get("mpn"), "asin": info.get("asin"), "followed": False, "target": None,
                 "created": time.time(), "offers": []}
            d["products"].insert(0, p)
        for k in ("image", "brand", "gtin", "mpn", "asin"):
            if info.get(k) and not p.get(k):
                p[k] = info[k]
        if follow:
            p["followed"] = True
        if not o:
            o = {"id": uuid.uuid4().hex[:8], "url": url, "shop": shop_name(url, shops_of(d)), "history": [], "added": time.time()}
            p["offers"].append(o)
        p["seen"] = time.time()
        _record(user, d, p, o, price, bool(info.get("available", True)), source)
        _trim(d)
        out["id"] = p["id"]
    store.update(key(user), EMPTY, go)
    if out.get("skipped"):
        return None
    return summary(user, out["id"], url)


def _trim(d):
    if len(d["products"]) > MAX_PRODUCTS:
        keep = [p for p in d["products"] if p.get("followed")]
        rest = sorted([p for p in d["products"] if not p.get("followed")], key=lambda p: -p.get("seen", 0))
        d["products"] = keep + rest[:MAX_PRODUCTS - len(keep)]


def stats(o, days=90):
    since = (date.today() - timedelta(days=days)).isoformat()
    vals = [p for d0, p in o.get("history", []) if d0 >= since]
    allv = [p for _, p in o.get("history", [])]
    if not vals:
        return {}
    return {"low": min(vals), "high": max(vals), "avg": round(sum(vals) / len(vals), 2), "low_all": min(allv),
            "since": o["history"][0][0], "days": len(o["history"])}


def verdict(o):
    s = stats(o)
    p = o.get("price")
    if not s or p is None:
        return None
    first = date.fromisoformat(s["since"])
    if (date.today() - first).days < 7 or s["days"] < 3:
        return {"level": "info", "text": f"Historique en cours depuis le {first.strftime('%d/%m/%Y')}"}
    if p <= s["low"] * 1.01:
        return {"level": "ok", "text": "Prix le plus bas depuis 90 jours" if p > s["low_all"] * 1.01 else "Prix le plus bas jamais vu"}
    if p >= s["avg"] * 1.08:
        return {"level": "bad", "text": f"Plus cher que d'habitude (moyenne {eur(s['avg'])})"}
    return {"level": "warn", "text": f"Prix habituel (le plus bas : {eur(s['low'])})"}


def comparators(p):
    q = quote(p.get("gtin") or query_of(p) or p["title"])
    links = [{"name": n, "url": u.format(q=q)} for n, u in COMPARATORS]
    if p.get("asin"):
        links.insert(0, {"name": "CamelCamelCamel (historique Amazon)", "url": f"https://fr.camelcamelcamel.com/product/{p['asin']}"})
    return links


def public(p, current_url=None):
    offers = []
    for o in p["offers"]:
        offers.append({k: o.get(k) for k in ("id", "url", "shop", "price", "available", "checked", "source", "error")}
                      | {"stats": stats(o), "verdict": verdict(o), "history": o.get("history", [])[-365:], "current": o["url"] == current_url})
    live = [o for o in offers if o["price"] and o["available"] is not False and (time.time() - (o["checked"] or 0)) < 14 * 86400]
    best = min(live, key=lambda o: o["price"]) if live else None
    return {k: p.get(k) for k in ("id", "title", "image", "brand", "gtin", "asin", "followed", "target", "created", "seen", "compared")} \
        | {"offers": sorted(offers, key=lambda o: (o["price"] is None, o["price"] or 0)), "best": best, "links": comparators(p)}


def summary(user, pid, current_url=None):
    p, _ = _find(load(user), pid=pid)
    return public(p, current_url) if p else None


# --- Comparaison --------------------------------------------------------------------------------

def compare_plan(user, pid):
    """Recherches à faire chez les autres boutiques : [{shop, name, url, product}]."""
    d = load(user)
    p, _ = _find(d, pid=pid)
    if not p:
        raise ValueError("Produit introuvable")
    q = quote(query_of(p))
    out = []
    for s in shops_of(d):
        if not s.get("on", True) or any(re.search(s["product"], o["url"]) for o in p["offers"]):
            continue
        out.append({"shop": s["id"], "name": s["name"], "url": s["search"].replace("{q}", q), "product": s["product"]})
    return out


def compare_page(user, pid, shop, url, html, kind):
    """Une page lue pendant la comparaison : résultats de recherche (→ liens à ouvrir) ou fiche produit (→ offre)."""
    d = load(user)
    p, _ = _find(d, pid=pid)
    s = next((x for x in shops_of(d) if x["id"] == shop), None)
    if not p or not s:
        raise ValueError("Produit ou boutique inconnu")
    if kind == "search":
        info = parse_product(html, url)  # certaines boutiques renvoient directement la fiche quand l'EAN est unique
        if info and same_product(p, info) and re.search(s["product"], url):
            return {"matched": add_offer(user, pid, url, info)}
        return {"candidates": search_candidates(html, url, s["product"])}
    info = parse_product(html, url)
    if info and same_product(p, info):
        return {"matched": add_offer(user, pid, url, info)}
    return {"matched": None}


def add_offer(user, pid, url, info, source="compare"):
    url = clean_url(url)

    def go(d):
        p, _ = _find(d, pid=pid)
        if not p:
            return
        o = next((x for x in p["offers"] if x["url"] == url), None)
        if not o:
            o = {"id": uuid.uuid4().hex[:8], "url": url, "shop": shop_name(url, shops_of(d)), "history": [], "added": time.time()}
            p["offers"].append(o)
        if info.get("gtin") and not p.get("gtin"):
            p["gtin"] = info["gtin"]
        _record(user, d, p, o, info["price"], bool(info.get("available", True)), source)
        p["compared"] = time.time()
    store.update(key(user), EMPTY, go)
    return {"shop": shop_name(url, shops_of(load(user))), "url": url, "price": info["price"], "title": info.get("title")}


def fetch(url):
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9"}, timeout=15)
    if r.status_code >= 400:
        raise ValueError(f"HTTP {r.status_code}")
    r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
    return r.text


def compare_server(user, pid):
    """Même comparaison, faite par le NAS (utile sans l'extension ; certaines boutiques bloquent le NAS)."""
    found, errors = [], []
    for step in compare_plan(user, pid):
        try:
            res = compare_page(user, pid, step["shop"], step["url"], fetch(step["url"]), "search")
            if res.get("matched"):
                found.append(res["matched"])
                continue
            for c in res.get("candidates", [])[:2]:
                r2 = compare_page(user, pid, step["shop"], c, fetch(c), "product")
                if r2.get("matched"):
                    found.append(r2["matched"])
                    break
        except (requests.RequestException, ValueError) as e:
            errors.append(f"{step['name']} : {e}")
    store.update(key(user), EMPTY, lambda d: [p.__setitem__("compared", time.time()) for p in d["products"] if p["id"] == pid])
    return {"found": found, "errors": errors}


# --- Relecture quotidienne ------------------------------------------------------------------------

def due(user, browser=False):
    """Offres des produits suivis à relire (plus de 20 h). browser=True : celles que le NAS n'arrive pas à lire."""
    out = []
    for p in load(user)["products"]:
        if not p.get("followed"):
            continue
        for o in p["offers"]:
            old = time.time() - (o.get("checked") or 0) > 20 * 3600
            if old and (not browser or o.get("blocked")):
                out.append({"pid": p["id"], "url": o["url"]})
    return out[:40]


def refresh(user, pid, url, html=None, source="nas"):
    """Relit une offre ; html fourni par l'extension, sinon le NAS va la chercher."""
    try:
        info = parse_product(html if html is not None else fetch(url), url)
    except (requests.RequestException, ValueError) as e:
        info, err = None, str(e)
    else:
        err = None if info else "prix introuvable sur la page"

    def go(d):
        p, _ = _find(d, pid=pid)
        o = next((x for x in (p or {}).get("offers", []) if x["url"] == url), None)
        if not o:
            return
        if info:
            o["blocked"] = False if source == "nas" else o.get("blocked", False)
            _record(user, d, p, o, info["price"], bool(info.get("available", True)), source)
        else:
            o["checked"], o["error"] = time.time(), err
            if source == "nas":
                o["blocked"] = True  # l'extension prendra le relais
    store.update(key(user), EMPTY, go)
    return bool(info)


def users():
    import os
    try:
        return [f[:-5] for f in os.listdir(store.path("prix")) if f.endswith(".json")]
    except OSError:
        return []


def loop():
    time.sleep(90)
    while True:
        for user in users():
            for x in due(user):
                try:
                    refresh(user, x["pid"], x["url"])
                except Exception as e:  # noqa: BLE001
                    print("prix", e, flush=True)
                time.sleep(3)
        time.sleep(3600)


def start():
    threading.Thread(target=loop, daemon=True).start()


def count(user):
    return sum(1 for p in load(user)["products"] if p.get("followed")) or None


def search(q, user):
    f = fold(q)
    return [{"type": "price", "title": p["title"], "sub": "Suivi des prix" + (f" · {eur(p['offers'][0]['price'])}" if p["offers"] and p["offers"][0].get("price") else ""),
             "link": f"#/prix/{p['id']}"} for p in load(user)["products"] if f in fold(p["title"])][:5]


# --- Routes (site) --------------------------------------------------------------------------------

@bp.get("/api/prix")
def overview():
    d = load(g.user["name"])
    every = request.args.get("all") == "1"
    prods = [public(p) for p in d["products"] if every or p.get("followed")]
    return jsonify(products=prods[:500], total=len(d["products"]), followed=sum(1 for p in d["products"] if p.get("followed")),
                   settings=settings_of(d), shops=shops_of(d))


@bp.get("/api/prix/<pid>")
def product(pid):
    s = summary(g.user["name"], pid)
    if not s:
        raise ValueError("Produit introuvable")
    return jsonify(s)


@bp.put("/api/prix/<pid>")
def edit(pid):
    f = request.get_json(force=True)

    def go(d):
        p, _ = _find(d, pid=pid)
        if not p:
            raise ValueError("Produit introuvable")
        if "followed" in f:
            p["followed"] = bool(f["followed"])
        if "target" in f:
            p["target"] = to_price(f["target"]) if f["target"] not in (None, "") else None
        if f.get("title"):
            p["title"] = str(f["title"])[:200]
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(summary(g.user["name"], pid))


@bp.delete("/api/prix/<pid>")
def delete(pid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("products", [p for p in d["products"] if p["id"] != pid]))
    return jsonify(ok=True)


@bp.delete("/api/prix/<pid>/offers/<oid>")
def delete_offer(pid, oid):
    def go(d):
        p, _ = _find(d, pid=pid)
        if p:
            p["offers"] = [o for o in p["offers"] if o["id"] != oid]
    store.update(key(g.user["name"]), EMPTY, go)
    return jsonify(summary(g.user["name"], pid))


@bp.post("/api/prix/add")
def add_link():
    """Suivre un produit depuis son lien (sans l'extension) : le NAS lit la page."""
    url = str((request.get_json(force=True) or {}).get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        raise ValueError("Colle le lien de la fiche produit (https://…)")
    try:
        info = parse_product(fetch(url), url)
    except requests.RequestException:
        info = None
    if not info:
        raise ValueError("Le prix n'a pas pu être lu (le site bloque peut-être le NAS) : ouvre la page avec l'extension et clique sur « Suivre le prix »")
    return jsonify(seen(g.user["name"], url, info, follow=True, source="nas"))


@bp.post("/api/prix/<pid>/compare")
def compare_route(pid):
    return jsonify(compare_server(g.user["name"], pid) | {"product": summary(g.user["name"], pid)})


@bp.put("/api/prix/settings")
def save_settings():
    f = request.get_json(force=True)

    def go(d):
        s = d.setdefault("settings", {})
        for k in ("record_all", "notify_drop"):
            if k in f:
                s[k] = bool(f[k])
        if "min_drop_pct" in f:
            s["min_drop_pct"] = max(0, min(50, float(f["min_drop_pct"])))
        if "shops" in f:  # {id: on}
            conf = d.get("shops") or {}
            for sid, on in f["shops"].items():
                conf.setdefault(sid, {})["on"] = bool(on)
            d["shops"] = conf
        if "custom" in f:  # boutiques ajoutées : [{name, search, product}]
            conf = d.get("shops") or {}
            custom = []
            for c in f["custom"][:20]:
                if not (c.get("name") and "{q}" in str(c.get("search")) and c.get("product")):
                    raise ValueError("Pour une boutique : un nom, un lien de recherche avec {q} et la forme des liens produit")
                re.compile(c["product"])
                host = urlparse(c["search"]).netloc.lower().removeprefix("www.")
                custom.append({"id": "c-" + re.sub(r"\W", "", fold(c["name"]))[:20], "name": str(c["name"])[:40], "host": host,
                               "search": str(c["search"])[:300], "product": str(c["product"])[:200], "on": True})
            conf["_custom"] = custom
            d["shops"] = conf
    store.update(key(g.user["name"]), EMPTY, go)
    d = load(g.user["name"])
    return jsonify(settings=settings_of(d), shops=shops_of(d))
