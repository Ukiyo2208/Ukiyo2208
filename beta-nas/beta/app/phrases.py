"""Des réponses naturelles pour les commandes de la maison, sans IA (instantané).

Home Assistant répond de façon sèche (« Allumé », « Éteint »). Bêta reprend plutôt tes propres mots :
« éteins la lumière du salon » -> « D'accord, j'éteins la lumière du salon. »
Les réponses à une question (« quelle température fait-il ? ») restent celles de Home Assistant.
"""

from __future__ import annotations

import random
import re
import unicodedata

# forme de la commande (impératif, infinitif, sans accent) -> ce que dit Bêta
VERBES = {
    "allume": "j'allume", "allumer": "j'allume", "allumes": "j'allume",
    "eteins": "j'éteins", "eteint": "j'éteins", "eteindre": "j'éteins", "etein": "j'éteins",
    "ouvre": "j'ouvre", "ouvrir": "j'ouvre", "ouvres": "j'ouvre",
    "ferme": "je ferme", "fermer": "je ferme", "fermes": "je ferme",
    "monte": "je monte", "monter": "je monte", "remonte": "je remonte", "remonter": "je remonte",
    "baisse": "je baisse", "baisser": "je baisse", "descends": "je descends", "descendre": "je descends",
    "abaisse": "j'abaisse",
    "active": "j'active", "activer": "j'active", "desactive": "je désactive", "desactiver": "je désactive",
    "lance": "je lance", "lancer": "je lance", "demarre": "je démarre", "demarrer": "je démarre",
    "arrete": "j'arrête", "arreter": "j'arrête", "stoppe": "j'arrête", "stopper": "j'arrête", "coupe": "je coupe",
    "couper": "je coupe",
    "mets": "je mets", "mettre": "je mets", "met": "je mets", "regle": "je règle", "regler": "je règle",
    "augmente": "j'augmente", "augmenter": "j'augmente", "diminue": "je baisse", "diminuer": "je baisse",
    "tamise": "je tamise", "tamiser": "je tamise", "passe": "je passe", "passer": "je passe",
}
DEBUTS = ["D'accord, ", "OK, ", "Très bien, ", "C'est parti, ", ""]
# politesse et appels en début ou fin de phrase
_POLITESSE = re.compile(
    r"^\W*((hey|hé|eh|dis|ok)\s+)?(b[eê]ta[\s,]*)?((est-ce que |peux-tu |tu peux |tu pourrais |pourrais-tu |"
    r"je veux que tu |j'aimerais que tu |je voudrais que tu |merci de |s'il te pla[iî]t,? )+)?",
    re.IGNORECASE)
_FIN = re.compile(r"[\s,]*(s'il te pla[iî]t|s'il vous pla[iî]t|stp|svp|merci|b[eê]ta)?[\s.!?,]*$", re.IGNORECASE)


def _sans_accent(mot: str) -> str:
    return unicodedata.normalize("NFKD", mot).encode("ascii", "ignore").decode().lower()


def naturelle(commande: str, reponse_ha, choix=random.choice) -> str:
    """La phrase à dire après une commande comprise par Home Assistant."""
    texte_ha = (getattr(reponse_ha, "texte", "") or "").strip()
    if getattr(reponse_ha, "type", "") != "action_done" or getattr(reponse_ha, "echecs", None):
        return texte_ha or "C'est fait."  # une question, ou une partie a échoué : la réponse de Home Assistant
    phrase = _FIN.sub("", _POLITESSE.sub("", commande.strip()))
    mots = phrase.split()
    if not mots:
        return texte_ha or "C'est fait."
    verbe = _sans_accent(re.sub(r"-(moi|nous|le|la|les|lui)$", "", mots[0], flags=re.IGNORECASE))
    action = VERBES.get(verbe)
    reste = " ".join(mots[1:]).strip()
    if not action:
        return texte_ha or "C'est fait."
    if not reste:  # « allume » tout seul : on nomme ce que Home Assistant a touché
        noms = [c.get("name") for c in (getattr(reponse_ha, "reussis", None) or []) if c.get("name")]
        reste = " et ".join(noms[:3]) if noms else "ça"
    debut = choix(DEBUTS)
    corps = f"{action} {reste}"
    if not debut:
        corps = corps[0].upper() + corps[1:]
    return f"{debut}{corps}."
