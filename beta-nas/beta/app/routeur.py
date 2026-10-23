"""Le cerveau de Bêta : décide qui traite la demande, du plus rapide au plus lent.

1. Confirmation en attente (« oui » / « non » après une proposition d'automatisation)
2. Mails
3. Intentions locales de Home Assistant (sans LLM, < 1 s)
4. Petit LLM local pour trier ce que HA n'a pas compris
5. IA web pour les automatisations, avec confirmation avant création

Savoir qui parle n'est utile que pour les demandes personnelles. Dans ce cas, et seulement
dans ce cas, Bêta cherche dans l'ordre :
  a. la seule personne connue vue récemment à cet étage (service de présence) ;
  b. le visage, avec la caméra de la tablette (étape « identification_requise ») ;
  c. « C'est pour qui ? » (étape « qui_requis »).
Les automatisations exigent le visage (b).
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
from .localisation import Localisation
from .mails import DEMANDE_MAILS, resume_mails

log = logging.getLogger("beta.routeur")

IDENTIFICATION_REQUISE = "identification_requise"
QUI_REQUIS = "qui_requis"

# Étapes d'une même demande
INITIALE = "initiale"  # la tablette n'a pas encore regardé
APRES_CAMERA = "apres_camera"  # la tablette a regardé
FINALE = "finale"  # plus rien à essayer

_PAS_RECONNU = "Je ne vois pas qui tu es. Mets-toi face à la tablette et redemande-moi."
_VISAGE_OBLIGATOIRE = "Pour ça, j'ai besoin de voir ton visage. Mets-toi face à la tablette et redemande-moi."
_REGARDE_MOI = "Regarde la tablette une seconde."
_POUR_QUI = "C'est pour qui ?"
_MAISON = "maison"
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
    localisation: Localisation | None = None
    _attentes: dict[str, _Attente] = field(default_factory=dict)

    async def traiter(
        self,
        texte: str,
        personne: str | None = None,
        confiance: float = 0.0,
        *,
        niveau: str | None = None,
        piece: str | None = None,
        etape: str = FINALE,
    ) -> Resultat:
        """`personne` + `confiance` : visage vu par la tablette. `niveau` force la façon dont la
        personne a été reconnue (présence, déclaration). `etape` : ce qu'il reste à essayer."""
        texte = texte.strip()
        if not texte:
            return Resultat("Je n'ai rien entendu.", "vide")

        if niveau is None and self.settings.identifie(personne, confiance):
            niveau = cfg.VISAGE
        if niveau is None:
            personne = None
        capacites = self.settings.capacites(personne, niveau)

        async def manque(capacite: str, refus: str) -> Resultat:
            return await self._identifier(texte, capacite, refus, personne, niveau, piece, etape)

        # Une seule confirmation en attente pour la maison : le « oui » arrive sans visage
        attente = self._attentes.pop(_MAISON, None)
        if attente and attente.expire > time.monotonic():
            if _OUI.search(texte):
                return await self._appliquer(attente.config)
            if _NON.search(texte):
                return Resultat("D'accord, j'annule.", "confirmation")
            # Autre chose : on oublie la proposition et on traite la nouvelle demande

        if DEMANDE_MAILS.search(texte):
            if cfg.MAILS not in capacites:
                return await manque(cfg.MAILS, "Désolé, je ne peux pas lire les mails pour toi.")
            return await self._mails(personne)

        # « Tous les jours à 6h, ouvre les volets » ne doit pas ouvrir les volets tout de suite
        semble_automatisation = llm_local.tri_par_mots_cles(texte).categorie == llm_local.AUTOMATISATION
        if cfg.DOMOTIQUE in capacites and not semble_automatisation:
            reponse = await self._ha(texte)
            if reponse and reponse.comprise:
                return Resultat(reponse.texte or "C'est fait.", "home_assistant")

        tri = await self.llm.trier(texte)
        log.info("Tri local : %s", tri)

        if tri.categorie == llm_local.DOMOTIQUE and tri.commande:
            if cfg.DOMOTIQUE not in capacites:
                return await manque(cfg.DOMOTIQUE, "Désolé, je ne peux pas piloter la maison pour toi.")
            reponse = await self._ha(tri.commande)
            if reponse and reponse.comprise:
                return Resultat(reponse.texte or "C'est fait.", "llm_local+home_assistant")
            return Resultat("Je n'ai pas trouvé l'appareil dont tu parles.", "llm_local")

        if tri.categorie == llm_local.AUTOMATISATION:
            if cfg.AUTOMATISATIONS not in capacites:
                return await manque(cfg.AUTOMATISATIONS, "Désolé, tu n'as pas le droit de créer des automatisations.")
            return await self._proposer_automatisation(texte)

        if tri.categorie == llm_local.QUESTION and tri.reponse:
            if cfg.QUESTIONS not in capacites:
                return await manque(cfg.QUESTIONS, "Désolé, je ne peux pas répondre à ça pour toi.")
            return Resultat(tri.reponse, "llm_local")

        return Resultat("Je n'ai pas compris, tu peux reformuler ?", "incompris")

    async def _identifier(
        self,
        texte: str,
        capacite: str,
        refus: str,
        personne: str | None,
        niveau: str | None,
        piece: str | None,
        etape: str,
    ) -> Resultat:
        """La demande a besoin de savoir qui parle (ou d'en être plus sûr) : on cherche, du plus discret au plus direct."""
        visage_obligatoire = capacite in cfg.CAPACITES_VISAGE_OBLIGATOIRE

        if personne:
            # Reconnu, mais son rôle ne le permet pas, ou il faut voir son visage
            if capacite not in self.settings.capacites(personne, cfg.VISAGE):
                return Resultat(refus, "refus")
            if etape == INITIALE:
                return Resultat(_REGARDE_MOI, IDENTIFICATION_REQUISE)
            return Resultat(_VISAGE_OBLIGATOIRE, "refus")

        if not visage_obligatoire and self.localisation:
            candidat = await self.localisation.candidat(piece)
            if candidat:
                log.info("Seule personne à cet étage : %s", candidat)
                return await self.traiter(texte, candidat, niveau=cfg.PRESENCE, piece=piece, etape=etape)

        if etape == INITIALE:
            return Resultat(_REGARDE_MOI, IDENTIFICATION_REQUISE)
        if etape == APRES_CAMERA and not visage_obligatoire:
            return Resultat(_POUR_QUI, QUI_REQUIS)
        return Resultat(_VISAGE_OBLIGATOIRE if visage_obligatoire else _PAS_RECONNU, "refus")

    async def _ha(self, texte: str) -> ReponseHA | None:
        try:
            return await self.ha.commande(texte)
        except httpx.HTTPError:
            log.exception("Home Assistant injoignable")
            return None

    async def _mails(self, personne: str | None) -> Resultat:
        compte = self.settings.personnes[personne].mail if personne in self.settings.personnes else None
        if not compte:
            return Resultat("Aucune boîte mail n'est configurée pour toi.", "mails")
        try:
            return Resultat(await resume_mails(compte), "mails")
        except Exception:
            log.exception("Lecture des mails impossible")
            return Resultat("Je n'arrive pas à accéder à ta boîte mail.", "mails")

    async def _proposer_automatisation(self, texte: str) -> Resultat:
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
        self._attentes[_MAISON] = _Attente(proposition.config, time.monotonic() + DUREE_CONFIRMATION)
        return Resultat(f"{proposition.resume} Tu confirmes ?", "ia_web")

    async def _appliquer(self, config: dict[str, Any]) -> Resultat:
        identifiant = f"beta_{uuid.uuid4().hex[:12]}"
        try:
            await self.ha.creer_automatisation(identifiant, {"id": identifiant, **config})
        except httpx.HTTPError:
            log.exception("Création de l'automatisation impossible")
            return Resultat("Home Assistant a refusé l'automatisation.", "confirmation")
        return Resultat("C'est enregistré.", "confirmation")
