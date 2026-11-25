"""Outil « Tâches » : des listes de choses à faire, perso ou partagées avec la maison.

Une tâche peut être confiée à quelqu'un, avoir une date et se répéter (sortir le chien chaque
jour, changer les draps chaque semaine…) : quand on la coche, la suivante est créée toute seule.
Les tâches du jour apparaissent dans « Ma journée »."""

import threading
import time
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request

import activity
import auth
import store

bp = Blueprint("taches", __name__)
_lock = threading.Lock()
REPEATS = {"": "", "daily": "Chaque jour", "weekdays": "En semaine", "weekly": "Chaque semaine", "biweekly": "Toutes les 2 semaines",
           "monthly": "Chaque mois", "yearly": "Chaque année"}
COLORS = ["bleu", "vert", "ambre", "rose", "violet", "bleu-vert"]


def load():
    return store.load("taches", {"lists": []})


def members():
    """Les personnes de la maison (comptes Bêta Tool)."""
    return [u["name"] for u in auth.users()] or [g.user["name"]]


def visible(lst, user):
    return lst["owner"] == user or lst.get("shared")


def _defaults(user):
    """Premières listes : « Maison » (partagée) et « Perso »."""
    def go(d):
        if any(visible(l, user) for l in d["lists"]):
            return
        if not any(l.get("shared") for l in d["lists"]):
            d["lists"].append({"id": uuid.uuid4().hex[:8], "name": "Maison", "color": "vert", "icon": "home", "owner": user, "shared": True, "items": []})
        d["lists"].append({"id": uuid.uuid4().hex[:8], "name": "Perso", "color": "bleu", "icon": "user", "owner": user, "shared": False, "items": []})
    store.update("taches", {"lists": []}, go)


def next_due(due, repeat):
    d = date.fromisoformat(due) if due else date.today()
    if repeat == "daily":
        return d + timedelta(days=1)
    if repeat == "weekdays":
        d += timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        return d
    if repeat == "weekly":
        return d + timedelta(days=7)
    if repeat == "biweekly":
        return d + timedelta(days=14)
    if repeat == "monthly":
        m = d.month % 12 + 1
        y = d.year + (d.month == 12)
        for day in (d.day, 30, 29, 28):
            try:
                return date(y, m, min(d.day, day))
            except ValueError:
                continue
    if repeat == "yearly":
        try:
            return d.replace(year=d.year + 1)
        except ValueError:
            return d.replace(year=d.year + 1, day=28)
    return None


def _find(d, lid, user):
    lst = next((l for l in d["lists"] if l["id"] == lid), None)
    if not lst or not visible(lst, user):
        raise ValueError("Liste introuvable")
    return lst


def public(lst, user):
    todo = [i for i in lst["items"] if not i.get("done")]
    return {k: v for k, v in lst.items() if k != "items"} | {"mine": lst["owner"] == user, "count": len(todo),
                                                              "late": sum(1 for i in todo if i.get("due") and i["due"] < date.today().isoformat())}


def _clean(f, user, old=None):
    it = dict(old or {"id": uuid.uuid4().hex[:8], "done": False, "created": time.time(), "by": user})
    if "text" in f:
        it["text"] = str(f["text"]).strip()[:300]
        if not it["text"]:
            raise ValueError("Écris la tâche")
    for k, n in (("notes", 3000), ("assignee", 60)):
        if k in f:
            it[k] = str(f[k] or "").strip()[:n]
    if "due" in f:
        due = str(f["due"] or "")[:10]
        if due:
            date.fromisoformat(due)
        it["due"] = due
    if "repeat" in f:
        if f["repeat"] not in REPEATS:
            raise ValueError("Répétition inconnue")
        it["repeat"] = f["repeat"]
        if it["repeat"] and not it.get("due"):
            it["due"] = date.today().isoformat()
    if "star" in f:
        it["star"] = bool(f["star"])
    return it


