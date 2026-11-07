"""La maison vue par Bêta home, Alexa et HomeKit : ce qu'on affiche, ce qu'on a le droit de commander.

Tout passe par la connexion Home Assistant de Bêta (HA_URL + HA_TOKEN) : le navigateur et Alexa ne
parlent jamais directement à Home Assistant. Les serrures, portes de garage et portails sont affichés
mais jamais commandés depuis la page, ni depuis Alexa ou HomeKit.
"""

from __future__ import annotations

import json
import os
import re
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


def _choix(option, liste, quoi: str) -> str:
    if option is None or str(option) not in [str(x) for x in (liste or [])]:
        raise ActionRefusee(f"{quoi} inconnu")
    return str(option)


def commande_page(entite: str, action: str, valeur, attributs: dict, option: str | None = None) -> tuple[str, str, dict]:
    """(domaine, service, données) pour une action de la page, ou ActionRefusee."""
    domaine = entite.split(".", 1)[0]
    at = attributs
    if domaine == "lock" or (domaine == "cover" and attributs.get("device_class") in INTERDITS):
        raise ActionRefusee("Serrures, portes de garage et portails ne se commandent pas depuis la page")
    cible = {"entity_id": entite}
    table = {
        ("light", "basculer"): ("light", "toggle", {}),
        ("light", "luminosite"): ("light", "turn_on", lambda: {"brightness_pct": _borne(valeur, 1, 100)}),
        ("light", "temperature_couleur"): ("light", "turn_on", lambda: {"color_temp_kelvin": _borne(
            valeur, int(at.get("min_color_temp_kelvin") or 2000), int(at.get("max_color_temp_kelvin") or 6500))}),
        ("light", "couleur"): ("light", "turn_on", lambda: {"hs_color": [_borne(valeur, 0, 360, float), 100]}),
        ("fan", "vitesse"): ("fan", "set_percentage", lambda: {"percentage": _borne(valeur, 0, 100)}),
        ("cover", "inclinaison"): ("cover", "set_cover_tilt_position", lambda: {"tilt_position": _borne(valeur, 0, 100)}),
        ("climate", "mode"): ("climate", "set_hvac_mode", lambda: {"hvac_mode": _choix(option, at.get("hvac_modes"), "mode")}),
        ("climate", "ventilation"): ("climate", "set_fan_mode", lambda: {"fan_mode": _choix(option, at.get("fan_modes"), "mode")}),
        ("climate", "preset"): ("climate", "set_preset_mode", lambda: {"preset_mode": _choix(option, at.get("preset_modes"), "mode")}),
        ("media_player", "source"): ("media_player", "select_source", lambda: {"source": _choix(option, at.get("source_list"), "source")}),
        ("media_player", "volume_plus"): ("media_player", "volume_up", {}),
        ("media_player", "volume_moins"): ("media_player", "volume_down", {}),
        ("vacuum", "pause"): ("vacuum", "pause", {}),
        ("vacuum", "localiser"): ("vacuum", "locate", {}),
        ("vacuum", "vitesse"): ("vacuum", "set_fan_speed", lambda: {"fan_speed": _choix(option, at.get("fan_speed_list"), "vitesse")}),
        ("number", "valeur"): ("number", "set_value", lambda: {"value": _borne(valeur, at.get("min", 0), at.get("max", 100), float)}),
        ("input_number", "valeur"): ("input_number", "set_value", lambda: {"value": _borne(valeur, at.get("min", 0), at.get("max", 100), float)}),
        ("select", "choisir"): ("select", "select_option", lambda: {"option": _choix(option, at.get("options"), "choix")}),
        ("input_select", "choisir"): ("input_select", "select_option", lambda: {"option": _choix(option, at.get("options"), "choix")}),
        ("button", "appuyer"): ("button", "press", {}),
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


# ---------------------------------------------------------------- Appareils (une tuile par appareil de Home Assistant)

_ORDRE_PRINCIPAL = ["camera", "vacuum", "climate", "media_player", "cover", "light", "fan", "switch", "input_boolean",
                    "lock", "select", "number", "input_select", "input_number", "button", "sensor", "binary_sensor"]
_TYPES_TEXTE = [  # (motif dans le nom ou le modèle de l'appareil, type)
    (r"lave.?linge|washer|washing|machine a laver|lavelinge|waschmaschine", "lave_linge"),
    (r"seche.?linge|dryer|trockner|sechoir", "seche_linge"),
    (r"lave.?vaisselle|dishwasher|geschirr", "lave_vaisselle"),
    (r"\btv\b|tele|television|bravia|webos|android tv|google tv|apple tv|shield|chromecast|fire tv|freebox player", "tele"),
]
_ETAT_MACHINE = r"etat|state|status|operation|machine|run|cycle|phase|programme_en_cours|activite"
_RESTANT = r"restant|remaining|time_left|temps_restant|finish|fin_|end_time|duree_restante|remain"
_PROGRES = r"progres|progress|avancement|pourcentage"
_PROGRAMME = r"programme|program|mode_de_lavage|cycle_selection|selected_program"
_MA_POSITION = r"\bmy\b|_my_|my_position|ma_position|favori|favorite|preferred|preset_position"


def _sans_accent(texte: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", str(texte or "")).encode("ascii", "ignore").decode().lower()


def type_appareil(nom: str, modele: str, entites: list[dict]) -> str:
    domaines = {e["id"].split(".", 1)[0] for e in entites}
    texte = _sans_accent(f"{nom} {modele}")
    if "camera" in domaines:
        return "camera"
    if "vacuum" in domaines:
        return "aspirateur"
    for motif, type_ in _TYPES_TEXTE:
        if re.search(motif, texte):
            if type_ == "tele" and "media_player" not in domaines:
                continue
            return type_
    if any(e["id"].startswith("media_player.") and (e.get("attr") or {}).get("device_class") == "tv" for e in entites):
        return "tele"
    for domaine, type_ in (("climate", "clim"), ("cover", "volet"), ("media_player", "enceinte"), ("light", "lumiere"),
                           ("fan", "ventilateur"), ("switch", "prise"), ("input_boolean", "prise"), ("lock", "serrure")):
        if domaine in domaines:
            return type_
    return "capteur" if domaines <= {"sensor", "binary_sensor"} else "autre"


def _cherche(entites: list[dict], motif: str, domaines: tuple) -> str | None:
    for e in entites:
        if e["id"].split(".", 1)[0] in domaines and re.search(motif, _sans_accent(f"{e['id']} {e.get('nom', '')}")):
            return e["id"]
    return None


def groupes(entites: list[dict], appareils_ha: dict[str, dict]) -> list[dict]:
    """Une tuile par appareil : son type, son entité principale, ses infos importantes, toutes ses entités.
    Les entités sans appareil restent seules. Les appareils faits uniquement de capteurs ne font pas de tuile
    (leurs températures, humidités et détecteurs vont dans l'en-tête de la pièce)."""
    paquets: dict[str, list[dict]] = {}
    for e in entites:
        paquets.setdefault(e.get("appareil") or e["id"], []).append(e)
    resultat = []
    for cle, membres in paquets.items():
        info = appareils_ha.get(cle, {})
        nom = info.get("nom") or (membres[0]["nom"] if len(membres) == 1 else cle)
        type_ = type_appareil(nom, info.get("modele", ""), membres)
        if type_ == "capteur" or all(m["id"].startswith("scene.") for m in membres):
            continue
        rang = {d: i for i, d in enumerate(_ORDRE_PRINCIPAL)}
        principal = min(membres, key=lambda m: rang.get(m["id"].split(".", 1)[0], 99))["id"]
        extra = {}
        if type_ in ("lave_linge", "seche_linge", "lave_vaisselle"):
            extra = {"etat": _cherche(membres, _ETAT_MACHINE, ("sensor", "select", "binary_sensor")),
                     "restant": _cherche(membres, _RESTANT, ("sensor",)),
                     "progression": _cherche(membres, _PROGRES, ("sensor",)),
                     "programme": _cherche(membres, _PROGRAMME, ("sensor", "select"))}
            principal = next((m["id"] for m in membres if m["id"].split(".", 1)[0] in ("switch",)), extra["etat"] or principal)
        if type_ == "volet":
            extra = {"ma_position": _cherche(membres, _MA_POSITION, ("button",))}
        if type_ in ("prise", "tele", "enceinte"):
            extra = {"puissance": next((m["id"] for m in membres if (m.get("attr") or {}).get("device_class") == "power"), None)}
        tete = next(m for m in membres if m["id"] == principal)
        resultat.append({
            "id": cle, "nom": nom, "type": type_, "principal": principal, "fabricant": info.get("fabricant", ""),
            "modele": info.get("modele", ""), "piece": tete.get("piece", ""), "piece_id": tete.get("piece_id", ""),
            "etage": tete.get("etage", ""), "entites": [m["id"] for m in membres], **{k: v for k, v in extra.items() if v},
        })
    return resultat


class Favoris:
    """« Ma position » des volets sans bouton « My » : la position enregistrée dans Bêta home."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        try:
            self.positions: dict[str, int] = json.loads(fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.positions = {}

    def enregistrer(self, entite: str, position) -> None:
        self.positions[entite] = _borne(position, 0, 100)
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.positions), encoding="utf-8")
        os.replace(tmp, self.fichier)


def commande_ma_position(volet: str, groupe: dict | None, favoris: Favoris) -> tuple[str, str, dict]:
    """Le bouton « My » de l'appareil (Somfy…) s'il existe, sinon la position enregistrée (50 % par défaut)."""
    bouton = (groupe or {}).get("ma_position")
    if bouton:
        return "button", "press", {"entity_id": bouton}
    return "cover", "set_cover_position", {"entity_id": volet, "position": favoris.positions.get(volet, 50)}


# ---------------------------------------------------------------- Voiture (FordPass dans Home Assistant)

# (clé, libellé, motif reconnu dans l'identifiant ou le nom, domaines) : repris de Bêta home, dans l'ordre
CHAMPS_VOITURE = [
    ("batterie", "Batterie", r"soc|battery_level|elveh|charge_level|state_of_charge|batterie", ("sensor",)),
    ("autonomie", "Autonomie", r"range|autonomie|distance_to_empty|dte", ("sensor",)),
    ("carburant", "Carburant", r"fuel|carburant", ("sensor",)),
    ("charge", "Charge", r"charging|charge_status|en_charge", ("sensor", "binary_sensor")),
    ("verrou", "Verrouillage", r"lock|verrou", ("lock", "sensor")),
    ("portes", "Portes", r"door|porte", ("sensor", "binary_sensor")),
    ("fenetres", "Fenêtres", r"window|fenetre", ("sensor", "binary_sensor")),
    ("position", "Position", r"tracker|location|position|gps", ("device_tracker", "sensor")),
    ("kilometrage", "Kilométrage", r"odometer|odo|kilometrage", ("sensor",)),
    ("pneus", "Pneus", r"tire|tyre|pneu", ("sensor",)),
    ("huile", "Huile", r"oil|huile", ("sensor",)),
    ("batterie12v", "Batterie 12 V", r"12v|battery$|batt_12|aux", ("sensor",)),
    ("demarrage", "Démarrage à distance", r"remote_start|ignition|start|demarr", ("switch", "button")),
    ("actualiser", "Actualiser", r"refresh|update|actualis", ("button",)),
]


def voiture(entites: list[dict], nom: str = "Voiture") -> dict | None:
    """La tuile voiture, ou None tant qu'aucune entité de la voiture n'est dans Home Assistant."""
    if not entites:
        return None
    pris, champs = set(), {}
    for cle, libelle, motif, domaines in CHAMPS_VOITURE:
        e = next((x for x in entites if x["id"].split(".", 1)[0] in domaines and x["id"] not in pris
                  and re.search(motif, f"{x['id']} {x.get('nom', '')}", re.IGNORECASE)), None)
        if e:
            pris.add(e["id"])
            champs[cle] = {"id": e["id"], "libelle": libelle, "etat": e.get("etat"), "unite": e.get("unite") or "",
                           "lat": e.get("lat"), "lon": e.get("lon")}
    # Une « batterie » qui n'est pas un pourcentage (autonomie, « Unsupported » sur une voiture essence) est ignorée
    if "batterie" in champs and not (0 <= (_nombre(champs["batterie"]["etat"]) or -1) <= 100):
        del champs["batterie"]
    return {"nom": nom, "champs": champs}


def commande_voiture(v: dict | None, action: str) -> tuple[str, str, dict]:
    """Verrouiller, démarrer à distance (préchauffage) ou actualiser. Jamais déverrouiller depuis la page."""
    champs = (v or {}).get("champs", {})
    cle = {"verrouiller": "verrou", "demarrer": "demarrage", "actualiser": "actualiser"}.get(action)
    entite = champs.get(cle, {}).get("id") if cle else None
    if not entite:
        raise ActionRefusee("action impossible sur cette voiture")
    domaine = entite.split(".", 1)[0]
    if action == "verrouiller" and domaine == "lock":
        return "lock", "lock", {"entity_id": entite}
    if action in ("demarrer", "actualiser") and domaine == "button":
        return "button", "press", {"entity_id": entite}
    if action == "demarrer" and domaine == "switch":
        return "switch", "turn_on", {"entity_id": entite}
    raise ActionRefusee("action impossible sur cette voiture")


# ---------------------------------------------------------------- Alexa (Matter) et HomeKit

CIBLES = ("alexa", "homekit")
# Partagés par défaut : lumières, volets, ventilateurs, scènes, et les interrupteurs déclarés comme prises.
# Les autres (beaucoup d'interrupteurs sont des réglages d'appareils) se cochent un par un dans Bêta home.
_PAR_DEFAUT = {"light", "cover", "fan", "scene"}


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
        domaine, classe = a["id"].split(".", 1)[0], (a.get("attr") or {}).get("device_class")
        return self.choix[cible].get(a["id"], domaine in _PAR_DEFAUT or (domaine == "switch" and classe == "outlet"))

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
                        "appareils": hk.get("devices"), "ignores": hk.get("ignores") or 0, "max": hk.get("max")},
        }


def _nombre(valeur):
    try:
        return round(float(valeur), 1)
    except (TypeError, ValueError):
        return None
