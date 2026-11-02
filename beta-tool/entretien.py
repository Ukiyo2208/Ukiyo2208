"""Outil « Entretien » : la maison et la voiture, avec rappels.

Chaque équipement (voiture, chaudière, logement, jardin…) a ses entretiens à intervalle régulier
(en mois et/ou en kilomètres) : vidange, contrôle technique, entretien de la chaudière, ramonage…
Tu notes ce qui a été fait (date, kilométrage, prix, facture de Paperasse) et Bêta Tool te prévient
avant la prochaine échéance. Commun à toute la maison."""

import threading
import time
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request

import activity
import store

bp = Blueprint("entretien", __name__)
KINDS = {"voiture": ("Voiture / moto", "car"), "logement": ("Logement", "home"), "chauffage": ("Chauffage / eau chaude", "flame"),
         "jardin": ("Jardin / piscine", "sun"), "appareil": ("Appareil", "settings"), "autre": ("Autre", "tag")}
# modèles d'entretiens proposés : (nom, tous les X mois, tous les X km, note)
TEMPLATES = {
    "voiture": [("Vidange et filtres", 12, 15000, ""), ("Révision constructeur", 12, 20000, "Voir le carnet d'entretien"),
                ("Contrôle technique", 24, None, "Obligatoire : 4 ans après la 1re immatriculation, puis tous les 2 ans"),
                ("Pneus été / hiver", 6, None, "Changement de saison (loi Montagne dans certains départements)"),
                ("Courroie de distribution", 60, 100000, "Selon le modèle : voir le carnet"), ("Liquide de frein", 24, None, ""),
                ("Assurance auto", 12, None, "Compare avant l'échéance (loi Hamon après 1 an)")],
    "chauffage": [("Entretien de la chaudière", 12, None, "Obligatoire chaque année (gaz, fioul, bois) : garde l'attestation"),
                  ("Ramonage", 12, None, "Obligatoire selon ta commune, souvent 1 à 2 fois par an"), ("Entretien pompe à chaleur", 24, None, "Obligatoire tous les 2 ans au-delà de 4 kW"),
                  ("Détartrage du chauffe-eau", 24, None, "")],
    "logement": [("Piles des détecteurs de fumée", 12, None, "Teste-les chaque mois"), ("Nettoyage de la VMC", 6, None, "Bouches et filtres"),
                 ("Gouttières", 12, None, "À l'automne, après la chute des feuilles"), ("Joints silicone salle de bain", 36, None, ""),
                 ("Filtre de la hotte", 6, None, "")],
    "jardin": [("Révision de la tondeuse", 12, None, "Au printemps : lame, bougie, huile"), ("Hivernage de la piscine", 12, None, ""),
               ("Taille des haies", 6, None, "Éviter de mi-mars à fin juillet (nidification)")],
    "appareil": [("Détartrage", 3, None, ""), ("Nettoyage du filtre", 3, None, "")],
    "autre": [],
}
EMPTY = {"items": []}


def load():
    d = store.load("entretien", EMPTY)
    d.setdefault("items", [])
    return d


def _add_months(d, m):
    y, mo = divmod(d.month - 1 + m, 12)
    return date(d.year + y, mo + 1, min(d.day, 28))


def task_state(item, t, today=None):
    today = today or date.today()
    out = {"next_date": None, "next_km": None, "days": None, "km_left": None, "status": "ok"}
    last = date.fromisoformat(t["last_date"]) if t.get("last_date") else None
    if t.get("every_months") and last:
        nd = _add_months(last, int(t["every_months"]))
        out["next_date"], out["days"] = nd.isoformat(), (nd - today).days
    elif t.get("due_date"):  # première échéance saisie à la main
        nd = date.fromisoformat(t["due_date"])
        out["next_date"], out["days"] = nd.isoformat(), (nd - today).days
    if t.get("every_km") and t.get("last_km") is not None and item.get("km"):
        nk = int(t["last_km"]) + int(t["every_km"])
        out["next_km"], out["km_left"] = nk, nk - int(item["km"])
    late = (out["days"] is not None and out["days"] < 0) or (out["km_left"] is not None and out["km_left"] < 0)
    soon = (out["days"] is not None and out["days"] <= 30) or (out["km_left"] is not None and out["km_left"] <= 1000)
    out["status"] = "late" if late else "soon" if soon else "ok" if (out["days"] is not None or out["km_left"] is not None) else "unknown"
    return out


