import asyncio
import json

import websockets

from app.config import Camera, Config
from app.presence import Presence


class FauxVisages:
    pass


async def test_detection_declenche_l_analyse():
    recus = {}

    async def faux_ha(ws):
        await ws.send(json.dumps({"type": "auth_required"}))
        recus["auth"] = json.loads(await ws.recv())
        await ws.send(json.dumps({"type": "auth_ok"}))
        recus["abonnement"] = json.loads(await ws.recv())
        await ws.send(json.dumps({
            "id": 1, "type": "event",
            "event": {"variables": {"trigger": {"entity_id": "binary_sensor.salon_personne", "to_state": {}}}},
        }))
        await asyncio.sleep(1)

    async with websockets.serve(faux_ha, "127.0.0.1", 0) as serveur:
        port = serveur.sockets[0].getsockname()[1]
        camera = Camera("camera.salon", "binary_sensor.salon_personne", "salon", "rdc")
        p = Presence(Config(ha_url=f"http://127.0.0.1:{port}", ha_token="jeton", cameras=[camera]), FauxVisages())
        analysees = asyncio.Queue()

        async def analyser(cam):
            await analysees.put(cam)

        p.analyser_camera = analyser
        tache = asyncio.create_task(p.ecouter())
        assert (await asyncio.wait_for(analysees.get(), 5)).piece == "salon"
        tache.cancel()
        await p.fermer()

    assert recus["auth"] == {"type": "auth", "access_token": "jeton"}
    assert recus["abonnement"]["trigger"]["entity_id"] == ["binary_sensor.salon_personne"]
