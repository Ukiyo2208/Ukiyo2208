"""La maison vue par Bêta home et par Alexa : ce qu'on affiche, ce qu'on a le droit de commander.

Tout passe par la connexion Home Assistant de Bêta (HA_URL + HA_TOKEN) : le navigateur et Alexa ne
parlent jamais directement à Home Assistant. Les serrures, portes de garage et portails sont affichés
mais jamais commandés depuis la page ni depuis Alexa.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

CAPTEURS = {"temperature", "humidity"}  # sensor.* affichés (les autres sont trop nombreux)
DETECTEURS = {"door", "window", "garage_door", "opening", "motion", "occupancy", "presence", "moisture", "smoke"}
INTERDITS = {"garage", "gate", "door"}  # device_class de volets jamais commandés (porte de garage, portail)


class ActionRefusee(ValueError):
    pass


def utile(a: dict) -> bool:
    """Garde ce qu'une page de maison doit montrer, sans les centaines de capteurs techniques."""
    domaine = a["id"].split(".", 1)[0]
    classe = (a.get("attr") or {}).get("device_class")
    if a.get("etat") == "unavailable" and domaine in ("sensor", "binary_sensor"):
        return False
    if domaine == "sensor":
        return classe in CAPTEURS
    if domaine == "binary_sensor":
        return classe in DETECTEURS
    return True


def appareils(donnees: dict) -> list[dict]:
    return [a for a in donnees.get("appareils", []) if utile(a)]


def commande_page(entite: str, action: str, valeur, attributs: dict) -> tuple[str, str, dict]:
    """(domaine, service, données) pour une action de la page, ou ActionRefusee."""
    domaine = entite.split(".", 1)[0]
    if domaine == "lock" or (domaine == "cover" and attributs.get("device_class") in INTERDITS):
        raise ActionRefusee("Serrures, portes de garage et portails ne se commandent pas depuis la page")
    cible = {"entity_id": entite}
    table = {
        ("light", "basculer"): ("light", "toggle", {}),
        ("light", "luminosite"): ("light", "turn_on", lambda: {"brightness_pct": _borne(valeur, 1, 100)}),
        ("switch", "basculer"): ("switch", "toggle", {}),
        ("input_boolean", "basculer"): ("input_boolean", "toggle", {}),
        ("fan", "basculer"): ("fan", "toggle", {}),
        ("media_player", "basculer"): ("media_player", "toggle", {}),
        ("cover", "ouvrir"): ("cover", "open_cover", {}),
        ("cover", "fermer"): ("cover", "close_cover", {}),
        ("cover", "stop"): ("cover", "stop_cover", {}),
        ("cover", "position"): ("cover", "set_cover_position", lambda: {"position": _borne(valeur, 0, 100)}),
        ("climate", "temperature"): ("climate", "set_temperature", lambda: {"temperature": _borne(valeur, 5, 35, float)}),
        ("climate", "allumer"): ("climate", "turn_on", {}),
        ("climate", "eteindre"): ("climate", "turn_off", {}),
        ("scene", "lancer"): ("scene", "turn_on", {}),
        ("vacuum", "lancer"): ("vacuum", "start", {}),
        ("vacuum", "base"): ("vacuum", "return_to_base", {}),
    }
    if (domaine, action) not in table:
        raise ActionRefusee(f"Action « {action} » impossible sur {domaine}")
    d, service, extra = table[(domaine, action)]
    return d, service, cible | (extra() if callable(extra) else extra)


def _borne(valeur, mini, maxi, type_=int):
    try:
        return max(mini, min(maxi, type_(valeur)))
    except (TypeError, ValueError) as e:
        raise ActionRefusee("valeur invalide") from e


# ---------------------------------------------------------------- Alexa (pont Matter)

_PAR_DEFAUT_ALEXA = {"light", "switch", "cover", "fan", "scene"}


