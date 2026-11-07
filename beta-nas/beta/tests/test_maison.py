import pytest
from fastapi.testclient import TestClient

from app import maison
from app.routeur import Routeur
from app.settings import Settings

APPAREILS = [
    {"id": "light.salon", "nom": "Lustre", "etat": "on", "piece": "Salon", "piece_id": "salon", "etage": "RDC",
     "attr": {"brightness": 128, "supported_color_modes": ["brightness"]}},
    {"id": "cover.volet_salon", "nom": "Volet", "etat": "open", "piece": "Salon", "piece_id": "salon", "etage": "RDC",
     "attr": {"current_position": 60}},
    {"id": "cover.garage", "nom": "Porte garage", "etat": "closed", "piece": "Garage", "piece_id": "garage", "etage": "RDC",
     "attr": {"device_class": "garage"}},
    {"id": "lock.entree", "nom": "Serrure", "etat": "locked", "piece": "Entrée", "piece_id": "entree", "etage": "RDC", "attr": {}},
    {"id": "sensor.temp_salon", "nom": "Température", "etat": "21.4", "piece": "Salon", "piece_id": "salon", "etage": "RDC",
     "attr": {"device_class": "temperature"}},
    {"id": "sensor.wifi_signal", "nom": "Signal", "etat": "-60", "piece": "", "piece_id": "", "etage": "", "attr": {"device_class": "signal_strength"}},
    {"id": "switch.prise", "nom": "Prise", "etat": "off", "piece": "Bureau", "piece_id": "bureau", "etage": "Étage 1", "attr": {}},
    {"id": "scene.soiree", "nom": "Soirée", "etat": "unknown", "piece": "", "piece_id": "", "etage": "", "attr": {}},
    {"id": "climate.clim", "nom": "Clim", "etat": "cool", "piece": "Salon", "piece_id": "salon", "etage": "RDC", "attr": {"temperature": 22}},
]


class FauxHA:
    def __init__(self):
        self.services = []

    async def maison(self):
        return {"appareils": [dict(a) for a in APPAREILS], "personnes": [{"id": "person.bastien", "nom": "Bastien", "etat": "home"}],
                "meteo": {"nom": "Maison", "etat": "sunny", "temperature": 12}}

    async def attributs(self, entite):
        return next(a["attr"] for a in APPAREILS if a["id"] == entite)

    async def service(self, domaine, service, donnees):
        self.services.append((domaine, service, donnees))


def test_filtre_et_actions():
    liste = maison.appareils({"appareils": APPAREILS})
    assert "sensor.wifi_signal" not in {a["id"] for a in liste} and "sensor.temp_salon" in {a["id"] for a in liste}
    assert maison.commande_page("light.salon", "luminosite", 250, {}) == ("light", "turn_on", {"entity_id": "light.salon", "brightness_pct": 100})
    for entite, action, attr in (("lock.entree", "basculer", {}), ("cover.garage", "ouvrir", {"device_class": "garage"}),
                                 ("light.salon", "supprimer", {})):
        with pytest.raises(maison.ActionRefusee):
            maison.commande_page(entite, action, None, attr)


def test_partage_alexa_et_homekit_separes(tmp_path):
    partage = maison.Partage(tmp_path / "alexa.json")
    liste = maison.appareils({"appareils": APPAREILS})
    elements = {e["key"]: e for e in partage.elements(liste, "alexa")}
    # Par défaut : lumières, prises, volets, scènes ; jamais la serrure, le garage ni la clim
    assert set(elements) == {"light.salon", "cover.volet_salon", "switch.prise", "scene.soiree"}
    assert elements["light.salon"]["state"] == {"on": True, "bri": 50} and elements["light.salon"]["alexa"] is True
    assert elements["cover.volet_salon"]["state"] == {"pos": 60} and elements["scene.soiree"]["type"] == "button"
    partage.choisir("switch.prise", "alexa", False)
    partage.choisir("sensor.temp_salon", "homekit", True)
    partage.choisir("lock.entree", "homekit", True)  # ignoré : une serrure n'est jamais partagée
    with pytest.raises(maison.ActionRefusee):
        partage.choisir("light.salon", "google", True)
    partage = maison.Partage(tmp_path / "alexa.json")  # relu depuis le fichier
    assert {e["key"] for e in partage.elements(liste, "alexa")} == {"light.salon", "cover.volet_salon", "scene.soiree"}
    assert {e["key"] for e in partage.elements(liste, "homekit")} == {"light.salon", "cover.volet_salon", "switch.prise",
                                                                     "scene.soiree", "sensor.temp_salon"}
    lumiere = next(a for a in liste if a["id"] == "light.salon")
    assert partage.commande(lumiere, {"on": False}, "homekit") == ("homeassistant", "turn_off", {"entity_id": "light.salon"})
    assert partage.commande(lumiere, {"bri": 30}, "alexa")[2]["brightness_pct"] == 30
    volet = next(a for a in liste if a["id"] == "cover.volet_salon")
    assert partage.commande(volet, {"pos": 20}, "alexa") == ("cover", "set_cover_position", {"entity_id": "cover.volet_salon", "position": 20})
    prise = next(a for a in liste if a["id"] == "switch.prise")
    assert partage.commande(prise, {"on": True}, "homekit")[1] == "turn_on"  # visible dans HomeKit…
    with pytest.raises(maison.ActionRefusee):
        partage.commande(prise, {"on": True}, "alexa")  # … mais caché à Alexa


