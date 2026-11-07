import pytest
from fastapi.testclient import TestClient

from app import ia, llm_local
from app.routeur import DISCUSSION, MAISON, Routeur
from app.settings import Personne, Settings


class FauxHA:
    def __init__(self):
        self.commandes, self.bascules = [], []

    async def commande(self, texte):
        from app.homeassistant import ReponseHA
        self.commandes.append(texte)
        return ReponseHA(texte == "allume le salon", "C'est fait" if texte == "allume le salon" else "Désolé")

    async def etats(self, domaines):
        return [{"id": "light.salon", "nom": "Salon", "etat": "on", "piece": "Salon"}]

    async def basculer(self, entite):
        self.bascules.append(entite)

    async def en_ligne(self):
        return True


class FauxLLM:
    async def trier(self, texte):
        return llm_local.Tri(llm_local.CONVERSATION)


class FausseIA:
    def disponible(self, tache):
        return True

    async def demander(self, tache, systeme, messages, **kw):
        return ia.Resultat("Une blague !", "rapide")


def routeur():
    return Routeur(Settings(personnes={"bastien": Personne("bastien", "admin")}), FauxHA(), FauxLLM(), FausseIA())


@pytest.mark.asyncio
async def test_mode_discussion_ne_passe_pas_par_la_maison():
    rt = routeur()
    r = await rt.traiter("allume le salon", mode=DISCUSSION)
    assert r.route == "conversation:rapide" and rt.ha.commandes == []


@pytest.mark.asyncio
async def test_mode_maison_ne_bavarde_pas():
    rt = routeur()
    assert (await rt.traiter("allume le salon", mode=MAISON)).route == "home_assistant"
    r = await rt.traiter("raconte une blague", mode=MAISON)
    assert r.route == "incompris" and "commande" in r.texte


