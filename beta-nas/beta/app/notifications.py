"""Notifications de Bêta (alertes de la maison) et de Bêta Tool : sur plusieurs serveurs à la fois.

NOTIFICATIONS, dans .env : une ou plusieurs destinations séparées par des espaces.
  ha:mobile_app_pixel_8                        l'application Home Assistant du téléphone (le plus simple)
  discord-bot                                  le bot Discord de Bêta (salon DISCORD_SALON), avec ses commandes
  https://discord.com/api/webhooks/123/abc     un salon Discord par webhook (sans bot)
  ntfy:https://ntfy.sh/beta-mon-sujet-secret   l'application ntfy, sans compte
  freemobile:12345678:CleApiFree               SMS sur TON numéro Free Mobile, gratuit (Espace abonné › Mes options
                                               › « Notifications par SMS » : identifiant et clé)
  sms:http://192.168.68.50:8080:login:motdepasse:+33612345678
                                               SMS par TON téléphone Android, gratuit (appli « SMS Gateway for
                                               Android », mode serveur local) : n'importe quel opérateur
  https://monsite.fr/webhook                   tout autre webhook : reçoit {"titre", "message", "lien"} en JSON

Ajoute « @urgent » à une destination pour n'y recevoir que les alertes importantes (fuite, fumée, porte ouverte
maison vide, panne…), par exemple : « freemobile:12345678:Cle@urgent ». Pratique pour les SMS.

Les envois partent dans un fil à part : une destination injoignable ne ralentit jamais rien.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import threading
import urllib.request
from urllib.parse import urlsplit

log = logging.getLogger("beta.notifications")
NIVEAUX_URGENTS = {"urgence", "attention"}


def destinations(texte: str | None = None) -> list[str]:
    texte = os.environ.get("NOTIFICATIONS", "") if texte is None else texte
    return [d for d in re.split(r"[\s,]+", texte.strip()) if d]


def _filtre(destination: str) -> tuple[str, bool]:
    """(destination sans « @urgent », seulement les urgences ?)"""
    if destination.endswith("@urgent"):
        return destination[:-len("@urgent")], True
    return destination, False


def type_de(destination: str) -> str:
    destination = _filtre(destination)[0]
    if destination.startswith("ha:"):
        return "home_assistant"
    if destination.startswith("ntfy:"):
        return "ntfy"
    if destination.startswith("freemobile:"):
        return "sms_free"
    if destination.startswith("sms:"):
        return "sms_android"
    if destination == "discord-bot":
        return "discord_bot"
    if re.match(r"https://(\w+\.)?discord(app)?\.com/api/webhooks/", destination):
        return "discord"
    return "webhook"


def requete(destination: str, titre: str, message: str, lien: str = "") -> urllib.request.Request:
    """La requête HTTP à envoyer pour une destination (séparée de l'envoi pour être testée)."""
    destination = _filtre(destination)[0]
    genre = type_de(destination)
    if genre == "home_assistant":
        service = destination.removeprefix("ha:").removeprefix("notify.")
        url = f"{os.environ.get('HA_URL', 'http://host.docker.internal:8123').rstrip('/')}/api/services/notify/{service}"
        corps = {"title": titre, "message": message}
        if lien:
            corps["data"] = {"url": lien, "clickAction": lien}  # iPhone et Android : ouvre la page
        return _json(url, corps, {"Authorization": f"Bearer {os.environ.get('HA_TOKEN', '')}"})
    if genre == "discord":
        texte = f"**{titre}**\n{message}" + (f"\n{lien}" if lien else "")
        return _json(destination, {"content": texte[:1900], "username": "Bêta"})
    if genre == "discord_bot":
        url = os.environ.get("DISCORD_BOT_URL", "http://discord:8803").rstrip("/") + "/notifier"
        return _json(url, {"titre": titre, "message": message, "lien": lien},
                     {"Authorization": f"Bearer {os.environ.get('BETA_TOKEN', '')}"})
    if genre == "ntfy":
        # Publication en JSON (accents compris) : https://ntfy.sh/sujet -> POST https://ntfy.sh {"topic": "sujet"}
        adresse = urlsplit(destination.removeprefix("ntfy:"))
        corps = {"topic": adresse.path.strip("/"), "title": titre, "message": message, "tags": ["house"]}
        if lien:
            corps["click"] = lien
        return _json(f"{adresse.scheme}://{adresse.netloc}", corps)
    if genre == "sms_free":
        # API « Notifications par SMS » de Free Mobile : gratuite, vers le numéro de l'abonné seulement
        _, utilisateur, cle = (destination.split(":", 2) + ["", ""])[:3]
        return _json("https://smsapi.free-mobile.fr/sendmsg", {"user": utilisateur, "pass": cle, "msg": _sms(titre, message)})
    if genre == "sms_android":
        # « SMS Gateway for Android » (open source), mode serveur local : POST /message, identifiants de l'appli
        reste = destination.removeprefix("sms:")
        adresse = re.match(r"https?://[^/:]+(?::\d+)?", reste)  # l'adresse du téléphone, avec son port
        champs = reste[adresse.end() + 1:].split(":") if adresse else []
        base = adresse.group(0) if adresse else ""
        champs = ([""] * (3 - len(champs)) + champs) if 0 < len(champs) <= 3 else ["", "", ""]  # identifiants facultatifs
        utilisateur, mot_de_passe, numeros = champs if len(champs) == 3 else ("", "", "")
        if not base or not re.fullmatch(r"\+?[\d ]+(;\+?[\d ]+)*", numeros):
            raise ValueError("format : sms:http://IP_DU_TELEPHONE:8080:identifiant:motdepasse:+33612345678")
        entetes = {}
        if utilisateur:
            jeton = base64.b64encode(f"{utilisateur}:{mot_de_passe}".encode()).decode()
            entetes["Authorization"] = f"Basic {jeton}"
        return _json(f"{base}/message", {"message": _sms(titre, message),
                                         "phoneNumbers": [n.replace(" ", "") for n in numeros.split(";")]}, entetes)
    return _json(destination, {"titre": titre, "message": message, "lien": lien})


def _sms(titre: str, message: str) -> str:
    return f"{titre}\n{message}"[:600]  # un SMS long est découpé par l'opérateur ; on reste court


def _json(url: str, corps: dict, entetes: dict | None = None) -> urllib.request.Request:
    return urllib.request.Request(
        url, data=json.dumps(corps, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Beta", **(entetes or {})},
    )


def pour_niveau(liste: list[str], niveau: str) -> list[str]:
    """Les destinations qui reçoivent une notification de ce niveau (« @urgent » : urgences seulement)."""
    return [d for d in liste if not _filtre(d)[1] or niveau in NIVEAUX_URGENTS]


def envoyer_maintenant(titre: str, message: str, lien: str = "", liste: list[str] | None = None,
                       niveau: str = "info") -> dict[str, str]:
    """Envoie à chaque destination concernée ; renvoie {destination: "ok" ou l'erreur}."""
    resultats = {}
    for d in pour_niveau(destinations() if liste is None else liste, niveau):
        try:
            with urllib.request.urlopen(requete(d, titre, message, lien), timeout=15):
                pass
            resultats[d] = "ok"
        except Exception as e:  # une destination en panne ne doit rien casser
            log.warning("Notification impossible vers %s : %s", type_de(d), e)
            resultats[d] = str(e)
    return resultats


def envoyer(titre: str, message: str, niveau: str = "info", lien: str | None = None) -> None:
    if not destinations():
        return
    lien = os.environ.get("BETA_LIEN", "") if lien is None else lien  # page ouverte en touchant l'alerte
    threading.Thread(target=envoyer_maintenant, args=(titre, message, lien, None, niveau), daemon=True).start()


def resume() -> list[str]:
    """Les destinations configurées, sans les adresses ni les clés (pour la page)."""
    noms = {"home_assistant": "Home Assistant", "discord": "Discord (webhook)", "discord_bot": "bot Discord", "ntfy": "ntfy",
            "sms_free": "SMS Free Mobile", "sms_android": "SMS (téléphone Android)", "webhook": "webhook"}
    return [noms[type_de(d)] + (" (urgences)" if _filtre(d)[1] else "") for d in destinations()]


def masquer(destination: str) -> str:
    """Une destination lisible sans secret (pour les journaux et l'écran)."""
    return type_de(destination) + (" @urgent" if _filtre(destination)[1] else "")