def brief(user, today):
    """Tâches du jour et en retard, pour « Ma journée » (les miennes ou celles confiées à personne)."""
    out = []
    for lst in load()["lists"]:
        if not visible(lst, user):
            continue
        for i in lst["items"]:
            if i.get("done") or not i.get("due") or i["due"] > today.isoformat():
                continue
            if i.get("assignee") and i["assignee"] != user:
                continue
            late = i["due"] < today.isoformat()
            out.append({"text": i["text"], "sub": lst["name"] + (f" · en retard depuis le {date.fromisoformat(i['due']).strftime('%d/%m')}" if late else ""),
                        "late": late, "link": f"#/taches/{lst['id']}"})
    return sorted(out, key=lambda x: not x["late"])[:12]


def reminder_loop():
    """À 9h, un rappel aux personnes à qui une tâche du jour est confiée (une fois par jour)."""
    last = None
    while True:
        time.sleep(60)
        now = datetime.now()
        if now.hour != 9 or last == now.date():
            continue
        last = now.date()
        try:
            per = {}
            for lst in load()["lists"]:
                for i in lst["items"]:
                    if not i.get("done") and i.get("assignee") and i.get("due") == now.date().isoformat():
                        per.setdefault(i["assignee"], []).append(i["text"])
            for who, items in per.items():
                activity.log(who, "taches", f"À faire aujourd'hui : {', '.join(items[:4])}" + (f" et {len(items) - 4} autre(s)" if len(items) > 4 else ""), "#/taches")
        except Exception as e:  # noqa: BLE001
            print("tâches", e, flush=True)


def start():
    import journee
    journee.SOURCES["tasks"] = ("taches", brief)
    threading.Thread(target=reminder_loop, daemon=True).start()


def count(user):
    today = date.today().isoformat()
    return sum(1 for l in load()["lists"] if visible(l, user) for i in l["items"]
               if not i.get("done") and i.get("due") and i["due"] <= today and i.get("assignee") in ("", None, user)) or None


# --- Routes --------------------------------------------------------------------------------------------

@bp.get("/api/tasks")
def lists():
    user = g.user["name"]
    _defaults(user)
    d = load()
    return jsonify(lists=[public(l, user) for l in d["lists"] if visible(l, user)], members=members(), repeats=REPEATS, me=user)


@bp.get("/api/tasks/<lid>")
def get_list(lid):
    user = g.user["name"]
    lst = _find(load(), lid, user)
    return jsonify(public(lst, user) | {"items": lst["items"]})