def test_page_et_appareils(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("TRI_URL", "http://127.0.0.1:9")
    from app import main

    h = {"Authorization": "Bearer secret"}
    with TestClient(main.app) as client:
        rt = routeur()
        main.etat["routeur"] = rt
        assert "Bêta" in client.get("/").text
        assert client.get("/v1/maison/appareils").status_code == 401
        assert client.get("/v1/maison/appareils", headers=h).json()[0]["id"] == "light.salon"
        assert client.post("/v1/maison/basculer", headers=h, json={"entite": "light.salon"}).json() == {"ok": True}
        # Une serrure ne s'ouvre jamais depuis la page
        assert client.post("/v1/maison/basculer", headers=h, json={"entite": "lock.porte"}).status_code == 400
        assert rt.ha.bascules == ["light.salon"]
        # Trieur absent : message clair
        assert client.get("/v1/tri/etat", headers=h).status_code == 503
        r = client.post("/v1/texte", headers=h, json={"texte": "salut", "mode": "discussion"}).json()
        assert r["reponse"] == "Une blague !"


def _client(monkeypatch, tmp_path, ip, tri_url="http://127.0.0.1:9"):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("TRI_URL", tri_url)
    from app import main

    return main, TestClient(main.app, client=(ip, 50000))


@pytest.mark.parametrize("ip", ["192.168.68.20", "10.0.0.5", "172.18.0.1", "127.0.0.1", "::ffff:192.168.1.4"])
def test_pas_de_jeton_a_la_maison(monkeypatch, tmp_path, ip):
    main, client = _client(monkeypatch, tmp_path, ip)
    with client:
        main.etat["routeur"] = routeur()
        assert client.get("/v1/maison/appareils").status_code == 200
        # Un mauvais jeton reste refusé, même à la maison
        assert client.get("/v1/maison/appareils", headers={"Authorization": "Bearer faux"}).status_code == 401


@pytest.mark.parametrize("ip", ["8.8.8.8", "100.101.1.2", "2a01:e0a::1"])
def test_jeton_obligatoire_hors_de_la_maison(monkeypatch, tmp_path, ip):
    main, client = _client(monkeypatch, tmp_path, ip)
    with client:
        main.etat["routeur"] = routeur()
        assert client.get("/v1/maison/appareils").status_code == 401
        assert client.get("/v1/stats").status_code == 401
        assert client.get("/tri/api/etat").status_code == 401
        assert client.get("/v1/maison/appareils", headers={"Authorization": "Bearer secret"}).status_code == 200


def test_relaye_par_un_proxy_demande_le_jeton(monkeypatch, tmp_path):
    main, client = _client(monkeypatch, tmp_path, "172.18.0.1")
    with client:
        main.etat["routeur"] = routeur()
        assert client.get("/v1/maison/appareils", headers={"X-Forwarded-For": "8.8.8.8"}).status_code == 401


def test_acces_local_desactivable(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_LOCAL_LIBRE", "non")
    main, client = _client(monkeypatch, tmp_path, "192.168.1.4")
    with client:
        main.etat["routeur"] = routeur()
        assert client.get("/v1/maison/appareils").status_code == 401


def test_page_du_tri_servie_par_beta(monkeypatch, tmp_path):
    import sys
    import threading
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "trieur"))
    import trieur
    import web

    c = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", "volume1")
    (c.rangement / "Banque").mkdir(parents=True)
    c.creer()
    srv = web.serveur(c, 0, hote="127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        main, client = _client(monkeypatch, tmp_path, "192.168.68.20", f"http://127.0.0.1:{srv.server_address[1]}")
        with client:
            main.etat["routeur"] = routeur()
            assert client.get("/tri", follow_redirects=False).headers["location"] == "/tri/"
            assert "Tri des documents" in client.get("/tri/").text
            assert client.get("/tri/api/dossiers?chemin=volume1").json()[0]["nom"] == "Banque"
            r = client.post("/tri/api/reglages", json={"exclusions": ["volume1/Banque"]})
            assert r.status_code == 200 and r.json()["exclusions"] == ["volume1/Banque"]
            assert client.get("/v1/tri/etat").json()["rangement"] == "volume1"
            assert client.get("/v1/stats").json()["services"]["trieur"]["ok"] is True
            assert client.post("/v1/tri/lancer", json={"tout": True}).status_code == 200
            assert client.post("/v1/tri/lancer").status_code == 200  # sans corps : 5 documents
            assert client.post("/v1/tri/arreter").status_code == 200
    finally:
        srv.shutdown()


def test_beta_home_servi_par_beta(monkeypatch, tmp_path):
    """Bêta home est servi sous /home/, son serveur sous /api/, avec le pont vers Bêta IA dans la page."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    recus = []

    class FauxBetaHome(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _repondre(self, code, corps, type_, **entetes):
            self.send_response(code)
            self.send_header("Content-Type", type_)
            for k, v in entetes.items():
                self.send_header(k.replace("_", "-"), v)
            self.end_headers()
            self.wfile.write(corps)

        def do_GET(self):
            recus.append((self.command, self.path, self.headers.get("X-Beta-Key")))
            if self.path == "/":
                return self._repondre(200, b"<html><body><script src='bundle.js'></script></body></html>", "text/html; charset=utf-8", ETag='"x"')
            if self.path == "/vieux":
                return self._repondre(302, b"", "text/plain", Location="/index.html#accueil")
            if self.path.startswith("/api/ping"):
                return self._repondre(200, b'{"ok": true}', "application/json")
            self._repondre(404, b"{}", "application/json")

        def do_PUT(self):
            longueur = int(self.headers.get("Content-Length", 0))
            recus.append((self.command, self.path, self.rfile.read(longueur)))
            self._repondre(200, b'{"enregistre": true}', "application/json")

    srv = HTTPServer(("127.0.0.1", 0), FauxBetaHome)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("HOME_URL", f"http://127.0.0.1:{srv.server_address[1]}")
        main, client = _client(monkeypatch, tmp_path, "8.8.8.8")  # même hors de la maison : Bêta home a sa propre clé
        with client:
            main.etat["routeur"] = routeur()
            assert client.get("/home", follow_redirects=False).headers["location"] == "/home/"
            page = client.get("/home/")
            assert page.status_code == 200 and "pont-beta-home.js" in page.text and "etag" not in page.headers
            assert client.get("/home/vieux", follow_redirects=False).headers["location"] == "/home/index.html#accueil"
            assert client.get("/api/ping?x=1", headers={"X-Beta-Key": "cle"}).json() == {"ok": True}
            assert recus[-1] == ("GET", "/api/ping?x=1", "cle")
            assert client.put("/api/store/reglages", json={"a": 1}).json() == {"enregistre": True}
            assert recus[-1] == ("PUT", "/api/store/reglages", b'{"a":1}')
            assert client.get("/static/pont-beta-home.js").status_code == 200
        monkeypatch.setenv("HOME_URL", "http://127.0.0.1:9")
        main, client = _client(monkeypatch, tmp_path, "192.168.1.5")
        with client:
            main.etat["routeur"] = routeur()
            assert client.get("/home/").status_code == 503
    finally:
        srv.shutdown()
