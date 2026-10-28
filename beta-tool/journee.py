"""Outil « Ma journée » : le résumé du jour sur une seule page (météo, rendez-vous, poubelles à
sortir ce soir, tâches, mails, colis, papiers à payer, anniversaires et fêtes), et chaque matin à
l'heure choisie une notification qui le résume.

Chaque outil fournit sa partie avec une fonction `brief(user, today)` (voir SOURCES) ; un outil
désactivé ou en panne est simplement ignoré."""

import os
import threading
import time
from datetime import date, datetime, timedelta

import requests
from flask import Blueprint, g, jsonify, request

import activity
import auth
import fetes
import settings
import store

bp = Blueprint("journee", __name__)
GEO = os.environ.get("GEOCODE_URL", "https://geocoding-api.open-meteo.com/v1/search")
METEO = os.environ.get("WEATHER_URL", "https://api.open-meteo.com/v1/forecast")
DEFAULT = {"time": "07:30", "push": True, "city": "", "lat": None, "lon": None}
WMO = {0: ("☀️", "Grand soleil"), 1: ("🌤️", "Plutôt ensoleillé"), 2: ("⛅", "Éclaircies"), 3: ("☁️", "Couvert"), 45: ("🌫️", "Brouillard"), 48: ("🌫️", "Brouillard givrant"),
       51: ("🌦️", "Bruine"), 53: ("🌦️", "Bruine"), 55: ("🌦️", "Bruine forte"), 61: ("🌧️", "Pluie faible"), 63: ("🌧️", "Pluie"), 65: ("🌧️", "Forte pluie"),
       66: ("🌧️", "Pluie verglaçante"), 67: ("🌧️", "Pluie verglaçante"), 71: ("🌨️", "Neige faible"), 73: ("🌨️", "Neige"), 75: ("❄️", "Forte neige"),
       77: ("🌨️", "Grains de neige"), 80: ("🌦️", "Averses"), 81: ("🌧️", "Averses"), 82: ("⛈️", "Fortes averses"), 85: ("🌨️", "Averses de neige"),
       86: ("🌨️", "Averses de neige"), 95: ("⛈️", "Orages"), 96: ("⛈️", "Orages et grêle"), 99: ("⛈️", "Orages et grêle")}
_weather = {}  # (lat, lon, jour) → (heure, données)
BIN_EMOJI = ("🗑️", "♻️", "🍾", "📰", "🌿", "🛋️", "🥕")


def prefs(user):
    return {**DEFAULT, **store.load("journee/prefs", {}).get(user, {})}


def hm(iso):
    return iso[11:16].replace(":", "h").lstrip("0").replace("h00", "h") if len(iso) > 11 else ""


# --- Les parties du résumé ------------------------------------------------------------------

