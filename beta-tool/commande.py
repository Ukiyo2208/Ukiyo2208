"""Commandes en langage courant, à la voix ou au clavier : « ajoute du lait à la liste de courses »,
« rendez-vous chez le dentiste mardi à 14h », « qu'est-ce que j'ai demain ? », « où est mon colis ? »…

Utilisé par le micro de l'appli (/api/command) et par les Raccourcis iPhone / Google Assistant /
Home Assistant (/api/v1/command avec un jeton). Tout est compris sur le NAS, sans service en ligne."""

import re
import time
import unicodedata
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request

import settings
import store

bp = Blueprint("commande", __name__)

EXAMPLES = ["Ajoute du lait et des œufs à la liste de courses", "Rendez-vous chez le dentiste mardi à 14h30",
            "Rappelle-moi d'appeler le garage demain à 9h", "Ajoute « réparer le vélo » à la liste Maison", "Qu'est-ce que j'ai demain ?",
            "Où en sont mes colis ?", "Combien j'ai dépensé ce mois-ci ?", "Quel temps fait-il ?", "Résumé de ma journée"]


def plain(s):
    s = unicodedata.normalize("NFKD", str(s or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[’']", "'", re.sub(r"\s+", " ", s)).strip(" .!?")


def norm_map(raw):
    """Texte simplifié (minuscules, sans accents) + position de chaque caractère dans le texte d'origine."""
    out, idx = [], []
    for i, ch in enumerate(raw):
        p = unicodedata.normalize("NFKD", ch.lower()).encode("ascii", "ignore").decode() or ("'" if ch in "’" else "")
        for c in p:
            out.append(c)
            idx.append(i)
    idx.append(len(raw))
    return "".join(out), idx


def raw_group(raw, idx, m, n=1):
    """Groupe n d'une recherche faite sur le texte simplifié, recopié depuis le texte d'origine."""
    return raw[idx[m.start(n)]:idx[m.end(n)]] if m.end(n) > m.start(n) else ""


def _split_items(text):
    """« du lait, des œufs et 2 baguettes » → ["lait", "œufs", "2 baguettes"]."""
    parts = re.split(r",|\bet\b|\bpuis\b|\bainsi que\b", text)
    out = []
    for p in parts:
        p = re.sub(r"^\s*(du|de la|de l'|des|de|d'|le|la|les|l'|un|une)\s+", "", p.strip(), flags=re.I).strip(" .«»\"")
        if p:
            out.append(p[:1].upper() + p[1:])
    return out


def _strip_dates(text):
    """Retire les dates et heures d'une phrase pour garder le titre."""
    import datefr
    t = text
    for f in datefr.find(text):
        t = t.replace(f["text"], " ")
    t = re.sub(r"\b(demain|aujourd'hui|apres-demain|après-demain|ce soir|ce matin|ce midi|cet après-midi)\b", " ", t, flags=re.I)
    t = re.sub(r"\b(à|a|vers|pour|le|de|d')\s*$", "", re.sub(r"\s+", " ", t).strip(" ,.")).strip(" ,.")
    return t


def _say_when(start, allday):
    d = start if isinstance(start, date) and not isinstance(start, datetime) else start.date()
    today = date.today()
    day = "aujourd'hui" if d == today else "demain" if d == today + timedelta(days=1) else f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"
    day = day.replace("Monday", "lundi").replace("Tuesday", "mardi").replace("Wednesday", "mercredi").replace("Thursday", "jeudi").replace("Friday", "vendredi").replace("Saturday", "samedi").replace("Sunday", "dimanche")
    for en, fr in (("January", "janvier"), ("February", "février"), ("March", "mars"), ("April", "avril"), ("May", "mai"), ("June", "juin"), ("July", "juillet"),
                   ("August", "août"), ("September", "septembre"), ("October", "octobre"), ("November", "novembre"), ("December", "décembre")):
        day = day.replace(en, fr)
    return day if allday else f"{day} à {start.hour}h{start.minute:02d}".replace("h00", "h")


# --- Actions --------------------------------------------------------------------------------------------------

def add_shopping(user, items):
    import recipes

    def go(data):
        for t in items:
            data["items"].append({"id": uuid.uuid4().hex[:8], "text": t, "aisle": recipes.aisle_of(t), "checked": False, "by": user, "added": time.time()})
        data["updated"] = time.time()
    store.update("courses", {"items": [], "updated": 0}, go)
    return {"speech": f"C'est noté : {', '.join(items)} sur la liste de courses.", "link": "#/recettes/courses", "action": "shopping"}


def add_task(user, text, list_name=None, due=None):
    import taches
    name, it = taches.quick_add(user, text, list_name)
    if due:
        def go(d):
            for l in d["lists"]:
                for i in l["items"]:
                    if i["id"] == it["id"]:
                        i["due"] = due.isoformat()
        store.update("taches", {"lists": []}, go)
    return {"speech": f"J'ai ajouté « {it['text']} » à la liste {name}" + (f" pour {_say_when(due, True)}" if due else "") + ".", "link": "#/taches", "action": "task"}


def add_event(user, title, found, reminder=None):
    import agenda
    f = found[0]
    s = f["start"]
    if f["allday"]:
        d = {"title": title, "allday": True, "start": s.isoformat(), "end": s.isoformat(), "reminder": "-480" if reminder else ""}
    else:
        d = {"title": title, "allday": False, "start": s.strftime("%Y-%m-%dT%H:%M"), "end": (s + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M"),
             "reminder": "0" if reminder else "30"}
    agenda.write_event(user, "personnel", d)
    return {"speech": f"{'Rappel' if reminder else 'Rendez-vous'} « {title} » ajouté {_say_when(s, f['allday'])}.", "link": "#/agenda", "action": "event"}


def agenda_day(user, day):
    import agenda
    s = datetime.combine(day, datetime.min.time())
    evs = [e for e in agenda.all_events(user, s, s + timedelta(days=1)) if not e.get("paid")]
    when = "aujourd'hui" if day == date.today() else "demain" if day == date.today() + timedelta(days=1) else _say_when(day, True)
    if not evs:
        return {"speech": f"Rien de prévu {when}.", "link": "#/agenda", "action": "agenda"}
    parts = []
    for e in evs[:6]:
        parts.append(e["title"] if e["allday"] else f"{e['title']} à {int(e['start'][11:13])}h{e['start'][14:16]}".replace("h00", "h"))
    return {"speech": f"{when.capitalize()}, tu as {len(evs)} chose{'s' if len(evs) > 1 else ''} : " + ", ".join(parts) + ".", "link": "#/agenda", "action": "agenda"}


def parcels(user):
    import colis
    items = colis.brief(user, date.today())
    if not items:
        return {"speech": "Aucun colis en route.", "link": "#/colis", "action": "parcels"}
    return {"speech": " ; ".join(f"{p['text']} : {p['sub']}" for p in items[:5]) + ".", "link": "#/colis", "action": "parcels"}


def spending(user):
    import budget
    d = budget.load(user)
    if not d["tx"]:
        return {"speech": "Je n'ai pas encore tes relevés : importe-les dans l'outil Budget.", "link": "#/budget", "action": "budget"}
    s = budget.summary(d, date.today().isoformat()[:7])
    top = list(s["by_cat"].items())[:2]
    return {"speech": f"Ce mois-ci, tu as dépensé {budget.euros(s['spent'])}" + (f", surtout en {top[0][0].lower()} ({budget.euros(top[0][1])})" if top else "") + ".",
            "link": "#/budget", "action": "budget"}


def weather(user):
    import journee
    w = journee.weather(journee.prefs(user), date.today())
    if not w:
        return {"speech": "Indique ta ville dans Ma journée pour avoir la météo.", "link": "#/journee", "action": "weather"}
    return {"speech": f"{w['label']}, entre {w['min']} et {w['max']} degrés" + (f", {w['rain']} % de risque de pluie" if w.get("rain") else "") + ".", "link": "#/journee", "action": "weather"}


def day_summary(user):
    import journee
    b = journee.build(user)
    return {"speech": journee.summary(b) or "Journée calme, rien de spécial.", "link": "#/journee", "action": "summary"}


# --- Compréhension ---------------------------------------------------------------------------------------------

def run(user, raw):
    import datefr
    raw = re.sub(r"\s+", " ", str(raw or "")).strip(" .!?")[:500]
    t, idx = norm_map(raw)
    if not t:
        raise ValueError("Dis ou écris une commande")
    on = settings.enabled

    # Liste de courses
    m = re.search(r"(?:ajoute|rajoute|mets|met|note|il faut|achete|acheter)\s+(.+?)\s+(?:a|dans|sur)\s+(?:la|ma)\s+liste (?:de |des )?courses?$", t) \
        or re.search(r"^(?:liste de courses|courses)\s*:?\s+(.+)$", t)
    if m and on("recettes"):
        items = _split_items(raw_group(raw, idx, m))
        return add_shopping(user, items)

    # Tâche dans une liste nommée : « ajoute X à la liste Maison »
    m = re.search(r"(?:ajoute|rajoute|mets|note)\s+(.+?)\s+(?:a|dans|sur)\s+(?:la liste|ma liste|mes taches|la liste des taches)\s*(.*)$", t)
    if m and on("taches"):
        text = raw_group(raw, idx, m).strip(" «»\"")
        found = datefr.find(text)
        return add_task(user, _strip_dates(text) or text, m.group(2).strip() or None, found[0]["start"] if found and found[0]["allday"] else None)

    # Rappel : « rappelle-moi de … demain à 9h »
    m = re.search(r"^(?:rappelle[- ]moi|fais[- ]moi penser|n'oublie pas)\s+(?:de |d'|que |a )?(.+)$", t)
    if m:
        rest = re.sub(r"^\s*(rappelle[- ]moi|fais[- ]moi penser|n['’]oublie pas)\s+(de |d['’]|que |à |a )?", "", raw, flags=re.I)
        found = datefr.find(rest)
        title = _strip_dates(rest) or rest
        title = title[:1].upper() + title[1:]
        if found and on("agenda"):
            return add_event(user, title, found, reminder=True)
        if on("taches"):
            return add_task(user, title)

    # Rendez-vous / événement
    m = re.search(r"^(?:ajoute |cree |note |prends |mets )?(?:un |le )?(rendez-vous|rdv|reunion|diner|dejeuner|anniversaire|evenement|rendez vous)\b(.*)$", t)
    if m and on("agenda"):
        found = datefr.find(raw)
        if not found:
            return {"speech": "Pour quand ? Dis par exemple « rendez-vous chez le dentiste mardi à 14h ».", "action": "ask"}
        title = _strip_dates(re.sub(r"^(ajoute|crée|cree|note|prends|mets)\s+(un|le)?\s*", "", raw, flags=re.I))
        title = re.sub(r"^(rdv|rendez vous)\b", "Rendez-vous", title, flags=re.I).strip() or "Rendez-vous"
        return add_event(user, title[:1].upper() + title[1:], found)

    # Questions
    if re.search(r"(qu'est-ce que|qu est ce que|quoi|programme|planning|agenda).*(aujourd'hui|demain|ce soir|apres-demain)|^(aujourd'hui|demain)\s*\?*$|j'ai quoi", t) and on("agenda"):
        day = date.today() + timedelta(days=2 if "apres-demain" in t else 1 if "demain" in t else 0)
        return agenda_day(user, day)
    if re.search(r"\bcolis\b|livraison|paquet|commande", t) and on("colis"):
        return parcels(user)
    if re.search(r"depense|budget|combien.*(mois|semaine)|argent", t) and on("budget"):
        return spending(user)
    if re.search(r"meteo|temps fait|pleuvoir|pluie|temperature|fait-il|fait il", t) and on("journee"):
        return weather(user)
    if re.search(r"resume|ma journee|bonjour|quoi de neuf", t) and on("journee"):
        return day_summary(user)

    # Par défaut : une tâche (« acheter des piles », « appeler maman »)
    if re.search(r"^(ajoute|rajoute|note|penser a|pense a)\b", t) and on("taches"):
        text = re.sub(r"^(ajoute|rajoute|note|penser à|pense à|penser a|pense a)\s+", "", raw, flags=re.I)
        found = datefr.find(text)
        return add_task(user, _strip_dates(text) or text, None, found[0]["start"] if found and found[0]["allday"] else None)
    return {"speech": "Je n'ai pas compris. Essaie par exemple : « " + EXAMPLES[0] + " » ou « " + EXAMPLES[4] + " ».", "action": "unknown", "examples": EXAMPLES}


@bp.post("/api/command")
def command():
    d = request.get_json(silent=True) or {}
    return jsonify(run(g.user["name"], d.get("text")))


@bp.get("/api/command/examples")
def examples():
    return jsonify(EXAMPLES)
