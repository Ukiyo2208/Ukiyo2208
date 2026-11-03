"""Comprendre la demande : le petit modèle local (tâche « comprendre ») trie seulement ce que
Home Assistant n'a pas compris. Il ne répond pas lui-même : la discussion a sa propre IA.

Le prompt est volontairement court : sur un Intel N100, chaque token de consigne coûte du temps.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx

from .ia import COMPRENDRE, IA, IndisponibleError

log = logging.getLogger("beta.llm_local")

DOMOTIQUE = "domotique"
AUTOMATISATION = "automatisation"
CONVERSATION = "conversation"
AUTRE = "autre"

_CONSIGNE = (
    "Tu es Bêta, assistant vocal d'une maison. Classe la demande dans une catégorie :\n"
    "- domotique : action immédiate sur un appareil (lumière, volet, chauffage, musique...). "
    "Mets dans 'commande' une phrase courte et simple, ex : 'allume la lumière du salon'.\n"
    "- automatisation : quelque chose à faire plus tard, de façon répétée ou sous condition "
    "(tous les jours à 6h, quand je pars, si la température...).\n"
    "- conversation : question, discussion, demande d'information ou de conseil.\n"
    "- autre : incompréhensible.\n"
    "Réponds uniquement en JSON."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "categorie": {"type": "string", "enum": [DOMOTIQUE, AUTOMATISATION, CONVERSATION, AUTRE]},
        "commande": {"type": "string"},
    },
    "required": ["categorie", "commande"],
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


def tri_par_mots_cles(texte: str) -> Tri:
    if _MOTS_AUTOMATISATION.search(texte):
        return Tri(AUTOMATISATION)
    return Tri(AUTRE)


class LLMLocal:
    def __init__(self, ia: IA, url: str, modele: str):
        self.ia = ia
        self.modele = modele  # modèle Ollama du NAS, téléchargé au démarrage
        self._client = httpx.AsyncClient(base_url=url, timeout=30)

    async def fermer(self) -> None:
        await self._client.aclose()

    async def trier(self, texte: str) -> Tri:
        try:
            donnees, _ = await self.ia.demander_json(COMPRENDRE, _CONSIGNE, texte, _SCHEMA, max_tokens=100)
        except IndisponibleError as e:
            log.warning("Tri par IA impossible (%s), tri par mots-clés", e)
            return tri_par_mots_cles(texte)
        categorie = donnees.get("categorie", AUTRE)
        if categorie not in (DOMOTIQUE, AUTOMATISATION, CONVERSATION, AUTRE):
            categorie = AUTRE
        return Tri(categorie, str(donnees.get("commande", "")).strip())

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