def test_ancien_fichier_alexa(tmp_path):
    (tmp_path / "alexa.json").write_text('{"choix": {"switch.prise": false}}')
    assert maison.Partage(tmp_path / "alexa.json").choix == {"alexa": {"switch.prise": False}, "homekit": {}}


def test_enceintes_et_radios():
    assert maison.commande_page("media_player.salon", "volume", 35, {}) == ("media_player", "volume_set", {"entity_id": "media_player.salon", "volume_level": 0.35})
    d, service, donnees = maison.commande_page("media_player.salon", "radio", 2, {})
    assert service == "play_media" and donnees["media_content_id"] == maison.RADIOS[2]["url"]
    with pytest.raises(maison.ActionRefusee):
        maison.commande_page("media_player.salon", "radio", 99, {})


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    with TestClient(main.app, client=("192.168.68.20", 50000)) as c:
        ha = FauxHA()
        main.etat["routeur"] = Routeur(Settings(), ha, None, None)
        main.etat.pop("partage", None)
        main.etat.pop("plex", None)
        main._maison_cache["valeur"] = None
        yield c, ha


def test_page_et_etat(client):
    c, ha = client
    assert c.get("/home", follow_redirects=False).headers["location"] == "/home/"
    assert "Bêta home" in c.get("/home/").text
    assert c.get("/static/home/pieces/rdc-salon.jpg").status_code == 200
    d = c.get("/v1/maison/etat").json()
    salon = next(a for a in d["appareils"] if a["id"] == "light.salon")
    assert salon["alexa"] is True and salon["etage"] == "RDC"
    assert next(a for a in d["appareils"] if a["id"] == "lock.entree")["partage_possible"] is False
    assert d["personnes"][0]["nom"] == "Bastien" and d["meteo"]["temperature"] == 12


def test_actions_depuis_la_page(client):
    c, ha = client
    assert c.post("/v1/maison/action", json={"entite": "cover.volet_salon", "action": "fermer"}).json() == {"ok": True}
    assert c.post("/v1/maison/action", json={"entite": "climate.clim", "action": "temperature", "valeur": 21.5}).status_code == 200
    assert c.post("/v1/maison/action", json={"entite": "lock.entree", "action": "basculer"}).status_code == 400
    assert c.post("/v1/maison/action", json={"entite": "cover.garage", "action": "ouvrir"}).status_code == 400
    assert ha.services == [("cover", "close_cover", {"entity_id": "cover.volet_salon"}),
                           ("climate", "set_temperature", {"entity_id": "climate.clim", "temperature": 21.5})]


def test_ponts(client):
    c, ha = client
    assert c.get("/v1/ponts").json()["homekit"]["en_ligne"] is False
    items = c.get("/v1/ponts/etat?pour=alexa").json()["items"]
    assert {i["key"] for i in items} == {"light.salon", "cover.volet_salon", "switch.prise", "scene.soiree"}
    assert c.post("/v1/ponts/commande", json={"key": "scene.soiree", "patch": {"run": True}}).status_code == 200
    assert c.post("/v1/ponts/commande", json={"key": "lock.entree", "patch": {"on": True}, "pour": "homekit"}).status_code == 400
    assert ha.services == [("scene", "turn_on", {"entity_id": "scene.soiree"})]
    c.post("/v1/ponts/statut", json={"commissioned": False, "manual": "3497-011-2332", "qr": "MT:Y.K90AFN00KA0648G00",
                                    "hk": {"pin": "123-45-678", "uri": "X-HM://0023ISYWYABCD", "paired": True, "devices": 4}})
    s = c.get("/v1/ponts").json()
    assert s["alexa"]["en_ligne"] is True and s["alexa"]["code"] == "3497-011-2332" and s["alexa"]["appaire"] is False
    assert s["homekit"]["appaire"] is True and s["homekit"]["code"] == "123-45-678"
    for pour in ("alexa", "homekit"):
        assert c.get(f"/v1/ponts/qr/{pour}.svg").headers["content-type"].startswith("image/svg")
    assert c.put("/v1/ponts/choix", json={"entite": "switch.prise", "pour": "homekit", "visible": False}).json() == {"ok": True}
    assert "switch.prise" not in {i["key"] for i in c.get("/v1/ponts/etat?pour=homekit").json()["items"]}
    assert "switch.prise" in {i["key"] for i in c.get("/v1/ponts/etat?pour=alexa").json()["items"]}
    etat = c.get("/v1/maison/etat").json()["appareils"]
    prise = next(a for a in etat if a["id"] == "switch.prise")
    assert prise["alexa"] is True and prise["homekit"] is False and prise["partage_possible"] is True


