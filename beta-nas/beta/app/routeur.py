"""Le cerveau de Bêta : décide qui traite la demande, du plus rapide au plus lent.

1. Confirmation en attente (« oui » / « non » après une proposition d'automatisation)
2. Mails
3. Intentions locales de Home Assistant (sans LLM, < 1 s)
4. Petit LLM local pour trier ce que HA n'a pas compris
5. IA web pour les automatisations, avec confirmation avant création
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx

from . import llm_local, settings as cfg
from .homeassistant import HomeAssistant, ReponseHA
from .ia_web import ErreurAutomatisation, IAWeb
from .mails import DEMANDE_MAILS, resume_mails

log = logging.getLogger("beta.routeur")

_PAS_RECONNU = "Je ne vois pas qui tu es. Mets-toi face à la tablette et redemande-moi."
DUREE_CONFIRMATION = 120  # secondes pour dire « oui »
_OUI = re.compile(r"^\W*(oui|ouais|vas-?y|confirme|je confirme|d'accord|ok|c'est bon|valide)\b", re.IGNORECASE)
_NON = re.compile(r"^\W*(non|annule|laisse tomber|stop|pas maintenant)\b", re.IGNORECASE)


@dataclass
class Resultat:
    texte: str
    route: str


@dataclass
class _Attente:
    config: dict[str, Any]
    expire: float


@dataclass
class Routeur:
    settings: cfg.Settings
    ha: HomeAssistant
    llm: llm_local.LLMLocal
    ia_web: IAWeb | None = None
    _attentes: dict[str, _Attente] = field(default_factory=dict)

    async def traiter(self, texte: str, personne: str | None, confiance: float) -> Resultat:
        texte = texte.strip()
        if not texte:
            return Resultat("Je n'ai rien entendu.", "vide")

        identifie = self.settings.identifie(personne, confiance)
        capacites = self.settings.capacites(personne, confiance)
        cle = personne if identifie else "inconnu"

        attente = self._attentes.pop(cle, None)
        if attente and attente.expire > time.monotonic():
            if _OUI.search(texte):
                return await self._appliquer(attente.config)
            if _NON.search(texte):
                return Resultat("D'accord, j'annule.", "confirmation")
            # Autre chose : on oublie la proposition et on traite la nouvelle demande

        if not capacites:
            return Resultat(_PAS_RECONNU, "refus")

        if DEMANDE_MAILS.search(texte):
            if cfg.MAILS not in capacites:
                return self._refus(identifie, "Désolé, je ne peux pas lire les mails pour toi.")
            return await self._mails(personne)

        # « Tous les jours à 6h, ouvre les volets » ne doit pas ouvrir les volets tout de suite
        semble_automatisation = llm_local.tri_par_mots_cles(texte).categorie == llm_local.AUTOMATISATION
        if cfg.DOMOTIQUE in capacites and not semble_automatisation:
            reponse = await self._ha(texte)
            if reponse and reponse.comprise:
                return Resultat(reponse.texte or "C'est fait.", "home_assistant")

        tri = await self.llm.trier(texte)
        log.info("Tri local : %s", tri)

        if tri.categorie == llm_local.DOMOTIQUE and tri.commande and cfg.DOMOTIQUE in capacites:
            reponse = await self._ha(tri.commande)
            if reponse and reponse.comprise:
                return Resultat(reponse.texte or "C'est fait.", "llm_local+home_assistant")
            return Resultat("Je n'ai pas trouvé l'appareil dont tu parles.", "llm_local")

        if tri.categorie == llm_local.AUTOMATISATION:
            if cfg.AUTOMATISATIONS not in capacites:
                return self._refus(identifie, "Désolé, tu n'as pas le droit de créer des automatisations.")
            return await self._proposer_automatisation(texte, cle)

        if tri.categorie == llm_local.QUESTION and tri.reponse:
            if cfg.QUESTIONS not in capacites:
                return self._refus(identifie, "Désolé, je ne peux pas répondre à ça pour toi.")
            return Resultat(tri.reponse, "llm_local")

        return Resultat("Je n'ai pas compris, tu peux reformuler ?", "incompris")

    async def _ha(self, texte: str) -> ReponseHA | None:
        try:
            return await self.ha.commande(texte)
        except httpx.HTTPError:
            log.exception("Home Assistant injoignable")
            return None

    @staticmethod
    def _refus(identifie: bool, message: str) -> Resultat:
        # Sans visage, on explique comment débloquer plutôt que de dire « non »
        return Resultat(message if identifie else _PAS_RECONNU, "refus")

    async def _mails(self, personne: str | None) -> Resultat:
        compte = self.settings.personnes[personne].mail if personne in self.settings.personnes else None
        if not compte:
            return Resultat("Aucune boîte mail n'est configurée pour toi.", "mails")
        try:
            return Resultat(await resume_mails(compte), "mails")
        except Exception:
            log.exception("Lecture des mails impossible")
            return Resultat("Je n'arrive pas à accéder à ta boîte mail.", "mails")

    async def _proposer_automatisation(self, texte: str, cle: str) -> Resultat:
        if not self.ia_web:
            return Resultat(
                "Créer une automatisation demande l'IA web, qui n'est pas configurée.", "automatisation"
            )
        try:
            appareils = await self.ha.appareils(self.settings.domaines_exposes)
            proposition = await self.ia_web.proposer_automatisation(
                texte, appareils, self.settings.domaines_exposes, self.settings.envoyer_noms_appareils
            )
        except ErreurAutomatisation as e:
            log.warning("Automatisation refusée : %s", e)
            return Resultat("La proposition de l'IA n'était pas valide, je n'ai rien créé.", "ia_web")
        except Exception:
            log.exception("Erreur IA web")
            return Resultat("Je n'arrive pas à joindre l'IA web.", "ia_web")

        if not proposition.possible:
            return Resultat(proposition.resume, "ia_web")
        self._attentes[cle] = _Attente(proposition.config, time.monotonic() + DUREE_CONFIRMATION)
        return Resultat(f"{proposition.resume} Tu confirmes ?", "ia_web")

    async def _appliquer(self, config: dict[str, Any]) -> Resultat:
        identifiant = f"beta_{uuid.uuid4().hex[:12]}"
        try:
            await self.ha.creer_automatisation(identifiant, {"id": identifiant, **config})
        except httpx.HTTPError:
            log.exception("Création de l'automatisation impossible")
            return Resultat("Home Assistant a refusé l'automatisation.", "confirmation")
        return Resultat("C'est enregistré.", "confirmation")
