"""Écoute les détections de personne des caméras, reconnaît les visages et tient à jour qui est où."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import cv2
import httpx
import numpy as np
import websockets

from .config import Camera, Config
from .visages import Visages

log = logging.getLogger("presence")

PAUSE_ENTRE_ANALYSES = 10  # secondes, par caméra


@dataclass
class Vue:
    piece: str
    zone: str
    camera: str
    instant: float  # time.time()
    score: float = 0.0


class Presence:
    def __init__(self, config: Config, visages: Visages):
        self.config = config
        self.visages = visages
        self.personnes: dict[str, Vue] = {}  # dernière fois où chaque personne connue a été vue
        self.inconnus: dict[str, Vue] = {}  # dernière personne inconnue vue, par zone
        self._derniere_analyse: dict[str, float] = {}
        self._en_cours: set[str] = set()
        self._ha = httpx.AsyncClient(
            base_url=config.ha_url, headers={"Authorization": f"Bearer {config.ha_token}"}, timeout=10
        )

    async def fermer(self) -> None:
        await self._ha.aclose()

    # ------------------------------------------------------------ Lecture

    def etat(self) -> dict:
        """Ce que Bêta interroge : âge des dernières vues, en secondes."""
        maintenant = time.time()
        return {
            "validite_s": self.config.validite_minutes * 60,
            "personnes": {
                nom: {"piece": v.piece, "zone": v.zone, "vu_il_y_a_s": round(maintenant - v.instant), "score": v.score}
                for nom, v in self.personnes.items()
            },
            "inconnus": {
                zone: {"piece": v.piece, "vu_il_y_a_s": round(maintenant - v.instant)} for zone, v in self.inconnus.items()
            },
        }

    # ------------------------------------------------------------ Analyse

    async def capture(self, entite: str) -> np.ndarray | None:
        r = await self._ha.get(f"/api/camera_proxy/{entite}")
        if r.status_code != 200:
            log.warning("Capture impossible sur %s (%s)", entite, r.status_code)
            return None
        return cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)

    async def analyser_camera(self, camera: Camera) -> None:
        maintenant = time.time()
        if camera.camera in self._en_cours or maintenant - self._derniere_analyse.get(camera.camera, 0) < PAUSE_ENTRE_ANALYSES:
            return
        self._en_cours.add(camera.camera)
        self._derniere_analyse[camera.camera] = maintenant
        try:
            meilleurs: dict[str, float] = {}
            inconnu_vu = False
            for i in range(self.config.nb_captures):
                if i:
                    await asyncio.sleep(self.config.intervalle_captures)
                image = await self.capture(camera.camera)
                if image is None:
                    continue
                for v in await asyncio.to_thread(self.visages.analyser, image):
                    if v.nom:
                        meilleurs[v.nom] = max(v.score, meilleurs.get(v.nom, 0.0))
                    else:
                        inconnu_vu = True
                if meilleurs and not inconnu_vu and i >= 1:
                    break  # deux captures suffisent quand tout le monde est reconnu

            instant = time.time()
            for nom, score in meilleurs.items():
                self.personnes[nom] = Vue(camera.piece, camera.zone, camera.camera, instant, round(score, 3))
                await self.publier(nom)
            # Un visage que personne ne connaît a peut-être été mal reconnu : on le note pour rester prudent
            if inconnu_vu:
                self.inconnus[camera.zone] = Vue(camera.piece, camera.zone, camera.camera, instant)
            if meilleurs or inconnu_vu:
                log.info("%s : %s%s", camera.piece, ", ".join(meilleurs) or "-", " + inconnu" if inconnu_vu else "")
        except httpx.HTTPError as e:
            log.warning("Analyse de %s impossible : %s", camera.camera, e)
        finally:
            self._en_cours.discard(camera.camera)

    # ------------------------------------------------------------ Home Assistant

    async def publier(self, nom: str) -> None:
        """Crée / met à jour sensor.beta_position_<nom> (utilisable dans les automatisations)."""
        vue = self.personnes.get(nom)
        perime = vue is None or time.time() - vue.instant > self.config.validite_minutes * 60
        attributs = {"friendly_name": f"Position de {nom.capitalize()}", "icon": "mdi:account-search"}
        if vue:
            attributs |= {
                "zone": vue.zone,
                "camera": vue.camera,
                "derniere_vue": datetime.fromtimestamp(vue.instant, timezone.utc).isoformat(),
            }
        try:
            await self._ha.post(
                f"/api/states/sensor.beta_position_{nom}",
                json={"state": "inconnue" if perime else vue.piece, "attributes": attributs},
            )
        except httpx.HTTPError as e:
            log.warning("Publication de la position de %s impossible : %s", nom, e)

    async def expirer(self) -> None:
        """Toutes les minutes : les positions trop anciennes passent à « inconnue »."""
        deja_expires: set[str] = set()
        while True:
            await asyncio.sleep(60)
            limite = time.time() - self.config.validite_minutes * 60
            for nom, vue in list(self.personnes.items()):
                if vue.instant < limite and nom not in deja_expires:
                    await self.publier(nom)
                    deja_expires.add(nom)
                elif vue.instant >= limite:
                    deja_expires.discard(nom)

    async def ecouter(self) -> None:
        """Abonnement aux capteurs de détection via l'API WebSocket de Home Assistant."""
        if not self.config.cameras:
            log.warning("Aucune caméra dans config.yaml : rien à surveiller")
            return
        url = self.config.ha_url.replace("http", "ws", 1) + "/api/websocket"
        attente = 1
        while True:
            try:
                async with websockets.connect(url, max_size=None) as ws:
                    await ws.recv()  # auth_required
                    await ws.send(json.dumps({"type": "auth", "access_token": self.config.ha_token}))
                    if json.loads(await ws.recv()).get("type") != "auth_ok":
                        log.error("HA_TOKEN refusé par Home Assistant")
                        await asyncio.sleep(60)
                        continue
                    await ws.send(json.dumps({
                        "id": 1,
                        "type": "subscribe_trigger",
                        "trigger": {
                            "platform": "state",
                            "entity_id": [c.detection for c in self.config.cameras],
                            "to": "on",
                        },
                    }))
                    log.info("À l'écoute de %d caméras", len(self.config.cameras))
                    attente = 1
                    async for brut in ws:
                        message = json.loads(brut)
                        if message.get("type") != "event":
                            continue
                        entite = message["event"]["variables"]["trigger"]["entity_id"]
                        camera = self.config.camera(entite)
                        if camera:
                            asyncio.create_task(self.analyser_camera(camera))
            except (OSError, websockets.WebSocketException) as e:
                log.warning("Connexion à Home Assistant perdue (%s), nouvel essai dans %d s", e, attente)
            await asyncio.sleep(attente)
            attente = min(attente * 2, 60)
