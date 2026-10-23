"""Qui parle, sans caméra : d'après les positions tenues à jour par le service beta-presence."""

from __future__ import annotations

import logging
import re
import unicodedata

import httpx

from .homeassistant import HomeAssistant
from .settings import Settings

log = logging.getLogger("beta.localisation")


def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte.lower()) if unicodedata.category(c) != "Mn")


def prenom_dans(texte: str, settings: Settings) -> str | None:
    """Trouve le prénom (ou un surnom) cité dans une réponse à « C'est pour qui ? »."""
    mots = set(re.findall(r"[a-z0-9-]+", _sans_accents(texte)))
    trouves = {
        nom for nom, p in settings.personnes.items() if any(_sans_accents(n) in mots for n in [nom, *p.surnoms])
    }
    return trouves.pop() if len(trouves) == 1 else None


class Localisation:
    def __init__(self, settings: Settings, ha: HomeAssistant):
        self.settings = settings
        self.ha = ha
        self._client = httpx.AsyncClient(
            base_url=settings.presence_url,
            headers={"Authorization": f"Bearer {settings.beta_token}"},
            timeout=3,
        )

    async def fermer(self) -> None:
        await self._client.aclose()

    async def positions(self) -> dict | None:
        try:
            r = await self._client.get("/positions")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            log.info("Service de présence indisponible : %s", e)
            return None

    async def _a_la_maison(self, nom: str) -> bool | None:
        """D'après l'app Companion : True, False, ou None si on ne sait pas."""
        entite = self.settings.personnes[nom].companion
        if not entite:
            return None
        etat = await self.ha.etat(entite)
        return None if etat is None else etat == "home"

    async def candidat(self, piece: str | None) -> str | None:
        """Le prénom de la personne qui parle si c'est forcément elle, sinon None.

        C'est elle si elle est la seule personne connue vue récemment dans la zone (l'étage) de la
        tablette, qu'aucun inconnu n'y a été vu, et qu'aucune autre personne à la maison n'est
        peut-être là (à la maison selon Companion, mais vue nulle part récemment)."""
        zone = self.settings.zone_de(piece)
        etat = await self.positions() if zone else None
        if not etat:
            return None
        validite = self.settings.validite_minutes * 60
        recentes = {
            nom: vue for nom, vue in etat.get("personnes", {}).items()
            if nom in self.settings.personnes and vue["vu_il_y_a_s"] < validite
        }

        if etat.get("inconnus", {}).get(zone, {}).get("vu_il_y_a_s", float("inf")) < validite:
            return None
        ici = [nom for nom, vue in recentes.items() if vue["zone"] == zone and await self._a_la_maison(nom) is not False]
        if len(ici) != 1:
            return None
        for nom in self.settings.personnes:
            if nom != ici[0] and nom not in recentes and await self._a_la_maison(nom):
                return None
        return ici[0]
