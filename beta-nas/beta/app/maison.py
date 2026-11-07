"""La maison vue par Bêta home, Alexa et HomeKit : ce qu'on affiche, ce qu'on a le droit de commander.

Tout passe par la connexion Home Assistant de Bêta (HA_URL + HA_TOKEN) : le navigateur et Alexa ne
parlent jamais directement à Home Assistant. Les serrures, portes de garage et portails sont affichés
mais jamais commandés depuis la page, ni depuis Alexa ou HomeKit.
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
        ("media_player", "lecture"): ("media_player", "media_play_pause", {}),
        ("media_player", "suivant"): ("media_player", "media_next_track", {}),
        ("media_player", "precedent"): ("media_player", "media_previous_track", {}),
        ("media_player", "volume"): ("media_player", "volume_set", lambda: {"volume_level": _borne(valeur, 0, 100) / 100}),
        ("media_player", "radio"): ("media_player", "play_media", lambda: _radio(valeur)),
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


# Radios en direct (celles de Bêta home) : jouées sur une enceinte de Home Assistant ou dans le navigateur
RADIOS = [
    {"id": "inter", "nom": "France Inter", "url": "https://icecast.radiofrance.fr/franceinter-midfi.mp3", "couleur": "#e2001a"},
    {"id": "info", "nom": "franceinfo", "url": "https://icecast.radiofrance.fr/franceinfo-midfi.mp3", "couleur": "#ffd100"},
    {"id": "fip", "nom": "FIP", "url": "https://icecast.radiofrance.fr/fip-midfi.mp3", "couleur": "#e2007a"},
    {"id": "musique", "nom": "France Musique", "url": "https://icecast.radiofrance.fr/francemusique-midfi.mp3", "couleur": "#7b2dff"},
    {"id": "culture", "nom": "France Culture", "url": "https://icecast.radiofrance.fr/franceculture-midfi.mp3", "couleur": "#8b1cff"},
    {"id": "mouv", "nom": "Mouv'", "url": "https://icecast.radiofrance.fr/mouv-midfi.mp3", "couleur": "#ff2d55"},
    {"id": "nrj", "nom": "NRJ", "url": "https://cdn.nrjaudio.fm/audio1/fr/30001/mp3_128.mp3", "couleur": "#e30613"},
    {"id": "fg", "nom": "Radio FG", "url": "https://stream.rcs.revma.com/wknqhm4yuchvv", "couleur": "#1f9bff"},
]


def _radio(rang) -> dict:
    try:
        radio = RADIOS[int(rang)]
    except (TypeError, ValueError, IndexError) as e:
        raise ActionRefusee("radio inconnue") from e
    return {"media_content_id": radio["url"], "media_content_type": "music"}


def _borne(valeur, mini, maxi, type_=int):
    try:
        return max(mini, min(maxi, type_(valeur)))
    except (TypeError, ValueError) as e:
        raise ActionRefusee("valeur invalide") from e


# ---------------------------------------------------------------- Alexa (Matter) et HomeKit

CIBLES = ("alexa", "homekit")
_PAR_DEFAUT = {"light", "switch", "cover", "fan", "scene"}


class Partage:
    """Quels appareils voient Alexa et HomeKit (choix séparés), l'état des ponts, et la traduction vers eux.
    Les deux ponts tournent dans le conteneur beta-ponts (Matter pour Alexa, HAP pour l'app Maison d'Apple)."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.statut: dict = {}
        try:
            donnees = json.loads(fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            donnees = {}
        if "choix" in donnees:  # première version : seulement Alexa
            donnees = {"alexa": donnees["choix"]}
        self.choix: dict[str, dict[str, bool]] = {c: dict(donnees.get(c, {})) for c in CIBLES}

    def sauver(self) -> None:
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.choix, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.fichier)

    def choisir(self, entite: str, cible: str, visible: bool) -> None:
        if cible not in CIBLES:
            raise ActionRefusee("cible inconnue")
        self.choix[cible][entite] = visible
        self.sauver()

    @staticmethod
    def type_pont(a: dict) -> str | None:
        """Type d'appareil pour les ponts, ou None si Alexa et HomeKit ne doivent pas le voir."""
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
        return None  # serrures, clim, aspirateur : jamais

    def visible(self, a: dict, cible: str) -> bool:
        if not self.type_pont(a) or cible not in CIBLES:
            return False
        return self.choix[cible].get(a["id"], a["id"].split(".", 1)[0] in _PAR_DEFAUT)

    def elements(self, liste: list[dict], cible: str) -> list[dict]:
        """Le format attendu par les ponts (repris de Bêta home)."""
        resultat = []
        for a in liste:
            if not self.visible(a, cible):
                continue
            t, attr, etat = self.type_pont(a), a.get("attr") or {}, a.get("etat")
            element = {"key": a["id"], "name": a["nom"], "kind": t, "type": "button" if t == "button" else "device", cible: True}
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

    def commande(self, a: dict, patch: dict, cible: str) -> tuple[str, str, dict]:
        """Un ordre d'Alexa ou de l'app Maison -> (domaine, service, données), seulement pour un appareil partagé."""
        if not self.visible(a, cible):
            raise ActionRefusee("appareil non partagé")
        entite, t = a["id"], self.type_pont(a)
        cible_ha = {"entity_id": entite}
        if t == "button" and patch.get("run"):
            return "scene", "turn_on", cible_ha
        if t == "light" and "bri" in patch:
            return "light", "turn_on", cible_ha | {"brightness_pct": _borne(patch["bri"], 1, 100)}
        if t in ("light", "plug") and "on" in patch:
            return "homeassistant", "turn_on" if patch["on"] else "turn_off", cible_ha
        if t == "cover" and patch.get("moving") == "stop":
            return "cover", "stop_cover", cible_ha
        if t == "cover" and "pos" in patch:
            pos = _borne(patch["pos"], 0, 100)
            if (a.get("attr") or {}).get("current_position") is None:  # volet sans position : ouvert ou fermé
                return "cover", "open_cover" if pos >= 50 else "close_cover", cible_ha
            return "cover", "set_cover_position", cible_ha | {"position": pos}
        raise ActionRefusee("ordre non pris en charge")

    def etat_ponts(self) -> dict:
        """{"alexa": {...}, "homekit": {...}} : en ligne, appairé, codes."""
        en_ligne = bool(self.statut) and time.time() - self.statut.get("recu", 0) < 90
        hk = self.statut.get("hk") or {}
        return {
            "alexa": {"en_ligne": en_ligne and not self.statut.get("matterErr"), "erreur": self.statut.get("matterErr", ""),
                      "pont_en_ligne": en_ligne, "appaire": bool(self.statut.get("commissioned")),
                      "code": self.statut.get("manual"), "qr": self.statut.get("qr"),
                      "partenaires": self.statut.get("fabrics") or [], "appareils": self.statut.get("devices")},
            "homekit": {"en_ligne": en_ligne and bool(hk), "erreur": self.statut.get("hkErr", ""), "pont_en_ligne": en_ligne,
                        "appaire": bool(hk.get("paired")), "code": hk.get("pin"), "qr": hk.get("uri"),
                        "appareils": hk.get("devices")},
        }


def _nombre(valeur):
    try:
        return round(float(valeur), 1)
    except (TypeError, ValueError):
        return None
