"""Nécessite les modèles YuNet + SFace (dossier indiqué par PRESENCE_MODELES) et scikit-image (photo de test)."""

import os
from pathlib import Path

import cv2
import httpx
import pytest

from app.config import Camera, Config
from app.presence import Presence
from app.visages import Visages

MODELES = Path(os.environ.get("PRESENCE_MODELES", "/modeles"))
pytestmark = pytest.mark.skipif(not (MODELES / "face_recognition_sface_2021dec.onnx").exists(), reason="modèles absents")


def photo():
    data = pytest.importorskip("skimage.data")
    return cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)


def presence(tmp_path, image):
    config = Config(cameras=[Camera("camera.salon", "binary_sensor.salon_personne", "salon", "rdc")])
    visages = Visages(MODELES, tmp_path / "visages.json", seuil=0.4, taille_min=50)
    p = Presence(config, visages)
    publies = []
    jpeg = cv2.imencode(".jpg", image)[1].tobytes()

    def ha(requete: httpx.Request):
        if requete.url.path.startswith("/api/camera_proxy/"):
            return httpx.Response(200, content=jpeg)
        publies.append((requete.url.path, requete.content))
        return httpx.Response(200, json={})

    p._ha = httpx.AsyncClient(base_url="http://ha", transport=httpx.MockTransport(ha))
    return p, visages, publies


async def test_personne_connue_vue_au_salon(tmp_path):
    image = photo()
    p, visages, publies = presence(tmp_path, image)
    visages.ajouter("eileen", [visages.empreintes(image)[0][0]])
    await p.analyser_camera(p.config.cameras[0])
    assert p.personnes["eileen"].piece == "salon" and p.personnes["eileen"].zone == "rdc"
    assert p.inconnus == {}
    assert publies[0][0] == "/api/states/sensor.beta_position_eileen" and b'"salon"' in publies[0][1]
    assert p.etat()["personnes"]["eileen"]["zone"] == "rdc"


async def test_visage_inconnu(tmp_path):
    p, _, publies = presence(tmp_path, photo())
    await p.analyser_camera(p.config.cameras[0])
    assert p.personnes == {} and "rdc" in p.inconnus and publies == []


async def test_pause_entre_deux_analyses(tmp_path):
    p, _, _ = presence(tmp_path, photo())
    await p.analyser_camera(p.config.cameras[0])
    p.inconnus.clear()
    await p.analyser_camera(p.config.cameras[0])  # trop tôt : ignorée
    assert p.inconnus == {}


def test_base_de_visages_persistante(tmp_path):
    v = Visages(MODELES, tmp_path / "visages.json", seuil=0.4, taille_min=50)
    v.ajouter("bastien", [[0.1] * 128, [0.2] * 128])
    assert Visages(MODELES, tmp_path / "visages.json", seuil=0.4, taille_min=50).noms() == {"bastien": 2}