class Alexa:
    """Quels appareils Alexa voit, l'état du pont, et la traduction vers le pont Matter."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.statut: dict = {}
        try:
            donnees = json.loads(fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            donnees = {}
        self.choix: dict[str, bool] = donnees.get("choix", {})  # entité -> visible ou non (sinon : par défaut)

    def sauver(self) -> None:
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps({"choix": self.choix}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.fichier)

    @staticmethod
    def type_matter(a: dict) -> str | None:
        """Type d'appareil Matter, ou None si Alexa ne peut pas (ou ne doit pas) le voir."""
        domaine, classe = a["id"].split(".", 1)[0], (a.get("attr") or {}).get("device_class")
        if domaine == "light":
            return "light"
        if domaine in ("switch", "input_boolean", "fan", "media_player"):
            return "plug"
        if domaine == "cover":
            return None if classe in INTERDITS else "cover"
        if domaine == "scene":
            return "button"
        if domaine == "sensor":
            return {"temperature": "temp", "humidity": "hum"}.get(classe)
        if domaine == "binary_sensor":
            return "motion" if classe in ("motion", "occupancy", "presence") else "door" if classe in ("door", "window", "opening", "garage_door") else None
        return None  # serrures, clim, aspirateur : non

    def visible(self, a: dict) -> bool:
        if not self.type_matter(a):
            return False
        return self.choix.get(a["id"], a["id"].split(".", 1)[0] in _PAR_DEFAUT_ALEXA)

    def elements(self, liste: list[dict]) -> list[dict]:
        """Le format attendu par le pont Matter (repris de Bêta home)."""
        resultat = []
        for a in liste:
            if not self.visible(a):
                continue
            t, attr, etat = self.type_matter(a), a.get("attr") or {}, a.get("etat")
            element = {"key": a["id"], "name": a["nom"], "kind": t, "type": "button" if t == "button" else "device"}
            if t == "light":
                bri = attr.get("brightness")
                element["state"] = {"on": etat == "on", "bri": round(bri / 2.55) if bri is not None else (100 if etat == "on" else 0)}
            elif t == "plug":
                element["state"] = {"on": etat in ("on", "playing", "paused", "idle")}
            elif t == "cover":
                pos = attr.get("current_position")
                element["state"] = {"pos": pos if pos is not None else (100 if etat == "open" else 0)}
            elif t in ("temp", "hum"):
                element["state"] = {"val": _nombre(etat)}
            elif t in ("door", "motion"):
                element["state"] = {"on": etat == "on"}
            else:
                element["state"] = {"on": False}
            resultat.append(element)
        return resultat

    def commande(self, a: dict, patch: dict) -> tuple[str, str, dict]:
        """Un ordre d'Alexa -> (domaine, service, données), seulement pour un appareil visible par Alexa."""
        if not self.visible(a):
            raise ActionRefusee("appareil non partagé avec Alexa")
        entite, t = a["id"], self.type_matter(a)
        cible = {"entity_id": entite}
        if t == "button" and patch.get("run"):
            return "scene", "turn_on", cible
        if t == "light" and "bri" in patch:
            return "light", "turn_on", cible | {"brightness_pct": _borne(patch["bri"], 1, 100)}
        if t in ("light", "plug") and "on" in patch:
            return "homeassistant", "turn_on" if patch["on"] else "turn_off", cible
        if t == "cover" and patch.get("moving") == "stop":
            return "cover", "stop_cover", cible
        if t == "cover" and "pos" in patch:
            pos = _borne(patch["pos"], 0, 100)
            if (a.get("attr") or {}).get("current_position") is None:  # volet sans position : ouvert ou fermé
                return "cover", "open_cover" if pos >= 50 else "close_cover", cible
            return "cover", "set_cover_position", cible | {"position": pos}
        raise ActionRefusee("ordre non pris en charge")

    def etat_pont(self) -> dict:
        en_ligne = bool(self.statut) and time.time() - self.statut.get("recu", 0) < 90
        return {**{k: v for k, v in self.statut.items() if k != "recu"}, "en_ligne": en_ligne}


def _nombre(valeur):
    try:
        return round(float(valeur), 1)
    except (TypeError, ValueError):
        return None
