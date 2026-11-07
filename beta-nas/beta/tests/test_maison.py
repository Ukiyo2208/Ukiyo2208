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


def test_alexa_choix_et_traduction(tmp_path):
    alexa = maison.Alexa(tmp_path / "alexa.json")
    liste = maison.appareils({"appareils": APPAREILS})
    elements = {e["key"]: e for e in alexa.elements(liste)}
    # Par défaut : lumières, prises, volets, scènes ; jamais la serrure, le garage ni la clim
    assert set(elements) == {"light.salon", "cover.volet_salon", "switch.prise", "scene.soiree"}
    assert elements["light.salon"]["state"] == {"on": True, "bri": 50}
    assert elements["cover.volet_salon"]["state"] == {"pos": 60} and elements["scene.soiree"]["type"] == "button"
    alexa.choix["switch.prise"] = False
    alexa.choix["sensor.temp_salon"] = True
    alexa.choix["lock.entree"] = True  # ignoré : une serrure n'est jamais partagée
    alexa.sauver()
    alexa = maison.Alexa(tmp_path / "alexa.json")
    assert {e["key"] for e in alexa.elements(liste)} == {"light.salon", "cover.volet_salon", "scene.soiree", "sensor.temp_salon"}
    lumiere = next(a for a in liste if a["id"] == "light.salon")
    assert alexa.commande(lumiere, {"on": False}) == ("homeassistant", "turn_off", {"entity_id": "light.salon"})
    assert alexa.commande(lumiere, {"bri": 30})[2]["brightness_pct"] == 30
    volet = next(a for a in liste if a["id"] == "cover.volet_salon")
    assert alexa.commande(volet, {"pos": 20}) == ("cover", "set_cover_position", {"entity_id": "cover.volet_salon", "position": 20})
    with pytest.raises(maison.ActionRefusee):
        alexa.commande(next(a for a in liste if a["id"] == "switch.prise"), {"on": True})  # caché à Alexa


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
        main.etat.pop("alexa", None)
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
    assert next(a for a in d["appareils"] if a["id"] == "lock.entree")["alexa_possible"] is False
    assert d["personnes"][0]["nom"] == "Bastien" and d["meteo"]["temperature"] == 12


def test_actions_depuis_la_page(client):
    c, ha = client
    assert c.post("/v1/maison/action", json={"entite": "cover.volet_salon", "action": "fermer"}).json() == {"ok": True}
    assert c.post("/v1/maison/action", json={"entite": "climate.clim", "action": "temperature", "valeur": 21.5}).status_code == 200
    assert c.post("/v1/maison/action", json={"entite": "lock.entree", "action": "basculer"}).status_code == 400
    assert c.post("/v1/maison/action", json={"entite": "cover.garage", "action": "ouvrir"}).status_code == 400
    assert ha.services == [("cover", "close_cover", {"entity_id": "cover.volet_salon"}),
                           ("climate", "set_temperature", {"entity_id": "climate.clim", "temperature": 21.5})]


def test_pont_alexa(client):
    c, ha = client
    assert c.get("/v1/alexa").json()["en_ligne"] is False
    items = c.get("/v1/alexa/etat").json()["items"]
    assert {i["key"] for i in items} == {"light.salon", "cover.volet_salon", "switch.prise", "scene.soiree"}
    assert c.post("/v1/alexa/commande", json={"key": "scene.soiree", "patch": {"run": True}}).status_code == 200
    assert c.post("/v1/alexa/commande", json={"key": "lock.entree", "patch": {"on": True}}).status_code == 400
    assert ha.services == [("scene", "turn_on", {"entity_id": "scene.soiree"})]
    c.post("/v1/alexa/statut", json={"commissioned": False, "manual": "3497-011-2332", "qr": "MT:Y.K90AFN00KA0648G00"})
    s = c.get("/v1/alexa").json()
    assert s["en_ligne"] is True and s["manual"] == "3497-011-2332"
    assert c.get("/v1/alexa/qr.svg").headers["content-type"].startswith("image/svg")
    assert c.put("/v1/alexa/choix", json={"entite": "switch.prise", "visible": False}).json() == {"ok": True}
    assert "switch.prise" not in {i["key"] for i in c.get("/v1/alexa/etat").json()["items"]}


def test_hors_de_la_maison(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    from app import main

    with TestClient(main.app, client=("8.8.8.8", 50000)) as c:
        main.etat["routeur"] = Routeur(Settings(), FauxHA(), None, None)
        assert c.get("/v1/maison/etat").status_code == 401
        assert c.post("/v1/alexa/commande", json={"key": "scene.soiree", "patch": {"run": True}}).status_code == 401
        assert c.get("/v1/maison/etat", headers={"Authorization": "Bearer secret"}).status_code == 200
