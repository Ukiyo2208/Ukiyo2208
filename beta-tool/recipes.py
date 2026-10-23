"""Outil « Recettes » : carnet de recettes (import depuis un lien Marmiton, 750g,
Cuisine AZ… grâce aux données schema.org que publient ces sites), portions
ajustables, mode cuisine, et liste de courses partagée par toute la maison."""

import html
import json
import os
import re
import time
import urllib.parse
import urllib.request
import uuid

from flask import Blueprint, g, jsonify, request, send_file

import activity
import store

bp = Blueprint("recipes", __name__)
IMAGES = store.path("recettes", "images")
CATEGORIES = ["Entrée", "Plat", "Dessert", "Apéritif", "Petit-déjeuner", "Boisson", "Sauce", "Autre"]
AISLES = [
    ("Fruits et légumes", r"tomate|oignon|ail\b|échalote|carotte|pomme|poire|citron|orange|banane|salade|courgette|aubergine|poivron|champignon|pomme de terre|patate|persil|basilic|coriandre|ciboulette|menthe|thym|romarin|laurier|épinard|brocoli|chou|poireau|céleri|concombre|avocat|fraise|framboise|myrtille|cerise|pêche|abricot|raisin|mangue|ananas|kiwi|gingembre|radis|navet|potiron|courge|haricot vert|petits pois|légume|fruit"),
    ("Crèmerie", r"lait|beurre|crème|yaourt|fromage|gruyère|emmental|parmesan|mozzarella|comté|chèvre|feta|ricotta|mascarpone|œuf|oeuf|skyr|fromage blanc"),
    ("Boucherie et poisson", r"poulet|bœuf|boeuf|veau|porc|agneau|canard|dinde|jambon|lardon|bacon|saucisse|chorizo|viande|steak|filet|escalope|saumon|thon|cabillaud|crevette|moule|poisson|merlu|sardine"),
    ("Boulangerie", r"\bpain\b|baguette|brioche|pâte feuilletée|pâte brisée|pâte à pizza|tortilla|wrap"),
    ("Surgelés", r"surgelé|glace\b"),
    ("Boissons", r"\bvin\b|bière|jus\b|eau gazeuse|sirop|cidre|rhum|café|thé\b"),
    ("Épicerie", r"farine|sucre|sel\b|poivre|huile|vinaigre|riz|pâtes|spaghetti|lentille|pois chiche|semoule|quinoa|levure|chocolat|cacao|vanille|miel|confiture|moutarde|ketchup|mayonnaise|sauce|bouillon|épice|cumin|curry|paprika|cannelle|muscade|amande|noisette|noix|raisin sec|conserve|tomate concentrée|coulis|maïzena|fécule|chapelure|olive|câpre"),
    ("Hygiène et maison", r"lessive|savon|shampo|dentifrice|papier toilette|essuie|éponge|liquide vaisselle"),
]
_notified = {}


def recipes():
    return store.load("recettes", {})


def save_recipe(r):
    store.update("recettes", {}, lambda d: d.__setitem__(r["id"], r))


def aisle_of(text):
    t = text.lower()
    return next((name for name, rx in AISLES if re.search(rx, t)), "Autres")


# --- Import depuis un site -------------------------------------------------------

def iso_minutes(v):
    if not v or not isinstance(v, str):
        return None
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?", v.strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi


def text_of(v):
    if isinstance(v, list):
        return " ".join(text_of(x) for x in v)
    if isinstance(v, dict):
        return text_of(v.get("text") or v.get("name") or "")
    return html.unescape(re.sub(r"<[^>]+>", " ", str(v or ""))).strip()


def steps_of(v):
    out = []
    if isinstance(v, str):
        out = [s.strip() for s in re.split(r"\n+|(?<=\.)\s+(?=[A-ZÉÀ])", html.unescape(re.sub(r"<[^>]+>", "\n", v))) if s.strip()]
    elif isinstance(v, list):
        for x in v:
            if isinstance(x, dict) and x.get("@type") == "HowToSection":
                out += steps_of(x.get("itemListElement") or [])
            else:
                t = text_of(x)
                if t:
                    out.append(t)
    elif isinstance(v, dict):
        out = steps_of(v.get("itemListElement") or v.get("text") or [])
    return [re.sub(r"\s+", " ", s) for s in out]


def find_recipe(data):
    if isinstance(data, list):
        for x in data:
            r = find_recipe(x)
            if r:
                return r
    elif isinstance(data, dict):
        t = data.get("@type")
        if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
            return data
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in data:
                r = find_recipe(data[key])
                if r:
                    return r
    return None


