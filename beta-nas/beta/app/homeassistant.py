"""Client Home Assistant : commandes vocales, liste des appareils, création d'automatisations."""

from __future__ import annotations

import json
from dataclasses import dataclass

import httpx


@dataclass
class ReponseHA:
    comprise: bool
    texte: str


@dataclass
class Appareil:
    entity_id: str
    domaine: str
    nom: str
    piece: str


# Rendu côté Home Assistant : on récupère uniquement id, nom et pièce des domaines voulus
_TEMPLATE_APPAREILS = """
[{%- for s in states if s.domain in DOMAINES -%}
{"id": {{ s.entity_id | tojson }}, "nom": {{ s.name | tojson }}, "piece": {{ (area_name(s.entity_id) or '') | tojson }}}
{%- if not loop.last %},{% endif -%}
{%- endfor -%}]
"""


class HomeAssistant:
    def __init__(self, url: str, token: str, agent_id: str, langue: str = "fr", timeout: float = 15.0):
        self.url = url
        self.agent_id = agent_id
        self.langue = langue
        self._client = httpx.AsyncClient(
            base_url=url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )

    async def fermer(self) -> None:
        await self._client.aclose()

    async def commande(self, texte: str) -> ReponseHA:
        """Passe la phrase aux intentions intégrées de Home Assistant (sans LLM)."""
        r = await self._client.post(
            "/api/conversation/process",
            json={"text": texte, "language": self.langue, "agent_id": self.agent_id},
        )
        r.raise_for_status()
        reponse = r.json().get("response", {})
        parole = reponse.get("speech", {}).get("plain", {}).get("speech", "")
        if reponse.get("response_type") == "error":
            return ReponseHA(comprise=False, texte=parole)
        return ReponseHA(comprise=True, texte=parole)

    async def appareils(self, domaines: list[str]) -> list[Appareil]:
        template = _TEMPLATE_APPAREILS.replace("DOMAINES", json.dumps(domaines))
        r = await self._client.post("/api/template", json={"template": template})
        r.raise_for_status()
        return [
            Appareil(entity_id=a["id"], domaine=a["id"].split(".", 1)[0], nom=a["nom"], piece=a["piece"])
            for a in json.loads(r.text)
        ]

    async def creer_automatisation(self, identifiant: str, config: dict) -> None:
        """Même appel que l'éditeur d'automatisations de l'interface ; HA recharge tout seul."""
        r = await self._client.post(f"/api/config/automation/config/{identifiant}", json=config)
        r.raise_for_status()

    async def en_ligne(self) -> bool:
        try:
            r = await self._client.get("/api/")
            return r.status_code == 200
        except httpx.HTTPError:
            return False