def test_musique_et_plex_non_configure(client):
    c, ha = client
    assert len(c.get("/v1/musique/radios").json()) == len(maison.RADIOS)
    assert c.get("/v1/plex").json() == {"configure": False}
    assert c.get("/v1/plex/image?chemin=/library/x").status_code == 404
    assert c.get("/v1/maison/image/light.salon").status_code == 404  # pas de pochette


def test_hors_de_la_maison(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    from app import main

    with TestClient(main.app, client=("8.8.8.8", 50000)) as c:
        main.etat["routeur"] = Routeur(Settings(), FauxHA(), None, None)
        assert c.get("/v1/maison/etat").status_code == 401
        assert c.post("/v1/ponts/commande", json={"key": "scene.soiree", "patch": {"run": True}}).status_code == 401
        assert c.get("/v1/maison/etat", headers={"Authorization": "Bearer secret"}).status_code == 200


def test_plex(monkeypatch):
    """Lecture de l'API Plex (faux serveur) : en cours, à reprendre, ajouts, affiches."""
    import asyncio
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    from app import plex

    vus = []

    class FauxPlex(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            vus.append(self.path)
            if self.headers.get("X-Plex-Token") != "jeton":
                self.send_response(401); self.end_headers(); return
            chemin = self.path.split("?")[0]
            donnees = {
                "/": {"friendlyName": "NAS", "machineIdentifier": "abc"},
                "/status/sessions": {"Metadata": [{"type": "movie", "title": "Dune", "year": 2021, "thumb": "/library/metadata/1/thumb/9",
                                                   "duration": 1000, "viewOffset": 250, "ratingKey": "1",
                                                   "User": {"title": "Bastien"}, "Player": {"title": "Salon", "state": "playing"}}]},
                "/library/onDeck": {"Metadata": [{"type": "episode", "grandparentTitle": "Shogun", "title": "Anjin", "parentIndex": 1,
                                                  "index": 2, "grandparentThumb": "/library/metadata/5/thumb/1", "ratingKey": "7"}]},
                "/library/recentlyAdded": {"Metadata": [{"type": "season", "parentTitle": "Arcane", "title": "Saison 2", "thumb": "/library/metadata/8/thumb/2"}]},
            }.get(chemin)
            if chemin == "/photo/:/transcode":
                self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.end_headers(); self.wfile.write(b"JPG"); return
            corps = json.dumps({"MediaContainer": donnees or {}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(corps)

    srv = HTTPServer(("127.0.0.1", 0), FauxPlex)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        p = plex.Plex(f"http://127.0.0.1:{srv.server_address[1]}", "jeton")
        d = asyncio.run(p.apercu())
        assert d["serveur"] == "NAS"
        assert d["en_cours"][0] | {} == d["en_cours"][0] and d["en_cours"][0]["qui"] == "Bastien" and d["en_cours"][0]["progression"] == 25
        assert d["reprendre"][0]["titre"] == "Shogun" and d["reprendre"][0]["sous_titre"].startswith("S1 · É2")
        assert d["reprendre"][0]["lien"].endswith("%2Flibrary%2Fmetadata%2F7")
        assert d["ajouts"][0]["titre"] == "Arcane"
        assert asyncio.run(p.image("/library/metadata/1/thumb/9")) == (b"JPG", "image/jpeg")
        with pytest.raises(plex.PlexIndisponible):
            asyncio.run(p.image("/../etc/passwd"))
        assert asyncio.run(plex.Plex(p.url, "faux").apercu())["erreur"].startswith("jeton Plex refusé")
    finally:
        srv.shutdown()