def image_of(v):
    if isinstance(v, list) and v:
        return image_of(v[-1] if isinstance(v[-1], str) else v[0])
    if isinstance(v, dict):
        return v.get("url") or v.get("contentUrl")
    return v if isinstance(v, str) else None


def parse_page(page, url):
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except ValueError:
            try:  # certains sites laissent des retours à la ligne dans les chaînes
                data = json.loads(re.sub(r"[\n\r\t]+", " ", m.group(1).strip()))
            except ValueError:
                continue
        r = find_recipe(data)
        if not r:
            continue
        yields = r.get("recipeYield")
        yields = yields[0] if isinstance(yields, list) and yields else yields
        servings = int(m2.group(1)) if (m2 := re.search(r"(\d+)", str(yields or ""))) else 4
        cat = text_of(r.get("recipeCategory"))
        category = next((c for c in CATEGORIES if c.lower() in cat.lower()), None) or \
            ("Plat" if re.search(r"plat|principal|main", cat, re.I) else "Dessert" if re.search(r"dessert|gâteau|sucré", cat, re.I) else "Autre")
        img = image_of(r.get("image"))
        return {"title": text_of(r.get("name")) or "Recette", "ingredients": [text_of(i) for i in r.get("recipeIngredient") or r.get("ingredients") or [] if text_of(i)],
                "steps": steps_of(r.get("recipeInstructions")), "servings": servings, "prep": iso_minutes(r.get("prepTime")),
                "cook": iso_minutes(r.get("cookTime")), "total": iso_minutes(r.get("totalTime")), "category": category,
                "image_url": urllib.parse.urljoin(url, img) if img else None, "source": url,
                "description": text_of(r.get("description"))[:400]}
    raise ValueError("Je n'ai pas trouvé de recette sur cette page. Ajoute-la à la main (bouton « Nouvelle recette »).")


def fetch(url, limit=5 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
                                               "Accept-Language": "fr-FR,fr;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read(limit)
        charset = r.headers.get_content_charset() or "utf-8"
    return data, charset


def download_image(rid, url):
    try:
        data, _ = fetch(url, 15 * 1024 * 1024)
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(data)).convert("RGB")
        img.thumbnail((1400, 1400))
        os.makedirs(IMAGES, exist_ok=True)
        img.save(f"{IMAGES}/{rid}.jpg", "JPEG", quality=84)
        return True
    except Exception:  # noqa: BLE001
        return False


def clean(d, r=None):
    r = dict(r or {})
    r["title"] = str(d.get("title") or r.get("title") or "").strip()[:150]
    if not r["title"]:
        raise ValueError("Donne un titre à ta recette")
    lines = lambda v: [str(x).strip() for x in (v if isinstance(v, list) else str(v or "").splitlines()) if str(x).strip()][:200]  # noqa: E731
    if "ingredients" in d:
        r["ingredients"] = lines(d["ingredients"])
    if "steps" in d:
        r["steps"] = lines(d["steps"])
    for k in ("servings", "prep", "cook", "total", "rating"):
        if k in d:
            try:
                r[k] = int(d[k]) if str(d[k]).strip() else None
            except ValueError:
                r[k] = None
    for k in ("description", "notes", "source"):
        if k in d:
            r[k] = str(d[k] or "")[:3000]
    if d.get("category") in CATEGORIES:
        r["category"] = d["category"]
    if "tags" in d:
        r["tags"] = [t.strip()[:30] for t in (d["tags"] if isinstance(d["tags"], list) else str(d["tags"]).split(",")) if t.strip()][:12]
    if "favorite" in d:
        r["favorite"] = bool(d["favorite"])
    return r


# --- Routes recettes -------------------------------------------------------------

@bp.get("/api/recipes")
def list_recipes():
    out = sorted(recipes().values(), key=lambda r: (not r.get("favorite"), -r["created"]))
    return jsonify(recipes=out, categories=CATEGORIES)


