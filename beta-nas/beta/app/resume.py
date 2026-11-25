"""Résumé du matin, dit à la voix par la tablette : météo, poubelles, colis (et agenda, tâches si la personne
est reconnue) depuis Bêta Tool, ce qui est resté allumé ou ouvert, les alertes de la nuit, la consommation d'hier.

Bêta Tool est lu avec un jeton « assistant » (Bêta Tool → Réglages → API → droit « Commandes vocales et
widget »), dans BETA_TOOL_JETON. Sans jeton, le résumé se fait avec la maison seulement.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime

import httpx

log = logging.getLogger("beta.resume")

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
METEO = {"sunny": "ensoleillé", "clear-night": "ciel dégagé", "cloudy": "nuageux", "partlycloudy": "quelques nuages",
         "rainy": "pluvieux", "pouring": "forte pluie", "snowy": "neige", "snowy-rainy": "neige et pluie", "fog": "brouillard",
         "windy": "du vent", "windy-variant": "du vent et des nuages", "lightning": "orageux", "lightning-rainy": "orages et pluie",
         "hail": "grêle", "exceptional": "temps exceptionnel"}


async def lire_beta_tool(url: str, jeton: str) -> dict | None:
    """Le widget de Bêta Tool (météo du jour, rendez-vous, tâches, poubelles, colis…), ou None."""
    if not jeton:
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{url}/api/v1/widget", headers={"Authorization": f"Bearer {jeton}"})
            r.raise_for_status()
            return r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.info("Bêta Tool indisponible pour le résumé : %s", e)
        return None


async def commande_beta_tool(url: str, jeton: str, texte: str) -> str | None:
    """Envoie une phrase à Bêta Tool (courses, rappels, rendez-vous, agenda, colis, dépenses) ; sa réponse à dire."""
    if not jeton:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(f"{url}/api/v1/command", json={"text": texte}, headers={"Authorization": f"Bearer {jeton}"})
            r.raise_for_status()
            return (r.json() or {}).get("speech")
    except (httpx.HTTPError, ValueError) as e:
        log.info("Bêta Tool indisponible pour « %s » : %s", texte, e)
        return None


def _nombre(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _poubelle(titre: str) -> str:
    return titre.split(" ", 1)[-1].split(" (")[0].lower() if " " in titre else titre.lower()


def composer(maison: dict, groupes: list[dict], outil: dict | None, alertes: list, energie_hier: dict | None,
             perso: bool = False, maintenant: datetime | None = None) -> dict:
    """Le texte du résumé et ses morceaux (pour l'écran). `perso` : la personne est reconnue (agenda, tâches)."""
    maintenant = maintenant or datetime.now().astimezone()
    h = maintenant.hour
    salut = "Bonjour" if 5 <= h < 18 else "Bonsoir"
    morceaux: list[str] = [f"{salut} ! Nous sommes {JOURS[maintenant.weekday()]} {maintenant.day} {MOIS[maintenant.month - 1]}."]

    # météo : celle de Bêta Tool (min, max, pluie) sinon celle de Home Assistant
    w = (outil or {}).get("weather")
    meteo = maison.get("meteo")
    if w and w.get("min") is not None:
        phrase = f"Aujourd'hui, {str(w.get('label') or '').lower() or 'météo'}, de {round(w['min'])} à {round(w['max'])} degrés"
        if (w.get("rain") or 0) >= 40:
            phrase += f", {w['rain']} % de risque de pluie, pense au parapluie"
        morceaux.append(phrase + ".")
    elif meteo and meteo.get("temperature") is not None:
        morceaux.append(f"Dehors, il fait {round(float(meteo['temperature']))} degrés, {METEO.get(meteo.get('etat'), 'météo inconnue')}.")

    if outil:
        if outil.get("fete"):
            morceaux.append(f"On fête les {outil['fete']}.")
        if perso and outil.get("events"):
            ev = outil["events"]
            premier = ev[0]
            morceaux.append(f"Tu as {len(ev)} rendez-vous" + (f", le premier à {premier['time']} : {premier['title']}." if premier.get("time")
                                                                else f" : {premier['title']}."))
        if perso and outil.get("tasks_count"):
            n = outil["tasks_count"]
            morceaux.append(f"{n} tâche{'s' if n > 1 else ''} à faire.")
        if outil.get("bins"):
            morceaux.append("Ce soir, sortir la poubelle " + " et ".join(_poubelle(t) for t in outil["bins"]) + ".")
        if outil.get("parcels"):
            n = outil["parcels"]
            morceaux.append(f"{n} colis en route." if n > 1 else "Un colis est en route.")

    # la maison : ce qui est resté allumé ou ouvert
    appareils = maison.get("appareils", [])
    lumieres = [a for a in appareils if a["id"].startswith("light.") and a.get("etat") == "on"]
    ouverts = [a for a in appareils if a["id"].startswith("binary_sensor.") and a.get("etat") == "on"
               and (a.get("attr") or {}).get("device_class") in ("door", "window", "garage_door", "opening")]
    if lumieres:
        morceaux.append(f"{len(lumieres)} lumière{'s sont restées allumées' if len(lumieres) > 1 else ' est restée allumée'}"
                        + (f" : {', '.join(a['nom'] for a in lumieres[:3])}." if len(lumieres) <= 3 else "."))
    if ouverts:
        morceaux.append("Encore ouvert : " + ", ".join(a["nom"] for a in ouverts[:4]) + ".")
    machines = [g for g in groupes if g.get("type") in ("lave_linge", "seche_linge", "lave_vaisselle")]
    par_id = {a["id"]: a for a in appareils}
    for g in machines:
        etat = par_id.get(g.get("etat") or "")
        if etat and re.search(r"finish|termin|end|complete|fini|done", str(etat.get("etat")), re.I):
            morceaux.append(f"{g['nom']} a terminé, pense à le vider.")

    if alertes:
        morceaux.append("Cette nuit : " + " ; ".join(a.message.rstrip(".") for a in alertes[:3]) + ".")
    if energie_hier and energie_hier.get("kwh"):
        morceaux.append(f"Hier, la maison a consommé {str(round(energie_hier['kwh'], 1)).replace('.', ',')} kilowattheures, "
                        f"soit {str(round(energie_hier['euros'], 2)).replace('.', ',')} euros.")
    if len(morceaux) == 1:
        morceaux.append("Tout est calme à la maison.")
    morceaux.append("Bonne journée !" if h < 18 else "Bonne soirée !")
    return {"texte": " ".join(morceaux), "morceaux": morceaux, "beta_tool": outil is not None}
