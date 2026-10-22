"""Petit LLM local (Ollama) : il ne sert qu'à trier les demandes que Home Assistant n'a pas comprises.

Le prompt est volontairement court : sur un Intel N100, chaque token de consigne coûte du temps.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

import httpx

log = logging.getLogger("beta.llm_local")

DOMOTIQUE = "domotique"
AUTOMATISATION = "automatisation"
QUESTION = "question"
AUTRE = "autre"

_CONSIGNE = (
    "Tu es Bêta, assistant vocal d'une maison. Classe la demande dans une catégorie :\n"
    "- domotique : action immédiate sur un appareil (lumière, volet, chauffage, musique...). "
    "Mets dans 'commande' une phrase courte et simple, ex : 'allume la lumière du salon'.\n"
    "- automatisation : quelque chose à faire plus tard, de façon répétée ou sous condition "
    "(tous les jours à 6h, quand je pars, si la température...).\n"
    "- question : question de culture générale ou conversation. Mets une réponse de 1 à 2 phrases dans 'reponse'.\n"
    "- autre : incompréhensible.\n"
    "Réponds uniquement en JSON."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "categorie": {"type": "string", "enum": [DOMOTIQUE, AUTOMATISATION, QUESTION, AUTRE]},
        "commande": {"type": "string"},
        "reponse": {"type": "string"},
    },
    "required": ["categorie", "commande", "reponse"],
}

# Si Ollama est indisponible, on se rabat sur ces mots-clés
_MOTS_AUTOMATISATION = re.compile(
    r"\b(tous les|chaque|automatis|programme|quand je|lorsque|dès que|si la|si le|à \d{1,2} ?h)",
    re.IGNORECASE,
)


@dataclass
class Tri:
    categorie: str
    commande: str = ""
    reponse: str = ""


def tri_par_mots_cles(texte: str) -> Tri:
    if _MOTS_AUTOMATISATION.search(texte):
        return Tri(AUTOMATISATION)
    return Tri(AUTRE)


class LLMLocal:
    def __init__(self, url: str, modele: str, timeout: float = 30.0):
        self.modele = modele
        self._client = httpx.AsyncClient(base_url=url, timeout=timeout)

    async def fermer(self) -> None:
        await self._client.aclose()

    async def trier(self, texte: str) -> Tri:
        try:
            r = await self._client.post(
                "/api/chat",
                json={
                    "model": self.modele,
                    "stream": False,
                    "format": _SCHEMA,
                    # Garde le modèle en mémoire pour éviter de le recharger à chaque phrase
                    "keep_alive": "24h",
                    "options": {"temperature": 0, "num_ctx": 2048},
                    "messages": [
                        {"role": "system", "content": _CONSIGNE},
                        {"role": "user", "content": texte},
                    ],
                },
            )
            r.raise_for_status()
            donnees = json.loads(r.json()["message"]["content"])
            categorie = donnees.get("categorie", AUTRE)
            if categorie not in (DOMOTIQUE, AUTOMATISATION, QUESTION, AUTRE):
                categorie = AUTRE
            return Tri(categorie, donnees.get("commande", "").strip(), donnees.get("reponse", "").strip())
        except (httpx.HTTPError, KeyError, ValueError) as e:
            log.warning("LLM local indisponible (%s), tri par mots-clés", e)
            return tri_par_mots_cles(texte)

    async def prechauffer(self) -> None:
        """Télécharge le modèle s'il manque, puis le charge en mémoire."""
        try:
            tags = (await self._client.get("/api/tags")).json().get("models", [])
            if not any(m.get("name") == self.modele or m.get("model") == self.modele for m in tags):
                log.info("Téléchargement du modèle %s (une seule fois, quelques minutes)...", self.modele)
                async with httpx.AsyncClient(base_url=str(self._client.base_url), timeout=None) as long_client:
                    r = await long_client.post("/api/pull", json={"model": self.modele, "stream": False})
                    r.raise_for_status()
            await self._client.post("/api/generate", json={"model": self.modele, "keep_alive": "24h"})
            log.info("Modèle %s prêt", self.modele)
        except httpx.HTTPError as e:
            log.warning("Impossible de préparer le modèle %s : %s", self.modele, e)