@bp.post("/api/recipes/import")
def import_url():
    url = str((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not re.match(r"^https?://\S+$", url):
        raise ValueError("Colle le lien d'une page de recette")
    try:
        data, charset = fetch(url)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Impossible d'ouvrir cette page ({e})") from None
    info = parse_page(data.decode(charset, "replace"), url)
    rid = uuid.uuid4().hex[:10]
    r = {"id": rid, "owner": g.user["name"], "created": time.time(), "favorite": False, "notes": "", "tags": [], "rating": None,
         **{k: v for k, v in info.items() if k != "image_url"}}
    r["image"] = bool(info["image_url"]) and download_image(rid, info["image_url"])
    save_recipe(r)
    return jsonify(r)


@bp.post("/api/recipes")
def create():
    d = request.get_json(silent=True) or {}
    r = clean(d, {"id": uuid.uuid4().hex[:10], "owner": g.user["name"], "created": time.time(), "ingredients": [], "steps": [],
                  "servings": 4, "category": "Plat", "favorite": False, "image": False, "tags": []})
    save_recipe(r)
    return jsonify(r)


@bp.put("/api/recipes/<rid>")
def edit(rid):
    r = recipes().get(rid)
    if not r:
        raise ValueError("Recette introuvable")
    r = clean({"title": r["title"], **(request.get_json(silent=True) or {})}, r)
    save_recipe(r)
    return jsonify(r)


@bp.post("/api/recipes/<rid>/image")
def set_image(rid):
    r = recipes().get(rid)
    f = request.files.get("file")
    if not r or not f:
        raise ValueError("Image manquante")
    from PIL import Image, ImageOps
    os.makedirs(IMAGES, exist_ok=True)
    img = ImageOps.exif_transpose(Image.open(f.stream)).convert("RGB")
    img.thumbnail((1400, 1400))
    img.save(f"{IMAGES}/{rid}.jpg", "JPEG", quality=84)
    r["image"] = True
    r["image_v"] = int(time.time())
    save_recipe(r)
    return jsonify(r)


@bp.get("/api/recipes/<rid>/image")
def image(rid):
    p = f"{IMAGES}/{rid}.jpg"
    if not os.path.exists(p):
        return "", 404
    resp = send_file(p, mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "max-age=604800"
    return resp


@bp.delete("/api/recipes/<rid>")
def delete(rid):
    store.update("recettes", {}, lambda d: d.pop(rid, None))
    try:
        os.remove(f"{IMAGES}/{rid}.jpg")
    except OSError:
        pass
    return jsonify(ok=True)


# --- Liste de courses (partagée) -----------------------------------------------

def shopping():
    return store.load("courses", {"items": [], "updated": 0})


def touched(by):
    """Prévient les autres membres de la maison (au plus une fois toutes les 10 minutes)."""
    now = time.time()
    if now - _notified.get(by, 0) > 600:
        _notified[by] = now
        activity.log("*", "recettes", f"{by} a modifié la liste de courses", "#/recettes/courses", push=True, title="Liste de courses")


def payload():
    return jsonify({**shopping(), "aisles": [a for a, _ in AISLES] + ["Autres"]})


@bp.get("/api/shopping")
def shopping_list():
    return payload()


@bp.post("/api/shopping")
def shopping_add():
    d = request.get_json(silent=True) or {}
    texts = d.get("items") or [d.get("text")]
    texts = [str(t).strip()[:200] for t in texts if t and str(t).strip()]
    if not texts:
        raise ValueError("Rien à ajouter")

    def go(data):
        for t in texts:
            data["items"].append({"id": uuid.uuid4().hex[:8], "text": t, "aisle": aisle_of(t), "checked": False, "by": g.user["name"],
                                  "recipe": d.get("recipe"), "added": time.time()})
        data["updated"] = time.time()
    store.update("courses", {"items": [], "updated": 0}, go)
    if g.user["name"] not in ("local",):
        touched(g.user["name"])
    return payload()


@bp.put("/api/shopping/<iid>")
def shopping_edit(iid):
    d = request.get_json(silent=True) or {}

    def go(data):
        it = next((i for i in data["items"] if i["id"] == iid), None)
        if not it:
            raise ValueError("Article introuvable")
        if "checked" in d:
            it["checked"] = bool(d["checked"])
        if d.get("text"):
            it["text"] = str(d["text"]).strip()[:200]
            it["aisle"] = aisle_of(it["text"])
        data["updated"] = time.time()
    store.update("courses", {"items": [], "updated": 0}, go)
    return payload()


@bp.delete("/api/shopping")
def shopping_clear():
    which = request.args.get("which", "checked")

    def go(data):
        data["items"] = [] if which == "all" else [i for i in data["items"] if not i["checked"]]
        data["updated"] = time.time()
    store.update("courses", {"items": [], "updated": 0}, go)
    return payload()


@bp.delete("/api/shopping/<iid>")
def shopping_delete(iid):
    def go(data):
        data["items"] = [i for i in data["items"] if i["id"] != iid]
        data["updated"] = time.time()
    store.update("courses", {"items": [], "updated": 0}, go)
    return payload()


def search(q, user):
    return [{"type": "recipe", "title": r["title"], "sub": f"Recette · {r.get('category', '')}", "link": f"#/recettes/{r['id']}"}
            for r in recipes().values() if q in r["title"].lower() or any(q in i.lower() for i in r.get("ingredients", []))][:6]


def count(user):
    return len(recipes()) or None

