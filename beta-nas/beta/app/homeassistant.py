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


# Domaines lus pour la page Bêta home (les serrures y sont affichées, jamais commandées)
DOMAINES_MAISON = ["light", "switch", "cover", "climate", "fan", "media_player", "scene", "input_boolean",
                   "sensor", "binary_sensor", "lock", "vacuum"]
_ATTRIBUTS = ["brightness", "supported_color_modes", "current_position", "device_class", "temperature",
              "current_temperature", "min_temp", "max_temp", "target_temp_step", "hvac_action",
              "unit_of_measurement", "media_title", "battery_level"]
_TEMPLATE_MAISON = (
    "{%- set ns = namespace(l=[], p=[]) -%}"
    "{%- for s in states if s.domain in " + json.dumps(DOMAINES_MAISON) + " -%}"
    "{%- set a = area_id(s.entity_id) -%}"
    "{%- set ns.l = ns.l + [{'id': s.entity_id, 'nom': s.name, 'etat': s.state, 'piece': area_name(s.entity_id) or '',"
    " 'piece_id': a or '', 'etage': ((floor_name(a) if a else '') or ''), 'attr': {"
    + ", ".join(f"'{k}': s.attributes.get('{k}')" for k in _ATTRIBUTS) +
    "}}] -%}"
    "{%- endfor -%}"
    "{%- for s in states.person -%}{%- set ns.p = ns.p + [{'id': s.entity_id, 'nom': s.name, 'etat': s.state}] -%}{%- endfor -%}"
    "{%- set w = states.weather | first -%}"
    "{{ {'appareils': ns.l, 'personnes': ns.p, 'meteo': ({'nom': w.name, 'etat': w.state,"
    " 'temperature': w.attributes.get('temperature'), 'unite': w.attributes.get('temperature_unit'),"
    " 'humidite': w.attributes.get('humidity'), 'vent': w.attributes.get('wind_speed')} if w else None)} | tojson }}"
)


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

    async def etats(self, domaines: list[str]) -> list[dict]:
        """Appareils pilotables avec leur état et leur pièce, pour la page web."""
        template = (
            "[{%- for s in states if s.domain in DOMAINES -%}"
            '{"id": {{ s.entity_id | tojson }}, "nom": {{ s.name | tojson }}, "etat": {{ s.state | tojson }}, '
            '"piece": {{ (area_name(s.entity_id) or "") | tojson }}}'
            "{%- if not loop.last %},{% endif -%}{%- endfor -%}]"
        ).replace("DOMAINES", json.dumps(domaines))
        r = await self._client.post("/api/template", json={"template": template})
        r.raise_for_status()
        return json.loads(r.text)

    async def maison(self) -> dict:
        """Tout ce que la page Bêta home affiche, en un seul appel : appareils (avec pièce, étage et
        attributs utiles), météo et personnes."""
        try:
            return await self._rendre(_TEMPLATE_MAISON)
        except httpx.HTTPStatusError:
            # Home Assistant d'avant les étages (2024.4) : même chose sans les étages
            return await self._rendre(_TEMPLATE_MAISON.replace("(floor_name(a) if a else '')", "''"))

    async def _rendre(self, template: str) -> dict:
        r = await self._client.post("/api/template", json={"template": template})
        r.raise_for_status()
        return json.loads(r.text)

    async def service(self, domaine: str, service: str, donnees: dict) -> None:
        r = await self._client.post(f"/api/services/{domaine}/{service}", json=donnees)
        r.raise_for_status()

    async def attributs(self, entite: str) -> dict:
        r = await self._client.get(f"/api/states/{entite}")
        r.raise_for_status()
        return r.json().get("attributes", {})

    async def basculer(self, entite: str) -> None:
        """Allume / éteint (ou ouvre / ferme) un appareil."""
        domaine = entite.split(".", 1)[0]
        service = {"cover": "cover/toggle", "scene": "scene/turn_on"}.get(domaine, "homeassistant/toggle")
        r = await self._client.post(f"/api/services/{service}", json={"entity_id": entite})
        r.raise_for_status()

    async def creer_automatisation(self, identifiant: str, config: dict) -> None:
        """Même appel que l'éditeur d'automatisations de l'interface ; HA recharge tout seul."""
        r = await self._client.post(f"/api/config/automation/config/{identifiant}", json=config)
        r.raise_for_status()

    async def etat(self, entite: str) -> str | None:
        """État d'une entité (ex : person.bastien -> "home"), ou None si inconnu."""
        try:
            r = await self._client.get(f"/api/states/{entite}")
        except httpx.HTTPError:
            return None
        return r.json().get("state") if r.status_code == 200 else None

    async def en_ligne(self) -> bool:
        try:
            r = await self._client.get("/api/")
            return r.status_code == 200
        except httpx.HTTPError:
            return False
