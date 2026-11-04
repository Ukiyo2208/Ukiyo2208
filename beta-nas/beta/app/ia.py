"""Les IA de Bêta et ce que fait chacune.

Chaque type d'action (tâche) est confié à une IA, ou à une liste d'IA essayées dans l'ordre :
la première disponible répond. Tout se règle dans la section `ia` de config.yaml.

    rapide    petit modèle Ollama du NAS : comprendre les demandes (local, quelques secondes)
    puissant  gros modèle Ollama, par exemple sur un PC avec carte graphique
    cloud     Claude (clé ANTHROPIC_API_KEY)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import anthropic
import httpx

log = logging.getLogger("beta.ia")

# Les tâches de Bêta
COMPRENDRE = "comprendre"  # trier la demande : domotique, automatisation, discussion…
CONVERSATION = "conversation"  # discuter, répondre aux questions
AUTOMATISATIONS = "automatisations"  # écrire une automatisation Home Assistant

TACHES_PAR_DEFAUT = {
    COMPRENDRE: ["rapide"],
    CONVERSATION: ["cloud", "puissant", "rapide"],
    AUTOMATISATIONS: ["cloud", "puissant"],
}


class IndisponibleError(RuntimeError):
    """Aucune IA de la liste n'a pu répondre."""


@dataclass
class Modele:
    nom: str  # rapide, puissant, cloud…
    type: str  # ollama ou anthropic
    modele: str
    url: str = ""
    cle: str = ""
    contexte: int = 8192
    timeout: float = 120.0

    @property
    def configure(self) -> bool:
        return bool(self.modele) and (self.type != "anthropic" or bool(self.cle)) and (self.type != "ollama" or bool(self.url))

    @property
    def local(self) -> bool:
        return self.type == "ollama"


class _Ollama:
    def __init__(self, m: Modele):
        self.m = m
        self._client = httpx.AsyncClient(base_url=m.url.rstrip("/"), timeout=m.timeout)

    async def appeler(self, systeme: str, messages: list[dict], schema: dict | None, max_tokens: int) -> str:
        corps: dict[str, Any] = {
            "model": self.m.modele,
            "stream": False,
            "keep_alive": "24h",
            "options": {"num_ctx": self.m.contexte, "num_predict": max_tokens, "temperature": 0 if schema else 0.6},
            "messages": [{"role": "system", "content": systeme}, *messages],
        }
        if schema:
            corps["format"] = schema
        r = await self._client.post("/api/chat", json=corps)
        if r.status_code >= 400:
            # Le message d'Ollama dit pourquoi (ex : « model "x" not found, try pulling it first »)
            raise IndisponibleError(f"Ollama {r.status_code} pour le modèle « {self.m.modele} » : {r.text[:200]}")
        return r.json()["message"]["content"].strip()

    async def fermer(self) -> None:
        await self._client.aclose()


class _Anthropic:
    def __init__(self, m: Modele):
        self.m = m
        self._client = anthropic.AsyncAnthropic(api_key=m.cle, timeout=m.timeout)

    async def appeler(self, systeme: str, messages: list[dict], schema: dict | None, max_tokens: int) -> str:
        sortie: dict[str, Any] = {"effort": "medium" if schema else "low"}  # discussion : réponse rapide
        if schema:
            sortie["format"] = {"type": "json_schema", "schema": schema}
        reponse = await self._client.beta.messages.create(
            model=self.m.modele,
            max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config=sortie,
            system=systeme,
            messages=messages,
        )
        if reponse.stop_reason == "refusal":
            raise IndisponibleError(f"{self.m.nom} a refusé la demande")
        if reponse.stop_reason == "max_tokens" and schema:
            raise IndisponibleError(f"Réponse de {self.m.nom} tronquée")
        return "".join(b.text for b in reponse.content if b.type == "text").strip()

    async def fermer(self) -> None:
        await self._client.close()


@dataclass
class Resultat:
    texte: str
    modele: str  # nom de l'IA qui a répondu (rapide, puissant, cloud…)


@dataclass
class IA:
    modeles: dict[str, Modele]
    taches: dict[str, list[str]] = field(default_factory=lambda: {k: list(v) for k, v in TACHES_PAR_DEFAUT.items()})
    _clients: dict[str, Any] = field(default_factory=dict)

    def candidats(self, tache: str) -> list[Modele]:
        noms = self.taches.get(tache) or TACHES_PAR_DEFAUT.get(tache, [])
        return [self.modeles[n] for n in noms if n in self.modeles and self.modeles[n].configure]

    def disponible(self, tache: str) -> bool:
        return bool(self.candidats(tache))

    def _client(self, m: Modele):
        if m.nom not in self._clients:
            self._clients[m.nom] = _Anthropic(m) if m.type == "anthropic" else _Ollama(m)
        return self._clients[m.nom]

    async def demander(
        self,
        tache: str,
        systeme: str,
        messages: list[dict],
        *,
        schema: dict | None = None,
        max_tokens: int = 1024,
    ) -> Resultat:
        """Confie la tâche à la première IA disponible de sa liste."""
        erreurs = []
        for m in self.candidats(tache):
            try:
                texte = await self._client(m).appeler(systeme, messages, schema, max_tokens)
                if schema:
                    json.loads(texte)  # une réponse JSON invalide compte comme un échec
                return Resultat(texte, m.nom)
            except (httpx.HTTPError, anthropic.APIError, IndisponibleError, ValueError, KeyError) as e:
                log.warning("%s indisponible pour « %s » : %s", m.nom, tache, e)
                erreurs.append(f"{m.nom} : {e}")
        raise IndisponibleError("; ".join(erreurs) or f"aucune IA configurée pour « {tache} »")

    async def demander_json(self, tache: str, systeme: str, message: str, schema: dict, max_tokens: int = 4096) -> tuple[dict, str]:
        r = await self.demander(tache, systeme, [{"role": "user", "content": message}], schema=schema, max_tokens=max_tokens)
        return json.loads(r.texte), r.modele

    def resume(self) -> dict[str, list[str]]:
        """Pour la fiche et le tableau de bord : quelle IA fait quoi, dans l'ordre."""
        return {t: [f"{m.nom} ({m.modele})" for m in self.candidats(t)] for t in sorted({*TACHES_PAR_DEFAUT, *self.taches})}

    async def fermer(self) -> None:
        for c in self._clients.values():
            await c.fermer()