def public():
    d = load()
    items = []
    for it in d["items"]:
        tasks = [t | {"state": task_state(it, t)} for t in it.get("tasks", [])]
        order = {"late": 0, "soon": 1, "unknown": 2, "ok": 3}
        tasks.sort(key=lambda t: (order[t["state"]["status"]], t["state"]["days"] if t["state"]["days"] is not None else 99999))
        items.append(it | {"tasks": tasks, "late": sum(1 for t in tasks if t["state"]["status"] == "late"), "soon": sum(1 for t in tasks if t["state"]["status"] == "soon")})
    return items


def brief(user, today):
    out = []
    for it in public():
        for t in it["tasks"]:
            s = t["state"]
            if s["status"] in ("late", "soon"):
                when = (f"en retard de {-s['days']} j" if s["days"] is not None and s["days"] < 0 else f"dans {s['days']} j" if s["days"] is not None else "")
                km = f"{s['km_left']} km restants" if s["km_left"] is not None and s["km_left"] >= 0 else (f"dépassé de {-s['km_left']} km" if s["km_left"] is not None else "")
                out.append({"text": f"{t['name']} · {it['name']}", "sub": " · ".join(x for x in (when, km) if x), "late": s["status"] == "late", "link": "#/entretien"})
    return out[:8]


def loop():
    last = None
    while True:
        time.sleep(1800)
        now = datetime.now()
        if now.hour < 9 or last == now.date():
            continue
        last = now.date()
        try:
            for it in public():
                for t in it["tasks"]:
                    days = t["state"]["days"]
                    if days in (30, 7, 0):
                        msg = "aujourd'hui" if days == 0 else f"dans {days} jours"
                        activity.log("*", "entretien", f"{t['name']} ({it['name']}) à faire {msg}", "#/entretien", title="🔧 Entretien")
                    kl = t["state"]["km_left"]
                    if kl is not None and 0 <= kl <= 500 and not t.get("km_warned"):
                        activity.log("*", "entretien", f"{t['name']} ({it['name']}) : plus que {kl} km", "#/entretien", title="🔧 Entretien")

                        def mark(d, iid=it["id"], tid=t["id"]):
                            for x in d["items"]:
                                for y in x.get("tasks", []):
                                    if x["id"] == iid and y["id"] == tid:
                                        y["km_warned"] = True
                        store.update("entretien", EMPTY, mark)
        except Exception as e:  # noqa: BLE001
            print("entretien", e, flush=True)


def start():
    import journee
    journee.SOURCES["upkeep"] = ("entretien", brief)
    threading.Thread(target=loop, daemon=True).start()


def count(user):
    return sum(it["late"] + it["soon"] for it in public()) or None


def _num(v):
    try:
        return int(float(str(v).replace(" ", "").replace(",", "."))) if str(v or "").strip() else None
    except ValueError:
        return None


def _find(d, iid):
    it = next((x for x in d["items"] if x["id"] == iid), None)
    if not it:
        raise ValueError("Équipement introuvable")
    return it


# --- Routes ---------------------------------------------------------------------------------------------------------

@bp.get("/api/upkeep")
def list_all():
    return jsonify(items=public(), kinds={k: {"name": v[0], "icon": v[1]} for k, v in KINDS.items()},
                   templates={k: [{"name": n, "every_months": m, "every_km": km, "note": note} for n, m, km, note in v] for k, v in TEMPLATES.items()})


