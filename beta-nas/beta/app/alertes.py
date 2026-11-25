"""Alertes importantes envoyées sur le téléphone (NOTIFICATIONS, comme le tri) :

- fuite d'eau, fumée, gaz, monoxyde de carbone : tout de suite ;
- porte, fenêtre ou porte de garage ouverte alors que tout le monde est parti (depuis 5 minutes) ;
- lave-linge, sèche-linge ou lave-vaisselle terminé ;
- batterie faible d'un capteur (une fois par jour) ;
- un service de Bêta en panne depuis 5 minutes (et quand il revient) ;
- sauvegarde de la nuit ratée ou trop vieille.

Une alerte n'est envoyée qu'une fois : elle se réarme quand la situation redevient normale.
La logique est ici (testable) ; la boucle qui tourne toutes les minutes est dans main.py.
"""

from __future__ import annotations

import re
import time
from collections import deque
from dataclasses import dataclass, field

URGENCES = {"moisture": ("💧 Fuite d'eau", "Fuite d'eau détectée"), "smoke": ("🔥 Fumée", "Fumée détectée"),
            "gas": ("⚠️ Gaz", "Gaz détecté"), "carbon_monoxide": ("⚠️ Monoxyde de carbone", "Monoxyde de carbone détecté"),
            "safety": ("⚠️ Sécurité", "Alerte de sécurité")}
OUVERTURES = {"door", "window", "garage_door", "opening"}
SERVICES_SURVEILLES = {"home_assistant": "Home Assistant", "whisper": "l'écoute (Whisper)", "piper": "la voix (Piper)",
                       "ollama": "l'IA locale (Ollama)", "presence": "la présence", "trieur": "le tri des documents"}
MACHINES = {"lave_linge": "Le lave-linge", "seche_linge": "Le sèche-linge", "lave_vaisselle": "Le lave-vaisselle"}
_EN_MARCHE = re.compile(r"run|marche|wash|lavage|dry|sechage|séchage|rinc|spin|essor|in_progress|cycle|active|actif|working|^on$", re.I)
_PAS_EN_MARCHE = re.compile(r"pause|finish|termin|end|complete|fini|done|idle|off|standby|ready|pret|prêt|arret|arrêt|stop|inactive", re.I)
ABSENCE_MINUTES = 5
PANNE_MINUTES = 5
UN_JOUR = 24 * 3600
SAUVEGARDE_MAX_HEURES = 36


@dataclass
class Alerte:
    cle: str
    titre: str
    message: str
    quand: float = 0.0
    niveau: str = "info"  # info, attention, urgence


