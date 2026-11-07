"""Le cerveau de Bêta : décide qui traite la demande, du plus rapide au plus lent.

1. Confirmation en attente (« oui » / « non » après une proposition d'automatisation)
2. Mails
3. Intentions locales de Home Assistant (sans LLM, < 1 s)
4. Petit modèle local (tâche « comprendre ») pour trier ce que HA n'a pas compris
5. Discussion et questions : IA de la tâche « conversation » (cloud ou modèle puissant)
6. Automatisations : IA de la tâche « automatisations », avec confirmation avant création

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

from . import ia as ia_taches, llm_local, settings as cfg
from .homeassistant import HomeAssistant, ReponseHA
from .ia import CONVERSATION, IA, IndisponibleError
from .ia_web import ErreurAutomatisation, proposer_automatisation
from .localisation import Localisation
from .mails import DEMANDE_MAILS, resume_mails
from .phrases import naturelle

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
# Modes de la page web
DISCUSSION = "discussion"
MAISON = "maison"
DUREE_CONFIRMATION = 120  # secondes pour dire « oui »
MEMOIRE_DISCUSSION = 10 * 60  # une discussion est oubliée après 10 minutes de silence
MESSAGES_MEMORISES = 12

_SYSTEME_DISCUSSION = (
    "Tu es Bêta, l'assistant vocal d'une maison. Tu réponds en français, de façon chaleureuse et "
    "directe, en 1 à 3 phrases courtes : ta réponse est lue à voix haute, donc pas de listes, de "
    "titres, d'emojis ni de mise en forme. Si on te demande d'agir sur un appareil de la maison, dis "
    "que tu ne peux pas le faire depuis la discussion et propose de redemander sous forme de "
    "commande (par exemple « allume la lumière du salon »). Si tu ne sais pas, dis-le."
)
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
    ia: IA | None = None
    localisation: Localisation | None = None
    _attentes: dict[str, _Attente] = field(default_factory=dict)
    _discussions: dict[str, tuple[list[dict], float]] = field(default_factory=dict)

    async def traiter(
        self,
        texte: str,
        personne: str | None = None,
        confiance: float = 0.0,
        *,
        niveau: str | None = None,
        piece: str | None = None,
        etape: str = FINALE,
        mode: str | None = None,
    ) -> Resultat:
        """`personne` + `confiance` : visage vu par la tablette. `niveau` force la façon dont la
        personne a été reconnue (présence, déclaration). `etape` : ce qu'il reste à essayer.
        `mode` (page web) : « discussion » parle directement à l'IA, « maison » ne fait que piloter."""
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

        if mode == DISCUSSION:
            if cfg.QUESTIONS not in capacites:
                return await manque(cfg.QUESTIONS, "Désolé, je ne peux pas répondre à ça pour toi.")
            return await self._discuter(texte, personne)

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
                return Resultat(naturelle(texte, reponse), "home_assistant")

        tri = await self.llm.trier(texte)
        log.info("Tri local : %s", tri)

        if tri.categorie == llm_local.DOMOTIQUE and tri.commande:
            if cfg.DOMOTIQUE not in capacites:
                return await manque(cfg.DOMOTIQUE, "Désolé, je ne peux pas piloter la maison pour toi.")
            reponse = await self._ha(tri.commande)
            if reponse and reponse.comprise:
                return Resultat(naturelle(tri.commande, reponse), "llm_local+home_assistant")
            return Resultat("Je n'ai pas trouvé l'appareil dont tu parles.", "llm_local")

        if tri.categorie == llm_local.AUTOMATISATION:
            if cfg.AUTOMATISATIONS not in capacites:
                return await manque(cfg.AUTOMATISATIONS, "Désolé, tu n'as pas le droit de créer des automatisations.")
            return await self._proposer_automatisation(texte)

        if mode == MAISON:
            return Resultat("Je n'ai pas compris la commande. Essaie par exemple « allume la lumière du salon ».", "incompris")

        # Tout le reste est une discussion : questions, conseils, et ce que le tri n'a pas su classer
        if cfg.QUESTIONS not in capacites:
            return await manque(cfg.QUESTIONS, "Désolé, je ne peux pas répondre à ça pour toi.")
        return await self._discuter(texte, personne)

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

    async def _discuter(self, texte: str, personne: str | None) -> Resultat:
        if not self.ia:
            return Resultat("Je n'ai pas compris, tu peux reformuler ?", "incompris")
        cle = personne or "maison"
        historique, derniere = self._discussions.get(cle, ([], 0.0))
        if time.monotonic() - derniere > MEMOIRE_DISCUSSION:
            historique = []
        messages = [*historique, {"role": "user", "content": texte}]
        try:
            reponse = await self.ia.demander(CONVERSATION, _SYSTEME_DISCUSSION, messages, max_tokens=400)
        except IndisponibleError:
            log.exception("Aucune IA de discussion disponible")
            return Resultat("Je ne peux pas discuter pour l'instant, mais je peux toujours piloter la maison.", "incompris")
        messages.append({"role": "assistant", "content": reponse.texte})
        self._discussions[cle] = (messages[-MESSAGES_MEMORISES:], time.monotonic())
        return Resultat(reponse.texte, f"conversation:{reponse.modele}")

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
        if not self.ia or not self.ia.disponible(ia_taches.AUTOMATISATIONS):
            return Resultat(
                "Pour créer une automatisation, il me faut l'IA cloud ou le modèle puissant, et aucun n'est configuré.",
                "automatisation",
            )
        try:
            appareils = await self.ha.appareils(self.settings.domaines_exposes)
            proposition = await proposer_automatisation(
                self.ia, texte, appareils, self.settings.domaines_exposes, self.settings.envoyer_noms_appareils
            )
        except ErreurAutomatisation as e:
            log.warning("Automatisation refusée : %s", e)
            return Resultat("Je n'ai pas réussi à préparer cette automatisation, je n'ai rien créé.", "automatisation")
        except Exception:
            log.exception("Erreur pendant la préparation de l'automatisation")
            return Resultat("Je n'arrive pas à joindre l'IA des automatisations.", "automatisation")

        route = f"automatisation:{proposition.modele}"
        if not proposition.possible:
            return Resultat(proposition.resume, route)
        self._attentes[_MAISON] = _Attente(proposition.config, time.monotonic() + DUREE_CONFIRMATION)
        return Resultat(f"{proposition.resume} Tu confirmes ?", route)

    async def _appliquer(self, config: dict[str, Any]) -> Resultat:
        identifiant = f"beta_{uuid.uuid4().hex[:12]}"
        try:
            await self.ha.creer_automatisation(identifiant, {"id": identifiant, **config})
        except httpx.HTTPError:
            log.exception("Création de l'automatisation impossible")
            return Resultat("Home Assistant a refusé l'automatisation.", "confirmation")
        return Resultat("C'est enregistré.", "confirmation")