@bp.post("/api/tasks")
def create_list():
    user, f = g.user["name"], request.get_json(force=True)
    name = str(f.get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Donne un nom à la liste")
    lst = {"id": uuid.uuid4().hex[:8], "name": name, "color": f.get("color") if f.get("color") in COLORS else "bleu",
           "icon": str(f.get("icon") or "check")[:20], "owner": user, "shared": bool(f.get("shared")), "items": []}
    store.update("taches", {"lists": []}, lambda d: d["lists"].append(lst))
    return jsonify(public(lst, user))


@bp.put("/api/tasks/<lid>")
def edit_list(lid):
    user, f = g.user["name"], request.get_json(force=True)

    def go(d):
        lst = _find(d, lid, user)
        if "name" in f and str(f["name"]).strip():
            lst["name"] = str(f["name"]).strip()[:60]
        if f.get("color") in COLORS:
            lst["color"] = f["color"]
        if "icon" in f:
            lst["icon"] = str(f["icon"])[:20]
        if "shared" in f and lst["owner"] == user:
            lst["shared"] = bool(f["shared"])
        if f.get("clear_done"):
            lst["items"] = [i for i in lst["items"] if not i.get("done")]
    store.update("taches", {"lists": []}, go)
    return jsonify(ok=True)


@bp.delete("/api/tasks/<lid>")
def delete_list(lid):
    user = g.user["name"]

    def go(d):
        lst = _find(d, lid, user)
        if lst["owner"] != user and g.user["role"] != "admin":
            raise PermissionError("Seule la personne qui a créé la liste peut la supprimer")
        d["lists"].remove(lst)
    store.update("taches", {"lists": []}, go)
    return jsonify(ok=True)


@bp.post("/api/tasks/<lid>/items")
def add_item(lid):
    user, f = g.user["name"], request.get_json(force=True)
    it = _clean({"text": "", "notes": "", "assignee": "", "due": "", "repeat": ""} | f, user)
    lst_name = []

    def go(d):
        lst = _find(d, lid, user)
        lst["items"].insert(0, it)
        lst_name.append(lst["name"])
    store.update("taches", {"lists": []}, go)
    if it.get("assignee") and it["assignee"] != user:
        activity.log(it["assignee"], "taches", f"{user} te confie : {it['text']} ({lst_name[0]})", f"#/taches/{lid}")
    return jsonify(it)


@bp.put("/api/tasks/<lid>/items/<iid>")
def edit_item(lid, iid):
    user, f = g.user["name"], request.get_json(force=True)
    out, notify = {}, []

    def go(d):
        lst = _find(d, lid, user)
        it = next((i for i in lst["items"] if i["id"] == iid), None)
        if not it:
            raise ValueError("Tâche introuvable")
        before = it.get("assignee")
        new = _clean(f, user, it)
        if "done" in f:
            new["done"] = bool(f["done"])
            new["done_at"] = time.time() if new["done"] else None
            new["done_by"] = user if new["done"] else None
            if new["done"] and not it.get("done") and new.get("repeat"):  # tâche répétée : la suivante arrive
                nxt = next_due(new.get("due"), new["repeat"])
                if nxt:
                    while nxt < date.today():
                        nxt = next_due(nxt.isoformat(), new["repeat"])
                    follow = {**new, "id": uuid.uuid4().hex[:8], "done": False, "done_at": None, "done_by": None, "due": nxt.isoformat(), "created": time.time()}
                    lst["items"].insert(lst["items"].index(it), follow)
                    out["next"] = follow
                    new["repeat"] = ""
                    new["repeated"] = True
            if new["done"] and lst.get("shared") and it.get("by") and it["by"] != user:
                notify.append((it["by"], f"{user} a fait : {it['text']}"))
        if new.get("assignee") and new["assignee"] != before and new["assignee"] != user:
            notify.append((new["assignee"], f"{user} te confie : {new['text']} ({lst['name']})"))
        it.clear()
        it.update(new)
        out["item"] = it
        if "move" in f:  # réordonner : position dans la liste
            lst["items"].remove(it)
            lst["items"].insert(max(0, min(int(f["move"]), len(lst["items"]))), it)
    store.update("taches", {"lists": []}, go)
    for who, text in notify:
        activity.log(who, "taches", text, f"#/taches/{lid}")
    return jsonify(out)


@bp.delete("/api/tasks/<lid>/items/<iid>")
def delete_item(lid, iid):
    user = g.user["name"]

    def go(d):
        lst = _find(d, lid, user)
        lst["items"] = [i for i in lst["items"] if i["id"] != iid]
    store.update("taches", {"lists": []}, go)
    return jsonify(ok=True)


def quick_add(user, text, list_name=None):
    """Ajout rapide (commandes vocales, API) : « acheter des piles » dans la liste nommée ou la première."""
    _defaults(user)
    d = load()
    lists_ = [l for l in d["lists"] if visible(l, user)]
    lst = next((l for l in lists_ if list_name and l["name"].lower() == list_name.lower()), None) or lists_[0]
    it = _clean({"text": text, "notes": "", "assignee": "", "due": "", "repeat": ""}, user)
    store.update("taches", {"lists": []}, lambda x: next(l for l in x["lists"] if l["id"] == lst["id"])["items"].insert(0, it))
    return lst["name"], it
