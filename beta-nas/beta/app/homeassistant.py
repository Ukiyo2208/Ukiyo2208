"""Client Home Assistant : commandes vocales, liste des appareils, création d'automatisations."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx


@dataclass
class ReponseHA:
    comprise: bool
    texte: str
    type: str = ""  # action_done, query_answer, error
    reussis: list | None = None  # cibles touchées (pièces, appareils)
    echecs: list | None = None


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
              "unit_of_measurement", "media_title", "media_artist", "media_album_name", "entity_picture",
              "volume_level", "is_volume_muted", "app_name", "source", "battery_level"]
_TEMPLATE_MAISON = (
    "{%- set ns = namespace(l=[], p=[], v=[]) -%}"
    "{%- for s in states if s.domain in " + json.dumps(DOMAINES_MAISON) + " and MOTIF_VOITURE not in s.entity_id -%}"
    "{%- set a = area_id(s.entity_id) -%}"
    "{%- set ns.l = ns.l + [{'id': s.entity_id, 'nom': s.name, 'etat': s.state, 'piece': area_name(s.entity_id) or '',"
    " 'piece_id': a or '', 'etage': ((floor_name(a) if a else '') or ''), 'attr': {"
    + ", ".join(f"'{k}': s.attributes.get('{k}')" for k in _ATTRIBUTS) +
    "}}] -%}"
    "{%- endfor -%}"
    "{%- for s in states.person -%}{%- set ns.p = ns.p + [{'id': s.entity_id, 'nom': s.name, 'etat': s.state,"
    " 'lat': s.attributes.get('latitude'), 'lon': s.attributes.get('longitude'), 'precision': s.attributes.get('gps_accuracy')}] -%}{%- endfor -%}"
    # La voiture (FordPass…) : ses entités sont mises à part, pour sa propre tuile
    "{%- for s in states if MOTIF_VOITURE in s.entity_id and s.domain in ['sensor', 'binary_sensor', 'lock', 'switch', 'button', 'device_tracker'] -%}"
    "{%- set ns.v = ns.v + [{'id': s.entity_id, 'nom': s.name, 'etat': s.state, 'unite': s.attributes.get('unit_of_measurement'),"
    " 'lat': s.attributes.get('latitude'), 'lon': s.attributes.get('longitude')}] -%}{%- endfor -%}"
    "{%- set d = states.zone.home -%}"
    "{%- set w = states.weather | first -%}"
    "{{ {'appareils': ns.l, 'personnes': ns.p, 'voiture': ns.v,"
    " 'domicile': ({'lat': d.attributes.get('latitude'), 'lon': d.attributes.get('longitude')} if d else None), 'meteo': ({'nom': w.name, 'etat': w.state,"
    " 'temperature': w.attributes.get('temperature'), 'unite': w.attributes.get('temperature_unit'),"
    " 'humidite': w.attributes.get('humidity'), 'vent': w.attributes.get('wind_speed')} if w else None)} | tojson }}"
)


def _raison(e: httpx.HTTPStatusError) -> str:
    """Pourquoi Home Assistant a refusé, en clair."""
    code = e.response.status_code
    if code in (401, 403):
        return ("Home Assistant refuse de donner les pièces à Bêta : le compte du jeton (HA_TOKEN) doit être "
                "administrateur (Home Assistant › Paramètres › Personnes › ton compte › Administrateur), puis "
                "crée un nouveau jeton.")
    detail = e.response.text.strip().replace("\n", " ")[:200]
    return f"Home Assistant n'a pas pu lire les pièces ({code} : {detail}). Affichage sans les pièces."


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
        type_ = reponse.get("response_type", "")
        donnees = reponse.get("data") or {}
        return ReponseHA(comprise=type_ != "error", texte=parole, type=type_,
                         reussis=donnees.get("success") or [], echecs=donnees.get("failed") or [])

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

    async def maison(self, motif_voiture: str = "fordpass") -> dict:
        """Tout ce que la page Bêta home affiche, en un seul appel : appareils (avec pièce, étage et
        attributs utiles), météo, personnes (avec leur position), voiture et position de la maison.
        Si Home Assistant refuse le modèle (jeton non administrateur, version ancienne…), plan B :
        la simple liste des états, sans les pièces, avec la raison dans « avertissement »."""
        motif = re.sub(r"[^a-z0-9_]", "", motif_voiture.lower()) or "fordpass"
        template = _TEMPLATE_MAISON.replace("MOTIF_VOITURE", json.dumps(motif).replace('"', "'"))
        try:
            return await self._rendre(template)
        except httpx.HTTPStatusError as e:
            raison = _raison(e)
        except ValueError as e:  # réponse qui n'est pas du JSON
            raison = f"Réponse de Home Assistant illisible ({e}). Affichage sans les pièces."
        try:
            # Home Assistant d'avant les étages (2024.4) : même chose sans les étages
            return await self._rendre(template.replace("(floor_name(a) if a else '')", "''"))
        except (httpx.HTTPStatusError, ValueError):
            pass
        donnees = await self._maison_simple(motif)
        donnees["avertissement"] = raison
        return donnees

    async def _maison_simple(self, motif: str) -> dict:
        """Plan B : GET /api/states, accessible à tout jeton. Pas de pièces ni d'étages."""
        r = await self._client.get("/api/states")
        r.raise_for_status()
        appareils, personnes, voiture, meteo, domicile = [], [], [], None, None
        for e in r.json():
            eid, attr = e.get("entity_id", ""), e.get("attributes") or {}
            domaine = eid.split(".", 1)[0]
            nom = attr.get("friendly_name") or eid.split(".", 1)[-1].replace("_", " ")
            if motif in eid and domaine in ("sensor", "binary_sensor", "lock", "switch", "button", "device_tracker"):
                voiture.append({"id": eid, "nom": nom, "etat": e.get("state"), "unite": attr.get("unit_of_measurement"),
                                "lat": attr.get("latitude"), "lon": attr.get("longitude")})
            elif domaine in DOMAINES_MAISON:
                appareils.append({"id": eid, "nom": nom, "etat": e.get("state"), "piece": "", "piece_id": "", "etage": "",
                                  "attr": {k: attr.get(k) for k in _ATTRIBUTS}})
            elif domaine == "person":
                personnes.append({"id": eid, "nom": nom, "etat": e.get("state"), "lat": attr.get("latitude"),
                                  "lon": attr.get("longitude"), "precision": attr.get("gps_accuracy")})
            elif domaine == "weather" and meteo is None:
                meteo = {"nom": nom, "etat": e.get("state"), "temperature": attr.get("temperature"),
                         "unite": attr.get("temperature_unit"), "humidite": attr.get("humidity"), "vent": attr.get("wind_speed")}
            elif eid == "zone.home":
                domicile = {"lat": attr.get("latitude"), "lon": attr.get("longitude")}
        return {"appareils": appareils, "personnes": personnes, "voiture": voiture, "domicile": domicile, "meteo": meteo}

    async def _rendre(self, template: str) -> dict:
        r = await self._client.post("/api/template", json={"template": template})
        r.raise_for_status()
        return json.loads(r.text)

    async def service(self, domaine: str, service: str, donnees: dict) -> None:
        r = await self._client.post(f"/api/services/{domaine}/{service}", json=donnees)
        r.raise_for_status()

    async def image(self, chemin: str) -> tuple[bytes, str]:
        """Une image servie par Home Assistant (pochette d'album, affiche…), avec la connexion de Bêta."""
        r = await self._client.get(chemin)
        r.raise_for_status()
        return r.content, r.headers.get("content-type", "image/jpeg")

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