@bp.post("/api/upkeep/items")
def add_item():
    f = request.get_json(force=True)
    kind = f.get("kind") if f.get("kind") in KINDS else "autre"
    name = str(f.get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Donne un nom (ex. Clio, Chaudière, Maison)")
    it = {"id": uuid.uuid4().hex[:8], "kind": kind, "name": name, "details": str(f.get("details") or "")[:200], "km": _num(f.get("km")),
          "km_at": time.time() if f.get("km") else None, "inventory": str(f.get("inventory") or "")[:20], "tasks": []}
    for n in f.get("templates") or []:
        tpl = next((x for x in TEMPLATES.get(kind, []) if x[0] == n), None)
        if tpl:
            it["tasks"].append({"id": uuid.uuid4().hex[:8], "name": tpl[0], "every_months": tpl[1], "every_km": tpl[2], "note": tpl[3], "history": []})
    store.update("entretien", EMPTY, lambda d: d["items"].append(it))
    return jsonify(it)


@bp.put("/api/upkeep/items/<iid>")
def edit_item(iid):
    f = request.get_json(force=True)

    def go(d):
        it = _find(d, iid)
        if f.get("name"):
            it["name"] = str(f["name"]).strip()[:60]
        if "details" in f:
            it["details"] = str(f["details"] or "")[:200]
        if "km" in f and _num(f["km"]) is not None:
            it["km"], it["km_at"] = _num(f["km"]), time.time()
            for t in it.get("tasks", []):
                t.pop("km_warned", None)
    store.update("entretien", EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/upkeep/items/<iid>")
def del_item(iid):
    store.update("entretien", EMPTY, lambda d: d.__setitem__("items", [x for x in d["items"] if x["id"] != iid]))
    return jsonify(ok=True)


@bp.post("/api/upkeep/items/<iid>/tasks")
def add_task(iid):
    f = request.get_json(force=True)
    name = str(f.get("name") or "").strip()[:80]
    if not name:
        raise ValueError("Donne un nom à l'entretien")
    t = {"id": uuid.uuid4().hex[:8], "name": name, "every_months": _num(f.get("every_months")), "every_km": _num(f.get("every_km")),
         "note": str(f.get("note") or "")[:300], "due_date": str(f.get("due_date") or "")[:10], "history": []}
    if t["due_date"]:
        date.fromisoformat(t["due_date"])
    store.update("entretien", EMPTY, lambda d: _find(d, iid)["tasks"].append(t))
    return jsonify(t)


@bp.put("/api/upkeep/items/<iid>/tasks/<tid>")
def edit_task(iid, tid):
    f = request.get_json(force=True)

    def go(d):
        t = next((x for x in _find(d, iid)["tasks"] if x["id"] == tid), None)
        if not t:
            raise ValueError("Entretien introuvable")
        for k in ("every_months", "every_km"):
            if k in f:
                t[k] = _num(f[k])
        for k, n in (("name", 80), ("note", 300), ("due_date", 10)):
            if k in f:
                t[k] = str(f[k] or "")[:n]
    store.update("entretien", EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/upkeep/items/<iid>/tasks/<tid>")
def del_task(iid, tid):
    store.update("entretien", EMPTY, lambda d: _find(d, iid).__setitem__("tasks", [x for x in _find(d, iid)["tasks"] if x["id"] != tid]))
    return jsonify(ok=True)


@bp.post("/api/upkeep/items/<iid>/tasks/<tid>/done")
def done(iid, tid):
    """Noter un entretien fait : date, kilométrage, prix, garage, facture de Paperasse."""
    f = request.get_json(force=True)
    day = str(f.get("date") or date.today().isoformat())[:10]
    date.fromisoformat(day)
    entry = {"date": day, "km": _num(f.get("km")), "cost": float(str(f.get("cost") or 0).replace(",", ".") or 0), "by": str(f.get("by") or "")[:80],
             "note": str(f.get("note") or "")[:300], "paper": str(f.get("paper") or "")[:20], "who": g.user["name"]}

    def go(d):
        it = _find(d, iid)
        t = next((x for x in it["tasks"] if x["id"] == tid), None)
        if not t:
            raise ValueError("Entretien introuvable")
        t["history"].insert(0, entry)
        if not t.get("last_date") or day >= t["last_date"]:
            t["last_date"], t["last_km"] = day, entry["km"] if entry["km"] is not None else t.get("last_km")
            t.pop("km_warned", None)
            t["due_date"] = ""
        if entry["km"] and (not it.get("km") or entry["km"] > it["km"]):
            it["km"], it["km_at"] = entry["km"], time.time()
    store.update("entretien", EMPTY, go)
    return jsonify(ok=True)


@bp.get("/api/upkeep/papers")
def papers():
    """Factures de Paperasse à relier à un entretien (récentes d'abord)."""
    try:
        import paperasse
        docs = [x for x in paperasse.load()["docs"].values() if x.get("status") == "filed" and x.get("category") in ("Factures", "Véhicule", "Logement", "Achats & garanties")]
    except Exception:  # noqa: BLE001
        docs = []
    docs.sort(key=lambda x: x.get("date") or "", reverse=True)
    cutoff = (date.today() - timedelta(days=400)).isoformat()
    return jsonify([{"id": x["id"], "title": x.get("title") or x.get("name"), "issuer": x.get("issuer"), "date": x.get("date"), "amount": x.get("amount")}
                    for x in docs if (x.get("date") or "9999") >= cutoff][:80])