@dataclass
class Surveillance:
    batterie_faible: int = 15
    historique: deque = field(default_factory=lambda: deque(maxlen=50))
    _actives: set = field(default_factory=set)  # alertes déjà envoyées, réarmées quand tout redevient normal
    _derniere: dict = field(default_factory=dict)  # clé -> instant du dernier envoi (alertes quotidiennes)
    _depuis: dict = field(default_factory=dict)  # clé -> depuis quand la situation dure
    _machines: dict = field(default_factory=dict)  # groupe -> en marche au dernier tour
    _services_vus: set = field(default_factory=set)  # services déjà vus en ligne (on ne signale pas ceux qui n'existent pas)

    def verifier(self, appareils: list[dict], groupes: list[dict], personnes: list[dict], services: dict | None = None,
                 sauvegarde: dict | None = None, maintenant: float | None = None) -> list[Alerte]:
        maintenant = time.time() if maintenant is None else maintenant
        nouvelles: list[Alerte] = []
        vues: set[str] = set()  # situations anormales de ce tour

        def une_fois(cle: str, titre: str, message: str, niveau: str = "attention") -> None:
            vues.add(cle)
            if cle not in self._actives:
                self._actives.add(cle)
                nouvelles.append(Alerte(cle, titre, message, maintenant, niveau))

        def par_jour(cle: str, titre: str, message: str) -> None:
            vues.add(cle)
            if cle not in self._derniere or maintenant - self._derniere[cle] >= UN_JOUR:
                self._derniere[cle] = maintenant
                nouvelles.append(Alerte(cle, titre, message, maintenant))

        def dure(cle: str, minutes: float) -> bool:
            vues.add("depuis:" + cle)
            self._depuis.setdefault(cle, maintenant)
            return maintenant - self._depuis[cle] >= minutes * 60

        par_id = {a["id"]: a for a in appareils}
        classe = lambda a: (a.get("attr") or {}).get("device_class")  # noqa: E731
        dom = lambda a: a["id"].split(".", 1)[0]  # noqa: E731
        ou = lambda a: f" ({a['piece']})" if a.get("piece") else ""  # noqa: E731

        # 1. urgences
        for a in appareils:
            if dom(a) == "binary_sensor" and classe(a) in URGENCES and a.get("etat") == "on":
                titre, texte = URGENCES[classe(a)]
                une_fois(f"urgence:{a['id']}", titre, f"{texte} : {a['nom']}{ou(a)}.", "urgence")

        # 2. ouvert alors que tout le monde est parti
        if personnes and all(p.get("etat") not in ("home", "maison") for p in personnes):
            ouverts = [a for a in appareils if not a.get("technique") and (
                (dom(a) == "binary_sensor" and classe(a) in OUVERTURES and a.get("etat") == "on")
                or (dom(a) == "cover" and classe(a) in ("garage", "gate") and a.get("etat") in ("open", "opening")))]
            if ouverts and dure("absence", ABSENCE_MINUTES):
                noms = ", ".join(f"{a['nom']}{ou(a)}" for a in ouverts[:6]) + ("…" if len(ouverts) > 6 else "")
                une_fois("absence:ouvert", "🚪 Maison vide, quelque chose est ouvert", f"Tout le monde est parti mais c'est ouvert : {noms}.")

        # 3. machines terminées
        for g in groupes:
            if g.get("type") not in MACHINES:
                continue
            etat = par_id.get(g.get("etat") or "") or par_id.get(g.get("principal") or "")
            if not etat or etat.get("etat") in ("unavailable", "unknown", None):
                continue
            valeur = str(etat.get("etat"))
            if g.get("etat"):
                en_marche = bool(_EN_MARCHE.search(valeur)) and not _PAS_EN_MARCHE.search(valeur)
            else:  # seulement une prise : en marche si elle consomme
                puissance = par_id.get(g.get("puissance") or "")
                en_marche = _nombre(puissance.get("etat")) > 5 if puissance else False
            avant = self._machines.get(g["id"])
            self._machines[g["id"]] = en_marche
            if avant and not en_marche:
                nouvelles.append(Alerte(f"machine:{g['id']}", f"✅ {MACHINES[g['type']]} a terminé",
                                        f"{MACHINES[g['type']]}{' (' + g['piece'] + ')' if g.get('piece') else ''} a terminé son programme.",
                                        maintenant))

        # 4. batteries faibles (un message par jour, tous les capteurs ensemble)
        faibles = [a for a in appareils if (dom(a) == "sensor" and classe(a) == "battery"
                                            and 0 <= _nombre(a.get("etat"), 101) < self.batterie_faible)
                   or (dom(a) == "binary_sensor" and classe(a) == "battery" and a.get("etat") == "on")]
        if faibles:
            noms = ", ".join(f"{a['nom']} ({a['etat']} %)" if dom(a) == "sensor" else a["nom"] for a in faibles[:8])
            par_jour("batteries", "🔋 Piles à changer", f"Batterie faible : {noms}.")

        # 5. services de Bêta
        for nom, libelle in SERVICES_SURVEILLES.items():
            info = (services or {}).get(nom)
            if info is None:
                continue
            if info.get("ok"):
                self._services_vus.add(nom)
                if f"service:{nom}" in self._actives:
                    nouvelles.append(Alerte(f"retour:{nom}", "✅ Service rétabli", f"{_majuscule(libelle)} fonctionne de nouveau.", maintenant))
            elif nom in self._services_vus and dure(f"service:{nom}", PANNE_MINUTES):
                une_fois(f"service:{nom}", "🛠️ Service en panne", f"{_majuscule(libelle)} ne répond plus depuis {PANNE_MINUTES} minutes.")

        # 6. sauvegarde
        if sauvegarde and sauvegarde.get("existe"):
            age = (maintenant - sauvegarde["derniere_reussie"]) / 3600 if sauvegarde.get("derniere_reussie") else None
            if sauvegarde.get("erreur"):
                par_jour("sauvegarde", "💾 Sauvegarde ratée", f"La sauvegarde de la nuit a échoué : {sauvegarde['erreur']}.")
            elif age is None or age > SAUVEGARDE_MAX_HEURES:
                par_jour("sauvegarde", "💾 Pas de sauvegarde récente",
                         "Aucune sauvegarde réussie depuis plus de 36 heures : vérifie le conteneur beta-sauvegarde.")

        # réarmement : ce qui est redevenu normal pourra être signalé à nouveau
        self._actives &= vues
        for cle in [c for c in self._depuis if "depuis:" + c not in vues]:
            del self._depuis[cle]
        self.historique.extendleft(nouvelles)
        return nouvelles


def _nombre(valeur, defaut: float = 0.0) -> float:
    try:
        return float(valeur)
    except (TypeError, ValueError):
        return defaut


def _majuscule(texte: str) -> str:
    return texte[:1].upper() + texte[1:]
