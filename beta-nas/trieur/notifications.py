"""Notifications du tri : sur le téléphone (Home Assistant), Discord, ntfy ou n'importe quel webhook.

NOTIFICATIONS, dans .env : une ou plusieurs destinations séparées par des espaces ou des virgules.
  ha:mobile_app_pixel_8                        l'application Home Assistant du téléphone (le plus simple)
  https://discord.com/api/webhooks/123/abc     un salon Discord (Paramètres du salon → Intégrations → Webhooks)
  ntfy:https://ntfy.sh/beta-mon-sujet-secret   l'application ntfy, sans compte
  https://monsite.fr/webhook                   tout autre webhook : reçoit {"titre", "message", "lien"} en JSON

Les envois partent dans un fil à part : une destination injoignable ne ralentit jamais le tri.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import urllib.request
from urllib.parse import urlsplit

log = logging.getLogger("trieur.notifications")


def destinations(texte: str | None = None) -> list[str]:
    texte = os.environ.get("NOTIFICATIONS", "") if texte is None else texte
    return [d for d in re.split(r"[\s,]+", texte.strip()) if d]


def type_de(destination: str) -> str:
    if destination.startswith("ha:"):
        return "home_assistant"
    if destination.startswith("ntfy:"):
        return "ntfy"
    if re.match(r"https://(\w+\.)?discord(app)?\.com/api/webhooks/", destination):
        return "discord"
    return "webhook"


def requete(destination: str, titre: str, message: str, lien: str = "") -> urllib.request.Request:
    """La requête HTTP à envoyer pour une destination (séparée de l'envoi pour être testée)."""
    genre = type_de(destination)
    if genre == "home_assistant":
        service = destination.removeprefix("ha:").removeprefix("notify.")
        url = f"{os.environ.get('HA_URL', 'http://host.docker.internal:8123').rstrip('/')}/api/services/notify/{service}"
        corps = {"title": titre, "message": message}
        if lien:
            corps["data"] = {"url": lien, "clickAction": lien}  # iPhone et Android : ouvre la page
        entetes = {"Authorization": f"Bearer {os.environ.get('HA_TOKEN', '')}"}
        return _json(url, corps, entetes)
    if genre == "discord":
        texte = f"**{titre}**\n{message}" + (f"\n{lien}" if lien else "")
        return _json(destination, {"content": texte[:1900], "username": "Bêta"})
    if genre == "ntfy":
        # Publication en JSON (accents compris) : https://ntfy.sh/sujet -> POST https://ntfy.sh {"topic": "sujet"}
        adresse = urlsplit(destination.removeprefix("ntfy:"))
        corps = {"topic": adresse.path.strip("/"), "title": titre, "message": message, "tags": ["page_facing_up"]}
        if lien:
            corps["click"] = lien
        return _json(f"{adresse.scheme}://{adresse.netloc}", corps)
    return _json(destination, {"titre": titre, "message": message, "lien": lien})


def _json(url: str, corps: dict, entetes: dict | None = None) -> urllib.request.Request:
    return urllib.request.Request(
        url, data=json.dumps(corps, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "Beta-trieur", **(entetes or {})},
    )


def envoyer_maintenant(titre: str, message: str, lien: str = "", liste: list[str] | None = None) -> dict[str, str]:
    """Envoie à chaque destination ; renvoie {destination: "ok" ou l'erreur}."""
    resultats = {}
    for d in destinations() if liste is None else liste:
        try:
            with urllib.request.urlopen(requete(d, titre, message, lien), timeout=10):
                pass
            resultats[d] = "ok"
        except Exception as e:  # une destination en panne ne doit rien casser
            log.warning("Notification impossible vers %s : %s", type_de(d), e)
            resultats[d] = str(e)
    return resultats


def envoyer(titre: str, message: str) -> None:
    if not destinations():
        return
    lien = os.environ.get("TRI_LIEN", "")
    threading.Thread(target=envoyer_maintenant, args=(titre, message, lien), daemon=True).start()


def resume() -> list[str]:
    """Les destinations configurées, sans les adresses secrètes (pour la page)."""
    noms = {"home_assistant": "Home Assistant", "discord": "Discord", "ntfy": "ntfy", "webhook": "webhook"}
    return [noms[type_de(d)] for d in destinations()]
