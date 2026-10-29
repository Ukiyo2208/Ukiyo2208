"""Profils enfants : un compte « Enfant » ne voit que les outils choisis par les parents, seulement
aux heures permises (semaine / week-end) et avec un temps d'utilisation par jour.

Le temps est compté à la minute près, uniquement quand la page est ouverte et utilisée (l'appli
envoie un signe de vie chaque minute quand l'onglet est visible et qu'on s'en sert). Un parent peut
donner du temps en plus pour la journée."""

import threading
import time
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request

import activity
import auth
import settings
import store

bp = Blueprint("famille", __name__)
_lock = threading.Lock()
DEFAULT = {"tools": ["journee", "taches", "agenda", "recettes", "notes", "medias", "photos"],
           "week": ["07:30", "20:00"], "weekend": ["08:30", "21:00"], "limit": 90, "bonus": {}}
# routes toujours permises (page, réglages perso, notifications…)
ALWAYS = {"config", "me", "avatar", "connections", "famille", "activity", "push", "auth", "search", "dashboard", "suggestions", "save", "fs", "public"}
PARENTS_ONLY = {"users", "settings", "update", "backup", "accounts", "restart", "v1", "vpn"}


def rules(name):
    u = auth.find(name) or {}
    r = {**DEFAULT, **(u.get("child") or {})}
    r["bonus"] = {k: v for k, v in (r.get("bonus") or {}).items() if k >= date.today().isoformat()}
    return r


def usage(name, day=None):
    day = day or date.today().isoformat()
    return len(store.load("famille/usage", {}).get(name, {}).get(day, []))


def _hm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def state(name, now=None):
    """Où en est l'enfant : temps utilisé, restant, et pourquoi c'est bloqué (ou None)."""
    now = now or datetime.now()
    r = rules(name)
    start, end = r["weekend" if now.weekday() >= 5 else "week"]
    minute = now.hour * 60 + now.minute
    used = usage(name, now.date().isoformat())
    limit = (r["limit"] or 0) + r["bonus"].get(now.date().isoformat(), 0)
    remaining = max(0, limit - used) if r["limit"] else None
    blocked = None
    if not (_hm(start) <= minute < _hm(end)):
        blocked = f"Bêta Tool est disponible de {start.replace(':', 'h')} à {end.replace(':', 'h')}" + (" le week-end." if now.weekday() >= 5 else " en semaine.")
    elif remaining == 0:
        blocked = "Ton temps d'écran est terminé pour aujourd'hui. Demande à un parent si tu as besoin de plus de temps."
    return {"tools": r["tools"], "hours": [start, end], "limit": limit if r["limit"] else 0, "used": used, "remaining": remaining, "blocked": blocked}


def gate(user, path):
    """Appelé avant chaque requête : message d'erreur si un enfant n'a pas le droit, sinon None."""
    if not user or user.get("role") != "child" or not path.startswith("/api/"):
        return None
    seg = path.split("/")[2] if path.count("/") >= 2 else ""
    if seg in PARENTS_ONLY or (seg == "me" and "/tokens" in path):
        return "Réservé aux parents."
    if seg in ALWAYS:
        return None
    st = state(user["name"])
    if st["blocked"]:
        return st["blocked"]
    tool = next((t for t, (prefixes, _) in settings.TOOLS.items() if any(path.startswith(p) for p in prefixes)), None)
    if tool and tool not in st["tools"]:
        return "Cet outil n'est pas autorisé sur ton compte."
    return None


def allowed_tools(user, tools):
    """Pour /api/config : les outils interdits à l'enfant apparaissent comme désactivés."""
    if not user or user.get("role") != "child":
        return tools
    ok = set(rules(user["name"])["tools"])
    return {t: on and t in ok for t, on in tools.items()}


def _parents():
    return [u["name"] for u in auth.users() if u["role"] == "admin"]


# --- Routes --------------------------------------------------------------------------------------------

@bp.post("/api/famille/ping")
def ping():
    """Signe de vie de l'appli (une fois par minute quand la page est visible et utilisée)."""
    user = g.user
    if user.get("role") != "child":
        return jsonify(ok=True)
    now = datetime.now()
    stamp = now.strftime("%H:%M")
    day = now.date().isoformat()
    before = state(user["name"], now)

    def go(d):
        days = d.setdefault(user["name"], {})
        mins = days.setdefault(day, [])
        if stamp not in mins and not before["blocked"]:
            mins.append(stamp)
        for k in [k for k in days if k < (now.date() - timedelta(days=35)).isoformat()]:
            del days[k]
    store.update("famille/usage", {}, go)
    st = state(user["name"], now)
    if st["remaining"] == 5 and before["remaining"] == 6:
        activity.log(user["name"], "famille", "Plus que 5 minutes aujourd'hui.", "#/", push=False)
    if st["remaining"] == 0 and before["remaining"] == 1:
        for p in _parents():
            activity.log(p, "famille", f"{user['name']} a utilisé tout son temps d'écran aujourd'hui ({st['used']} min).", "#/reglages/famille")
    return jsonify(st)


@bp.get("/api/famille/me")
def me():
    if g.user.get("role") != "child":
        return jsonify(child=False)
    return jsonify(child=True, **state(g.user["name"]))


def _admin():
    if g.user.get("role") != "admin":
        raise PermissionError("Réservé aux parents (administrateurs)")


@bp.get("/api/famille")
def overview():
    _admin()
    out = []
    today = date.today()
    for u in auth.users():
        if u["role"] != "child":
            continue
        week = [{"day": (today - timedelta(days=i)).isoformat(), "min": usage(u["name"], (today - timedelta(days=i)).isoformat())} for i in range(6, -1, -1)]
        out.append({"name": u["name"], "rules": rules(u["name"]), "state": state(u["name"]), "week": week})
    tools = [t for t in settings.TOOLS if settings.enabled(t)]
    return jsonify(children=out, tools=tools)


@bp.put("/api/famille/<name>")
def set_rules(name):
    _admin()
    f = request.get_json(force=True)

    def clean_hours(v, default):
        try:
            a, b = str(v[0])[:5], str(v[1])[:5]
            _hm(a), _hm(b)
            return [a, b]
        except (ValueError, IndexError, TypeError):
            return default

    def go(data):
        u = next((u for u in data["users"] if u["name"] == name), None)
        if not u or u["role"] != "child":
            raise ValueError("Ce compte n'est pas un compte enfant")
        r = {**DEFAULT, **(u.get("child") or {})}
        if "tools" in f:
            r["tools"] = [t for t in f["tools"] if t in settings.TOOLS]
        if "week" in f:
            r["week"] = clean_hours(f["week"], r["week"])
        if "weekend" in f:
            r["weekend"] = clean_hours(f["weekend"], r["weekend"])
        if "limit" in f:
            r["limit"] = max(0, min(24 * 60, int(f["limit"] or 0)))
        if "bonus" in f:  # minutes en plus aujourd'hui
            day = date.today().isoformat()
            r["bonus"] = {k: v for k, v in (r.get("bonus") or {}).items() if k >= day}
            r["bonus"][day] = max(0, r["bonus"].get(day, 0) + int(f["bonus"]))
        u["child"] = r
    store.update("users", {"users": []}, go)
    if f.get("bonus"):
        activity.log(name, "famille", f"Tu as {int(f['bonus'])} minutes de plus aujourd'hui.", "#/")
    return jsonify(state(name))
