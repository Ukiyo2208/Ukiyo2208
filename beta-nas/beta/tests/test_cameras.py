"""Caméras directes : ONVIF (fausse caméra qui vérifie le mot de passe comme une vraie), images et direct (ffmpeg)."""
import asyncio
import base64
import hashlib
import os
import re
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from app import cameras
from app.routeur import Routeur
from app.settings import Settings

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200 + b"\xff\xd9"


@pytest.fixture
def camera_onvif():
    class FausseCamera(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _envoyer(self, code, corps, type_="application/soap+xml"):
            self.send_response(code); self.send_header("Content-Type", type_); self.end_headers(); self.wfile.write(corps)

        def do_POST(self):
            corps = self.rfile.read(int(self.headers["Content-Length"])).decode()
            nonce = base64.b64decode(re.search(r"<Nonce[^>]*>([^<]+)</Nonce>", corps).group(1))
            cree = re.search(r"<Created[^>]*>([^<]+)</Created>", corps).group(1)
            attendu = base64.b64encode(hashlib.sha1(nonce + cree.encode() + b"secret").digest()).decode()
            if "<Username>admin</Username>" not in corps or attendu not in corps:
                return self._envoyer(400, b"<Fault><Subcode><Value>ter:NotAuthorized</Value></Subcode></Fault>")
            base = f"http://127.0.0.1:{self.server.server_address[1]}"
            if "GetCapabilities" in corps:
                rep = f'<tt:Media xmlns:tt="http://www.onvif.org/ver10/schema"><tt:XAddr>{base}/onvif/media</tt:XAddr></tt:Media>'
            elif "GetProfiles" in corps:
                rep = '<trt:Profiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" token="principal"/><trt:Profiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" token="secondaire"/>'
            elif "GetStreamUri" in corps:
                assert "<ProfileToken>principal</ProfileToken>" in corps
                rep = '<tt:Uri xmlns:tt="http://www.onvif.org/ver10/schema">rtsp://127.0.0.1:554/h264Preview_01_main</tt:Uri>'
            else:
                rep = f'<tt:Uri xmlns:tt="http://www.onvif.org/ver10/schema">{base}/snap.jpg</tt:Uri>'
            self._envoyer(200, f'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>{rep}</s:Body></s:Envelope>'.encode())

        def do_GET(self):
            if self.headers.get("Authorization") != "Basic " + base64.b64encode(b"admin:secret").decode():
                self.send_response(401); self.send_header("WWW-Authenticate", 'Basic realm="cam"'); self.end_headers(); return
            self._envoyer(200, JPEG, "image/jpeg")

    srv = HTTPServer(("127.0.0.1", 0), FausseCamera)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def test_onvif_trouve_le_flux_et_l_image(camera_onvif):
    infos = asyncio.run(cameras.decouvrir_onvif("127.0.0.1", camera_onvif, "admin", "secret"))
    assert infos["rtsp"] == "rtsp://admin:secret@127.0.0.1:554/h264Preview_01_main"  # flux principal, identifiants ajoutés
    assert infos["image"].endswith("/snap.jpg")


def test_onvif_mauvais_mot_de_passe_et_camera_absente(camera_onvif):
    with pytest.raises(cameras.ErreurCamera, match="refusé"):
        asyncio.run(cameras.decouvrir_onvif("127.0.0.1", camera_onvif, "admin", "faux"))
    with pytest.raises(cameras.ErreurCamera, match="injoignable"):
        asyncio.run(cameras.decouvrir_onvif("127.0.0.1", 9, "admin", "secret"))
    with pytest.raises(cameras.ErreurCamera, match="invalide"):
        asyncio.run(cameras.decouvrir_onvif("127.0.0.1/../x", 80, "admin", "secret"))


def test_identifiants_dans_l_adresse_rtsp():
    assert cameras._avec_identifiants("rtsp://10.0.0.5/live", "admin", "p@ss:1") == "rtsp://admin:p%40ss%3A1@10.0.0.5/live"
    assert cameras._avec_identifiants("rtsp://u:p@10.0.0.5/live", "admin", "x") == "rtsp://u:p@10.0.0.5/live"


def test_ajout_onvif_mots_de_passe_proteges(camera_onvif, tmp_path):
    liste = cameras.Cameras(tmp_path / "cameras.json")
    publique = asyncio.run(liste.ajouter("Entrée", "Entrée", ip="127.0.0.1", port=camera_onvif, utilisateur="admin", mot_de_passe="secret"))
    assert publique == {"id": publique["id"], "nom": "Entrée", "piece": "Entrée", "source": "onvif", "hote": "127.0.0.1"}
    assert "secret" not in str(liste.publiques())
    assert oct(os.stat(tmp_path / "cameras.json").st_mode & 0o777) == "0o600"
    assert asyncio.run(liste.image(liste.trouver(publique["id"]))) == JPEG  # l'image fixe ONVIF (sans ffmpeg)
    relue = cameras.Cameras(tmp_path / "cameras.json")
    assert relue.publiques() == [publique]
    relue.supprimer(publique["id"])
    assert cameras.Cameras(tmp_path / "cameras.json").liste == []


def test_rtsp_adresse_invalide(tmp_path):
    with pytest.raises(cameras.ErreurCamera, match="rtsp://"):
        asyncio.run(cameras.Cameras(tmp_path / "c.json").ajouter("X", rtsp="http://10.0.0.5/flux"))


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg absent")
def test_api_image_et_direct(camera_onvif, tmp_path, monkeypatch):
    video = tmp_path / "test.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10", "-t", "1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)], check=True)
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    with TestClient(main.app, client=("192.168.68.20", 50000)) as c:
        main.etat["routeur"] = Routeur(Settings(), None, None, None)
        main.etat.pop("cameras", None)
        r = c.post("/v1/cameras", json={"nom": "Jardin", "ip": "127.0.0.1", "port": camera_onvif, "utilisateur": "admin", "mot_de_passe": "secret"})
        assert r.status_code == 200, r.text
        ident = r.json()["id"]
        assert c.post("/v1/cameras", json={"nom": "X", "ip": "127.0.0.1", "port": camera_onvif, "utilisateur": "admin",
                                           "mot_de_passe": "faux"}).status_code == 400
        assert c.post("/v1/cameras", json={"nom": "Vide"}).status_code == 400
        assert c.get(f"/v1/cameras/{ident}/image").content == JPEG
        # Une caméra sans image fixe : l'image et le direct sont tirés du flux par ffmpeg
        main.etat["cameras"].liste.append({"id": "flux", "nom": "Flux", "rtsp": str(video), "image": ""})
        image = c.get("/v1/cameras/flux/image")
        assert image.status_code == 200 and image.content[:2] == b"\xff\xd8"
        direct = c.get("/v1/cameras/flux/direct")
        assert direct.headers["content-type"].startswith("multipart/x-mixed-replace") and direct.content.count(b"--ffmpeg") >= 5
        assert c.get("/v1/cameras/inconnue/image").status_code == 503
        assert {x["nom"] for x in c.get("/v1/cameras").json()} == {"Jardin", "Flux"}
        assert c.delete(f"/v1/cameras/{ident}").json() == {"ok": True}
