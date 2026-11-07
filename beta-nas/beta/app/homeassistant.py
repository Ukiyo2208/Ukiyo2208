"""Client Home Assistant : commandes vocales, liste des appareils, création d'automatisations."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx

log = logging.getLogger("beta.homeassistant")


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
                   "sensor", "binary_sensor", "lock", "vacuum", "camera", "number", "select", "button",
                   "input_number", "input_select"]
_ATTRIBUTS = ["brightness", "supported_color_modes", "color_mode", "color_temp_kelvin", "min_color_temp_kelvin",
              "max_color_temp_kelvin", "hs_color", "current_position", "current_tilt_position", "device_class",
              "temperature", "current_temperature", "min_temp", "max_temp", "target_temp_step", "hvac_action",
              "hvac_modes", "fan_mode", "fan_modes", "preset_mode", "preset_modes", "unit_of_measurement",
              "media_title", "media_artist", "media_album_name", "entity_picture", "volume_level",
              "is_volume_muted", "app_name", "source", "source_list", "battery_level", "fan_speed",
              "fan_speed_list", "percentage", "options", "min", "max", "step", "supported_features"]
# Seulement les pièces : leur nom, leur étage et leurs entités (petite réponse, même avec des milliers d'entités).
# area_entities() compte aussi les entités rangées par leur appareil.
_TEMPLATE_PIECES = (
    "{%- set ns = namespace(l=[]) -%}"
    "{%- for a in areas() -%}"
    "{%- set ns.l = ns.l + [[a, area_name(a), (floor_name(a) or ''), area_entities(a)]] -%}"
    "{%- endfor -%}"
    "{{ ns.l | tojson }}"
)
_SANS_ETAGE = "(floor_name(a) or '')"
_DOMAINES_VOITURE = ("sensor", "binary_sensor", "lock", "switch", "button", "device_tracker")
DUREE_REGISTRE = 300  # secondes : la liste des entités techniques change rarement


def _template_appareils(ids: list[str]) -> str:
    """De quel appareil vient chaque entité, et le nom, le fabricant et le modèle de chaque appareil."""
    return (
        "{%- set ns = namespace(e=[], d=[], l=[]) -%}"
        "{%- for eid in " + json.dumps(ids) + " -%}{%- set d = device_id(eid) -%}"
        "{%- if d -%}{%- set ns.e = ns.e + [[eid, d]] -%}{%- if d not in ns.d -%}{%- set ns.d = ns.d + [d] -%}{%- endif -%}{%- endif -%}"
        "{%- endfor -%}"
        "{%- for d in ns.d -%}{%- set ns.l = ns.l + [[d, device_attr(d, 'name_by_user') or device_attr(d, 'name') or '',"
        " device_attr(d, 'manufacturer') or '', device_attr(d, 'model') or '']] -%}{%- endfor -%}"
        "{{ {'entites': ns.e, 'appareils': ns.l} | tojson }}"
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
        self._token = token
        self._registre: dict | None = None
        self._registre_instant = 0.0
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
        """Tout ce que la page Bêta home affiche : appareils (pièce, étage, attributs utiles), météo,
        personnes (avec leur position), voiture et position de la maison.

        - les états viennent de GET /api/states (pas de limite de taille) ;
        - les pièces et étages d'un petit modèle ; s'il est refusé, tout s'affiche sans les pièces, avec la
          raison dans « avertissement » ;
        - les entités techniques (configuration, diagnostic) et cachées sont retirées, d'après la liste
          d'affichage de Home Assistant."""
        motif = re.sub(r"[^a-z0-9_]", "", motif_voiture.lower()) or "fordpass"
        r = await self._client.get("/api/states")
        r.raise_for_status()
        etats = r.json()
        pieces, avertissement = await self._pieces()
        registre = await self._registre_affichage()

        piece_de: dict[str, tuple[str, str, str]] = {}
        for area_id, nom, etage, entites in pieces:
            for eid in entites or []:
                piece_de.setdefault(eid, (area_id, nom or "", etage or ""))

        appareils, personnes, voiture, meteo, domicile = [], [], [], None, None
        for e in etats:
            eid, attr = e.get("entity_id", ""), e.get("attributes") or {}
            domaine = eid.split(".", 1)[0]
            nom = attr.get("friendly_name") or eid.split(".", 1)[-1].replace("_", " ")
            if motif in eid:
                if domaine in _DOMAINES_VOITURE:
                    voiture.append({"id": eid, "nom": nom, "etat": e.get("state"), "unite": attr.get("unit_of_measurement"),
                                    "lat": attr.get("latitude"), "lon": attr.get("longitude")})
            elif domaine in DOMAINES_MAISON:
                fiche = registre.get(eid) or {}
                if "ec" in fiche or fiche.get("hb"):  # réglage, diagnostic ou entité cachée
                    continue
                area_id, piece, etage = piece_de.get(eid, ("", "", ""))
                appareils.append({"id": eid, "nom": nom, "etat": e.get("state"), "piece": piece, "piece_id": area_id,
                                  "etage": etage, "attr": {k: attr[k] for k in _ATTRIBUTS if attr.get(k) is not None}})
            elif domaine == "person":
                personnes.append({"id": eid, "nom": nom, "etat": e.get("state"), "lat": attr.get("latitude"),
                                  "lon": attr.get("longitude"), "precision": attr.get("gps_accuracy")})
            elif domaine == "weather" and meteo is None:
                meteo = {"nom": nom, "etat": e.get("state"), "temperature": attr.get("temperature"),
                         "unite": attr.get("temperature_unit"), "humidite": attr.get("humidity"), "vent": attr.get("wind_speed")}
            elif eid == "zone.home":
                domicile = {"lat": attr.get("latitude"), "lon": attr.get("longitude")}
        appareils_ha = await self._appareils_ha(appareils)
        return {"appareils": appareils, "appareils_ha": appareils_ha, "personnes": personnes, "voiture": voiture,
                "domicile": domicile, "meteo": meteo, "avertissement": avertissement}

    async def _appareils_ha(self, appareils: list[dict]) -> dict[str, dict]:
        """Ajoute « appareil » (identifiant de l'appareil Home Assistant) à chaque entité, et renvoie
        {identifiant: {nom, fabricant, modele}}. Vide si Home Assistant refuse : chaque entité reste seule."""
        if not appareils:
            return {}
        try:
            donnees = await self._rendre(_template_appareils([a["id"] for a in appareils]))
        except (httpx.HTTPStatusError, ValueError) as e:
            log.info("Appareils de Home Assistant indisponibles (%s) : une tuile par entité", e)
            return {}
        if not isinstance(donnees, dict):
            return {}
        appareil_de = dict(donnees.get("entites", []))
        for a in appareils:
            if appareil_de.get(a["id"]):
                a["appareil"] = appareil_de[a["id"]]
        return {d: {"nom": nom, "fabricant": fab, "modele": modele} for d, nom, fab, modele in donnees.get("appareils", [])}

    async def _pieces(self) -> tuple[list, str]:
        """[[area_id, nom, étage, [entités]], …] et un avertissement si Home Assistant refuse."""
        try:
            return await self._rendre(_TEMPLATE_PIECES), ""
        except httpx.HTTPStatusError as e:
            raison = _raison(e)
        except ValueError as e:
            raison = f"Réponse de Home Assistant illisible ({e}). Affichage sans les pièces."
        try:  # Home Assistant d'avant les étages (2024.4)
            return await self._rendre(_TEMPLATE_PIECES.replace(_SANS_ETAGE, "''")), ""
        except (httpx.HTTPStatusError, ValueError):
            return [], raison

    async def _registre_affichage(self) -> dict[str, dict]:
        """Liste d'affichage de Home Assistant (celle de son interface) : catégorie (« ec ») et entités
        cachées (« hb »). Gardée 5 minutes. Vide si elle n'est pas disponible : rien n'est alors retiré."""
        if self._registre is not None and time.monotonic() - self._registre_instant < DUREE_REGISTRE:
            return self._registre
        try:
            self._registre = await asyncio.wait_for(self._lire_registre(), timeout=10)
        except Exception as e:  # WebSocket refusé, ancienne version : on affiche tout
            log.info("Liste d'affichage de Home Assistant indisponible (%s) : entités techniques gardées", e)
            self._registre = {}
        self._registre_instant = time.monotonic()
        return self._registre

    async def _lire_registre(self) -> dict[str, dict]:
        from websockets.asyncio.client import connect

        adresse = re.sub(r"^http", "ws", self.url.rstrip("/")) + "/api/websocket"
        async with connect(adresse, max_size=None, open_timeout=8) as ws:
            await ws.recv()  # auth_required
            await ws.send(json.dumps({"type": "auth", "access_token": self._token}))
            if json.loads(await ws.recv()).get("type") != "auth_ok":
                raise PermissionError("jeton refusé")
            await ws.send(json.dumps({"id": 1, "type": "config/entity_registry/list_for_display"}))
            while True:
                message = json.loads(await ws.recv())
                if message.get("id") == 1:
                    break
        if not message.get("success"):
            raise RuntimeError(message.get("error", {}).get("message", "refus"))
        return {e["ei"]: e for e in message["result"].get("entities", []) if "ei" in e}

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