def weather(p, today):
    if p.get("lat") is None:
        return None
    key = (p["lat"], p["lon"], today.isoformat())
    hit = _weather.get(key)
    if hit and time.time() - hit[0] < 3 * 3600:
        return hit[1]
    try:
        r = requests.get(METEO, timeout=8, params={"latitude": p["lat"], "longitude": p["lon"], "timezone": "auto", "forecast_days": 2,
                                                   "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
        d = r.json()["daily"]
        i = d["time"].index(today.isoformat()) if today.isoformat() in d["time"] else 0
        code = d["weathercode"][i]
        emoji, label = WMO.get(code, ("🌡️", "Météo"))
        out = {"emoji": emoji, "label": label, "min": round(d["temperature_2m_min"][i]), "max": round(d["temperature_2m_max"][i]),
               "rain": d["precipitation_probability_max"][i], "city": p.get("city")}
        _weather[key] = (time.time(), out)
        return out
    except Exception:  # noqa: BLE001  pas d'Internet : on s'en passe
        return None


def agenda_part(user, today):
    import agenda
    start = datetime.combine(today, datetime.min.time())
    events = agenda.all_events(user, start, start + timedelta(days=2))
    tomorrow = (today + timedelta(days=1)).isoformat()
    todays, bins, birthdays = [], [], []
    for e in events:
        day = e["start"][:10]
        is_bin = e.get("category") == "Poubelles" or e["title"].startswith(BIN_EMOJI)
        if is_bin and day == tomorrow:
            bins.append(e["title"])
        elif e["cal"] in ("_anniversaires", "_fetes") and day == today.isoformat():
            birthdays.append(e["title"])
        elif day <= today.isoformat() < (e["end"][:10] if e["allday"] else "9999") or day == today.isoformat():
            if e["cal"] in ("_anniversaires", "_fetes") or is_bin and day != today.isoformat():
                continue
            todays.append({"text": e["title"], "sub": "Toute la journée" if e["allday"] else f"{hm(e['start'])} – {hm(e['end'])}"
                           + (f" · {e['location']}" if e.get("location") else ""), "time": "" if e["allday"] else hm(e["start"]), "link": e.get("link") or f"#/agenda?date={today.isoformat()}"})
    todays.sort(key=lambda x: (x["time"] != "", x["time"].zfill(5)))
    return todays, bins, birthdays


def mail_part(user, today):
    import accounts
    import mail
    accs = [a for a in accounts.of(user) if a.get("mail")]
    if not accs:
        return None
    unread = sum(mail._unread.get(a["id"], 0) for a in accs)
    important = []
    try:
        trusted, _ = mail.trust_lists(user)
        for a in accs[:3]:
            with mail.session(a) as c:
                mail.select(c, "INBOX")
                uids = mail.search_uids(c, "", unread=True)[:15]
                for m in mail.summaries(c, [u.decode() for u in uids], a):
                    sender = (m["from"][0]["email"] if m["from"] else "").lower()
                    if sender in trusted and not m.get("security"):
                        important.append({"text": m["subject"], "sub": (m["from"][0]["name"] or sender), "link": f"#/mails/{a['id']}?uid={m['uid']}"})
    except Exception:  # noqa: BLE001
        pass
    return {"unread": unread, "important": important[:5]}


def papers_part(user, today):
    import paperasse
    limit = (today + timedelta(days=7)).isoformat()
    out = []
    for d in sorted(paperasse.upcoming(days=7), key=lambda d: d["due"]):
        if d["due"] <= limit:
            late = d["due"] < today.isoformat()
            amount = f" · {d['amount']:.2f} €".replace(".", ",") if d.get("amount") else ""
            out.append({"text": d.get("issuer") or d.get("title") or "Document", "sub": ("En retard depuis le " if late else "À payer le ")
                        + date.fromisoformat(d["due"]).strftime("%d/%m") + amount, "late": late, "link": f"#/paperasse/doc/{d['id']}"})
    return out


SOURCES = {  # parties fournies par d'autres outils (ajoutées par ces outils)
}


def build(user, today=None):
    today = today or date.today()
    p = prefs(user)
    out = {"date": today.isoformat(), "fete": fetes.label(today), "weather": weather(p, today), "city": p.get("city")}
    if settings.enabled("agenda"):
        try:
            out["events"], out["bins"], out["birthdays"] = agenda_part(user, today)
        except Exception as e:  # noqa: BLE001
            print("journée agenda", e, flush=True)
    if settings.enabled("mails"):
        out["mail"] = mail_part(user, today)
    if settings.enabled("paperasse"):
        try:
            out["papers"] = papers_part(user, today)
        except Exception as e:  # noqa: BLE001
            print("journée paperasse", e, flush=True)
    for name, (tool, fn) in SOURCES.items():
        if settings.enabled(tool):
            try:
                out[name] = fn(user, today)
            except Exception as e:  # noqa: BLE001
                print("journée", name, e, flush=True)
    return out


def summary(b):
    """Une phrase pour la notification du matin."""
    parts = []
    w = b.get("weather")
    if w:
        parts.append(f"{w['emoji']} {w['min']}° / {w['max']}°" + (f", pluie {w['rain']} %" if (w.get("rain") or 0) >= 40 else ""))
    ev = b.get("events") or []
    if ev:
        first = ev[0]
        parts.append(f"{len(ev)} rendez-vous" + (f" (dès {first['time']} : {first['text']})" if first.get("time") else f" ({first['text']})"))
    if b.get("tasks"):
        parts.append(f"{len(b['tasks'])} tâche{'s' if len(b['tasks']) > 1 else ''}")
    if b.get("bins"):
        parts.append("ce soir : sortir " + ", ".join(t.split(" ", 1)[-1].split(" (")[0].lower() for t in b["bins"]))
    if b.get("parcels"):
        n = len(b["parcels"])
        parts.append(f"{n} colis en route" if n > 1 else f"colis : {b['parcels'][0]['sub'].lower()}")
    if b.get("papers"):
        parts.append(f"{len(b['papers'])} papier{'s' if len(b['papers']) > 1 else ''} à payer")
    if b.get("birthdays"):
        parts.append(" · ".join(x.replace("🎂 ", "🎂 Anniversaire de ").replace("🌸 Fête de", "🌸 Fête de") for x in b["birthdays"][:2]))
    elif b.get("fete"):
        parts.append(f"Bonne fête aux {b['fete']}")
    return " · ".join(parts) or "Rien de prévu aujourd'hui."


# --- Notification du matin ------------------------------------------------------------------------

def morning_loop():
    sent = store.load("journee/envoyes", {})
    while True:
        time.sleep(30)
        try:
            now = datetime.now()
            users = [u["name"] for u in auth.users()] if auth.mode() == "accounts" else ["local"]
            for user in users:
                p = prefs(user)
                if not p.get("push") or not settings.enabled("journee"):
                    continue
                if now.strftime("%H:%M") < p["time"] or sent.get(user) == now.date().isoformat():
                    continue
                if now.strftime("%H:%M") > (datetime.strptime(p["time"], "%H:%M") + timedelta(hours=2)).strftime("%H:%M"):
                    sent[user] = now.date().isoformat()  # Bêta Tool était arrêté à l'heure prévue : pas de résumé en retard
                    continue
                b = build(user, now.date())
                greet = "Bonjour" + (f" {user}" if user not in ("local", "admin") else "") + " ☀️"
                activity.log(user, "journee", summary(b), "#/journee", title=greet)
                sent[user] = now.date().isoformat()
                store.save("journee/envoyes", sent)
        except Exception as e:  # noqa: BLE001
            print("journée", e, flush=True)


def start():
    threading.Thread(target=morning_loop, daemon=True).start()


# --- Routes -----------------------------------------------------------------------------------------

@bp.get("/api/journee")
def today_route():
    d = request.args.get("date")
    day = date.fromisoformat(d) if d else date.today()
    b = build(g.user["name"], day)
    return jsonify(b | {"summary": summary(b), "prefs": prefs(g.user["name"])})


@bp.put("/api/journee/prefs")
def set_prefs():
    d = request.get_json(silent=True) or {}
    user = g.user["name"]
    p = prefs(user)
    if "time" in d:
        try:
            p["time"] = datetime.strptime(str(d["time"])[:5], "%H:%M").strftime("%H:%M")
        except ValueError:
            raise ValueError("Heure invalide") from None
    if "push" in d:
        p["push"] = bool(d["push"])
    if "city" in d:
        city = str(d["city"] or "").strip()[:80]
        if city and city != p.get("city"):
            try:
                r = requests.get(GEO, params={"name": city, "count": 1, "language": "fr", "format": "json"}, timeout=8).json()
                hit = (r.get("results") or [None])[0]
            except Exception:  # noqa: BLE001
                raise ValueError("Impossible de trouver la ville (le NAS a-t-il accès à Internet ?)") from None
            if not hit:
                raise ValueError("Ville introuvable")
            p.update(city=f"{hit['name']}" + (f" ({hit.get('admin2') or hit.get('admin1')})" if hit.get("admin2") or hit.get("admin1") else ""),
                     lat=hit["latitude"], lon=hit["longitude"])
        elif not city:
            p.update(city="", lat=None, lon=None)
    store.update("journee/prefs", {}, lambda x: x.__setitem__(user, p))
    return jsonify(p)


@bp.post("/api/journee/test")
def test_push():
    b = build(g.user["name"])
    activity.log(g.user["name"], "journee", summary(b), "#/journee", title="Bonjour ☀️ (essai)")
    return jsonify(ok=True)
