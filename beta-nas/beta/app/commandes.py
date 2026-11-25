"""Commandes vocales de Bêta en plus de celles de Home Assistant :

- « résumé », « quoi de neuf ? » : le résumé du matin ;
- « combien j'ai consommé ? » : l'énergie d'aujourd'hui et d'hier ;
- « lance la tondeuse », « rentre la tondeuse » ;
- « mets le ballon à 60 », « éteins le chauffe-eau » ;
- « mets le déshumidificateur à 50 % », « allume l'humidificateur » ;
- Bêta Tool : « ajoute du lait à la liste de courses », « rappelle-moi d'appeler le garage demain à 9h »,
  « rendez-vous chez le dentiste mardi à 14h », « qu'est-ce que j'ai demain ? », « où en sont mes colis ? »,
  « combien j'ai dépensé ce mois-ci ? ».

Ici on reconnaît seulement la demande (testable sans rien d'autre) ; main.py l'exécute.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

DOMOTIQUE, PERSO, LIBRE = "domotique", "mails", "questions"  # capacité demandée (voir settings.py)


@dataclass
class Intention:
    type: str  # resume, energie, appareil, beta_tool
    capacite: str
    domaine: str = ""
    action: str = ""
    valeur: float | None = None
    texte: str = ""


def _simple(texte: str) -> str:
    t = unicodedata.normalize("NFKD", texte.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t.replace("’", "'")).strip(" .!?")


_ETEINDRE = re.compile(r"\b(eteins|eteindre|coupe|couper|arrete|arreter|stoppe|desactive)\b")
_ALLUMER = re.compile(r"\b(allume|allumer|demarre|demarrer|active|activer|lance|lancer|mets en marche|remets)\b")
_NOMBRE = re.compile(r"\b(\d{1,3}(?:[.,]\d)?)\s*(?:degres?|°|%|pour ?cent)?")


def reconnaitre(texte: str) -> Intention | None:
    intention = _reconnaitre(texte)
    if intention and not intention.texte:
        intention.texte = texte.strip()
    return intention


def _reconnaitre(texte: str) -> Intention | None:
    t = _simple(texte)
    if not t:
        return None
    if re.search(r"\b(resume|quoi de neuf|programme du jour|ma journee|briefing)\b", t):
        return Intention("resume", LIBRE)
    if re.search(r"\b(consomm\w*|electricite|kwh|kilowatt)\b", t) and not re.search(r"\b(allume|eteins|mets)\b", t):
        return Intention("energie", LIBRE)

    if re.search(r"\b(tondeuse|tondre|tonte)\b", t):
        if re.search(r"\b(rentre|rentrer|range|ranger|base|maison|garage|retour)\b", t) or _ETEINDRE.search(t):
            return Intention("appareil", DOMOTIQUE, "lawn_mower", "base")
        if re.search(r"\bpause\b", t):
            return Intention("appareil", DOMOTIQUE, "lawn_mower", "pause")
        return Intention("appareil", DOMOTIQUE, "lawn_mower", "lancer")

    if re.search(r"\b(chauffe.?eau|ballon|cumulus)\b", t):
        nombre = _NOMBRE.search(re.sub(r"\b(chauffe.?eau|ballon|cumulus)\b", "", t))
        if nombre and re.search(r"\b(mets|met|regle|passe|monte|baisse|a)\b", t):
            return Intention("appareil", DOMOTIQUE, "water_heater", "temperature", float(nombre.group(1).replace(",", ".")))
        if _ETEINDRE.search(t):
            return Intention("appareil", DOMOTIQUE, "water_heater", "eteindre")
        if _ALLUMER.search(t):
            return Intention("appareil", DOMOTIQUE, "water_heater", "allumer")

    if re.search(r"\b(des)?humidificateur\b", t):
        nombre = _NOMBRE.search(t)
        if nombre:
            return Intention("appareil", DOMOTIQUE, "humidifier", "humidite", float(nombre.group(1).replace(",", ".")))
        if _ETEINDRE.search(t):
            return Intention("appareil", DOMOTIQUE, "humidifier", "eteindre")
        if _ALLUMER.search(t):
            return Intention("appareil", DOMOTIQUE, "humidifier", "allumer")

    if (re.search(r"\b(liste de courses|liste des courses|courses|a la liste|dans la liste|sur la liste|mes taches)\b", t)
            or re.search(r"^(rappelle[- ]moi|fais[- ]moi penser|n'oublie pas)\b", t)
            or re.search(r"\b(rendez-vous|rendez vous|rdv)\b", t)
            or re.search(r"(qu'est-ce que|qu est ce que|j'ai quoi|mon agenda|mon programme).*(aujourd'hui|demain|ce soir|apres-demain|semaine)?", t)
            and re.search(r"\b(j'ai|agenda|programme)\b", t)
            or re.search(r"\b(colis|livraison|paquet)\b", t)
            or re.search(r"\b(depense|depenses|budget)\b", t)):
        return Intention("beta_tool", PERSO, texte=texte.strip())
    return None


def choisir_entite(intention: Intention, appareils: list[dict], texte: str) -> dict | None:
    """L'entité visée : celle du bon domaine dont le nom est dans la phrase, sinon la seule (ou la première)."""
    candidats = [a for a in appareils if a["id"].startswith(intention.domaine + ".") and not a.get("technique")]
    if not candidats:
        return None
    t = _simple(texte)
    for a in candidats:
        mots = [m for m in re.findall(r"\w+", _simple(a.get("nom", ""))) if len(m) > 3]
        if mots and any(m in t for m in mots if m not in ("ballon", "tondeuse", "chauffe", "deshumidificateur", "humidificateur")):
            return a
        if a.get("piece") and _simple(a["piece"]) in t:
            return a
    return candidats[0]


def phrase(intention: Intention, entite: dict) -> str:
    nom = entite.get("nom", "l'appareil")
    v = intention.valeur
    textes = {
        ("lawn_mower", "lancer"): f"C'est parti, {nom} commence à tondre.",
        ("lawn_mower", "base"): f"{nom} rentre à sa base.",
        ("lawn_mower", "pause"): f"{nom} est en pause.",
        ("water_heater", "temperature"): f"Je règle {nom} à {v:g} degrés." if v is not None else "",
        ("water_heater", "allumer"): f"J'allume {nom}.",
        ("water_heater", "eteindre"): f"J'éteins {nom}.",
        ("humidifier", "humidite"): f"Je règle {nom} à {v:g} % d'humidité." if v is not None else "",
        ("humidifier", "allumer"): f"J'allume {nom}.",
        ("humidifier", "eteindre"): f"J'éteins {nom}.",
    }
    return textes.get((intention.domaine, intention.action), "C'est fait.")
