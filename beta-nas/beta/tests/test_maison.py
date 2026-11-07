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
    {"id": "switch.prise", "nom": "Prise", "etat": "off", "piece": "Bureau", "piece_id": "bureau", "etage": "Étage 1", "attr": {"device_class": "outlet"}},
    {"id": "switch.enfant", "nom": "Verrouillage enfant", "etat": "off", "piece": "Bureau", "piece_id": "bureau", "etage": "Étage 1", "attr": {}},
    {"id": "scene.soiree", "nom": "Soirée", "etat": "unknown", "piece": "", "piece_id": "", "etage": "", "attr": {}},
    {"id": "climate.clim", "nom": "Clim", "etat": "cool", "piece": "Salon", "piece_id": "salon", "etage": "RDC", "attr": {"temperature": 22}},
]


VOITURE = [
    {"id": "sensor.fordpass_fuel", "nom": "Explorer Fuel", "etat": "63", "unite": "%"},
    {"id": "sensor.fordpass_elveh", "nom": "Explorer Range", "etat": "512", "unite": "km"},  # « range » dans le nom
    {"id": "sensor.fordpass_odometer", "nom": "Explorer Odometer", "etat": "24312", "unite": "km"},
    {"id": "sensor.fordpass_battery", "nom": "Explorer Battery", "etat": "12.4", "unite": "V"},
    {"id": "lock.fordpass_doorlock", "nom": "Explorer Doorlock", "etat": "unlocked"},
    {"id": "switch.fordpass_ignition", "nom": "Explorer Ignition", "etat": "off"},
    {"id": "device_tracker.fordpass_tracker", "nom": "Explorer Tracker", "etat": "not_home", "lat": 48.7, "lon": 7.9},
]


class FauxHA:
    def __init__(self):
        self.services = []

    async def maison(self, motif_voiture="fordpass"):
        self.motif = motif_voiture
        return {"appareils": [dict(a) for a in APPAREILS],
                "personnes": [{"id": "person.bastien", "nom": "Bastien", "etat": "not_home", "lat": 48.6, "lon": 7.8}],
                "voiture": [dict(v) for v in VOITURE], "domicile": {"lat": 48.58, "lon": 7.75},
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


def test_voiture_reconnue():
    v = maison.voiture(VOITURE, "Explorer")
    c = v["champs"]
    assert c["carburant"]["etat"] == "63" and c["kilometrage"]["etat"] == "24312" and c["batterie12v"]["unite"] == "V"
    assert c["verrou"]["id"] == "lock.fordpass_doorlock" and c["demarrage"]["id"] == "switch.fordpass_ignition"
    assert c["position"]["lat"] == 48.7
    assert "batterie" not in c  # 512 km n'est pas un pourcentage de batterie
    assert maison.voiture([{"id": "sensor.fordpass_soc", "nom": "SOC", "etat": "81", "unite": "%"}])["champs"]["batterie"]["etat"] == "81"
    assert maison.voiture([], "Explorer") is None  # pas encore de FordPass : pas de tuile
    assert maison.commande_voiture(v, "verrouiller") == ("lock", "lock", {"entity_id": "lock.fordpass_doorlock"})
    assert maison.commande_voiture(v, "demarrer") == ("switch", "turn_on", {"entity_id": "switch.fordpass_ignition"})
    for action in ("deverrouiller", "actualiser"):  # jamais déverrouiller ; pas de bouton « actualiser » ici
        with pytest.raises(maison.ActionRefusee):
            maison.commande_voiture(v, action)


def test_voiture_et_famille_dans_la_page(client):
    c, ha = client
    d = c.get("/v1/maison/etat").json()
    assert d["voiture"]["champs"]["carburant"]["etat"] == "63" and d["domicile"] == {"lat": 48.58, "lon": 7.75}
    assert d["personnes"][0]["lat"] == 48.6 and ha.motif == "fordpass"
    assert not any("fordpass" in a["id"] for a in d["appareils"])
    assert c.post("/v1/maison/voiture", json={"action": "verrouiller"}).status_code == 200
    assert c.post("/v1/maison/voiture", json={"action": "deverrouiller"}).status_code == 400
    assert ha.services == [("lock", "lock", {"entity_id": "lock.fordpass_doorlock"})]
    assert c.get("/static/home/leaflet/leaflet.js").status_code == 200


ETATS_HA = [
    {"entity_id": "light.salon", "state": "on", "attributes": {"friendly_name": "Lustre", "brightness": 200}},
    {"entity_id": "switch.lampe_led_indicateur", "state": "on", "attributes": {"friendly_name": "Indicateur LED"}},
    {"entity_id": "switch.cachee", "state": "on", "attributes": {}},
    {"entity_id": "switch.prise_bureau", "state": "off", "attributes": {"friendly_name": "Prise"}},
    {"entity_id": "person.bastien", "state": "home", "attributes": {"friendly_name": "Bastien", "latitude": 48.5, "longitude": 7.7}},
    {"entity_id": "sensor.fordpass_fuel", "state": "50", "attributes": {"unit_of_measurement": "%"}},
    {"entity_id": "zone.home", "state": "1", "attributes": {"latitude": 48.5, "longitude": 7.7}},
    {"entity_id": "automation.x", "state": "on", "attributes": {}},
]


def _maison(reponse_modele, registre=None):
    import asyncio

    import httpx

    from app.homeassistant import HomeAssistant

    def reponse(requete):
        if requete.url.path == "/api/template":
            return reponse_modele(requete)
        return httpx.Response(200, json=ETATS_HA)

    async def lancer():
        ha = HomeAssistant("http://ha", "jeton", "conversation.home_assistant")
        ha._client = httpx.AsyncClient(base_url="http://ha", transport=httpx.MockTransport(reponse))

        async def faux_registre():
            if registre is None:
                raise OSError("pas de WebSocket")
            return registre
        ha._lire_registre = faux_registre
        try:
            return await ha.maison()
        finally:
            await ha.fermer()

    return asyncio.run(lancer())


def test_pieces_etages_et_entites_techniques():
    import httpx

    pieces = [["salon", "Salon", "RDC", ["light.salon", "switch.lampe_led_indicateur"]], ["bureau", "Bureau", "", ["switch.prise_bureau"]]]
    registre = {"switch.lampe_led_indicateur": {"ei": "switch.lampe_led_indicateur", "ec": 0},
                "switch.cachee": {"ei": "switch.cachee", "hb": True}, "light.salon": {"ei": "light.salon"}}
    d = _maison(lambda r: httpx.Response(200, text=__import__("json").dumps(pieces)), registre)
    par_id = {a["id"]: a for a in d["appareils"]}
    assert set(par_id) == {"light.salon", "switch.prise_bureau"}  # réglage et entité cachée retirés
    assert par_id["light.salon"]["piece"] == "Salon" and par_id["light.salon"]["etage"] == "RDC"
    assert par_id["switch.prise_bureau"]["piece_id"] == "bureau" and d["avertissement"] == ""
    assert d["voiture"][0]["id"] == "sensor.fordpass_fuel" and d["domicile"]["lat"] == 48.5


@pytest.mark.parametrize("code", [401, 400])
def test_plan_b_sans_pieces(code):
    """Home Assistant refuse le modèle des pièces : la page s'affiche quand même, sans les pièces."""
    import httpx

    d = _maison(lambda r: httpx.Response(code, text="Error rendering template"))  # pas de WebSocket non plus
    assert {a["id"] for a in d["appareils"]} == {"light.salon", "switch.lampe_led_indicateur", "switch.cachee", "switch.prise_bureau"}
    assert all(a["piece"] == "" for a in d["appareils"]) and d["personnes"][0]["lat"] == 48.5
    assert ("administrateur" in d["avertissement"]) == (code == 401)


# ---------------------------------------------------------------- tuiles par appareil

ENTITES_APPAREILS = [
    {"id": "switch.lave_linge", "nom": "Lave-linge", "etat": "on", "appareil": "d_ll", "piece_id": "buanderie", "piece": "Buanderie", "etage": "RDC", "attr": {}},
    {"id": "sensor.lave_linge_etat", "nom": "Lave-linge État", "etat": "run", "appareil": "d_ll", "attr": {}},
    {"id": "sensor.lave_linge_temps_restant", "nom": "Lave-linge Temps restant", "etat": "42", "appareil": "d_ll", "attr": {"unit_of_measurement": "min"}},
    {"id": "sensor.lave_linge_progression", "nom": "Lave-linge Progression", "etat": "60", "appareil": "d_ll", "attr": {"unit_of_measurement": "%"}},
    {"id": "media_player.tv_salon", "nom": "TV", "etat": "on", "appareil": "d_tv", "piece_id": "salon", "attr": {"source_list": ["HDMI 1", "Netflix"]}},
    {"id": "camera.jardin", "nom": "Jardin", "etat": "idle", "appareil": "d_cam", "attr": {}},
    {"id": "binary_sensor.jardin_mouvement", "nom": "Jardin Mouvement", "etat": "off", "appareil": "d_cam", "attr": {"device_class": "motion"}},
    {"id": "cover.volet_salon", "nom": "Volet salon", "etat": "open", "appareil": "d_volet", "attr": {"current_position": 100}},
    {"id": "button.volet_salon_my_position", "nom": "Volet salon My position", "etat": "unknown", "appareil": "d_volet", "attr": {}},
    {"id": "cover.volet_chambre", "nom": "Volet chambre", "etat": "open", "attr": {"current_position": 30}},
    {"id": "sensor.telephone_batterie", "nom": "Téléphone Batterie", "etat": "80", "appareil": "d_tel", "attr": {"device_class": "battery"}},
    {"id": "light.lampe", "nom": "Lampe", "etat": "off", "attr": {}},
]
APPAREILS_HA = {"d_ll": {"nom": "Lave-linge", "fabricant": "Bosch", "modele": "Serie 8"},
                "d_tv": {"nom": "Télé du salon", "fabricant": "LG", "modele": "OLED55 webOS"},
                "d_cam": {"nom": "Caméra jardin", "fabricant": "Reolink", "modele": "RLC-810A"},
                "d_volet": {"nom": "Volet salon", "fabricant": "Somfy", "modele": "Oximo io"},
                "d_tel": {"nom": "iPhone", "fabricant": "Apple", "modele": "iPhone 15"}}


def test_une_tuile_par_appareil():
    g = {x["id"]: x for x in maison.groupes(ENTITES_APPAREILS, APPAREILS_HA)}
    assert "d_tel" not in g  # un téléphone (que des capteurs) ne fait pas de tuile
    ll = g["d_ll"]
    assert ll["type"] == "lave_linge" and ll["principal"] == "switch.lave_linge" and ll["piece"] == "Buanderie"
    assert ll["etat"] == "sensor.lave_linge_etat" and ll["restant"] == "sensor.lave_linge_temps_restant"
    assert ll["progression"] == "sensor.lave_linge_progression" and len(ll["entites"]) == 4
    assert g["d_tv"]["type"] == "tele" and g["d_cam"]["type"] == "camera" and g["d_cam"]["principal"] == "camera.jardin"
    assert g["d_volet"]["type"] == "volet" and g["d_volet"]["ma_position"] == "button.volet_salon_my_position"
    assert g["cover.volet_chambre"]["type"] == "volet" and "ma_position" not in g["cover.volet_chambre"]
    assert g["light.lampe"]["type"] == "lumiere" and g["light.lampe"]["nom"] == "Lampe"


def test_ma_position(tmp_path):
    favoris = maison.Favoris(tmp_path / "ma_position.json")
    groupes = {x["id"]: x for x in maison.groupes(ENTITES_APPAREILS, APPAREILS_HA)}
    assert maison.commande_ma_position("cover.volet_salon", groupes["d_volet"], favoris) == (
        "button", "press", {"entity_id": "button.volet_salon_my_position"})  # le bouton « My » de Somfy
    assert maison.commande_ma_position("cover.volet_chambre", groupes["cover.volet_chambre"], favoris)[2]["position"] == 50
    favoris.enregistrer("cover.volet_chambre", 35)
    assert maison.Favoris(tmp_path / "ma_position.json").positions == {"cover.volet_chambre": 35}


def test_actions_des_sous_menus():
    clim = {"hvac_modes": ["off", "cool", "heat"], "fan_modes": ["auto", "low"]}
    assert maison.commande_page("climate.clim", "mode", None, clim, "heat") == ("climate", "set_hvac_mode", {"entity_id": "climate.clim", "hvac_mode": "heat"})
    assert maison.commande_page("media_player.tv", "source", None, {"source_list": ["HDMI 1"]}, "HDMI 1")[2]["source"] == "HDMI 1"
    assert maison.commande_page("light.l", "temperature_couleur", 9000, {"max_color_temp_kelvin": 6500})[2]["color_temp_kelvin"] == 6500
    assert maison.commande_page("light.l", "couleur", 220, {})[2]["hs_color"] == [220.0, 100]
    assert maison.commande_page("number.temp_eau", "valeur", 99, {"min": 30, "max": 60})[2]["value"] == 60.0
    assert maison.commande_page("select.programme", "choisir", None, {"options": ["Coton", "Rapide"]}, "Rapide")[1] == "select_option"
    assert maison.commande_page("button.depart", "appuyer", None, {}) == ("button", "press", {"entity_id": "button.depart"})
    for entite, action, attr, option in (("climate.clim", "mode", clim, "turbo"), ("select.p", "choisir", {"options": ["A"]}, "Z"),
                                         ("lock.porte", "basculer", {}, None)):
        with pytest.raises(maison.ActionRefusee):
            maison.commande_page(entite, action, None, attr, option)


class FauxHAAppareils(FauxHA):
    async def maison(self, motif_voiture="fordpass"):
        return {"appareils": [dict(a) for a in ENTITES_APPAREILS], "appareils_ha": APPAREILS_HA, "personnes": [], "voiture": [],
                "domicile": None, "meteo": None}

    async def attributs(self, entite):
        return next(a["attr"] for a in ENTITES_APPAREILS if a["id"] == entite)

    async def image(self, chemin):
        self.image_demandee = chemin
        return b"JPEG", "image/jpeg"


def test_page_par_appareil(client):
    c, _ = client
    from app import main

    ha = FauxHAAppareils()
    main.etat["routeur"] = Routeur(Settings(), ha, None, None)
    d = c.get("/v1/maison/etat").json()
    assert {g["type"] for g in d["groupes"]} >= {"lave_linge", "tele", "camera", "volet", "lumiere"}
    assert "sensor.lave_linge_temps_restant" in {a["id"] for a in d["appareils"]}
    assert "sensor.telephone_batterie" not in {a["id"] for a in d["appareils"]}
    assert c.post("/v1/maison/action", json={"entite": "cover.volet_salon", "action": "ma_position"}).status_code == 200
    assert c.post("/v1/maison/action", json={"entite": "cover.volet_chambre", "action": "enregistrer_ma_position"}).json()["position"] == 30
    assert c.post("/v1/maison/action", json={"entite": "cover.volet_chambre", "action": "ma_position"}).status_code == 200
    assert c.post("/v1/maison/action", json={"entite": "media_player.tv_salon", "action": "source", "option": "Netflix"}).status_code == 200
    assert c.post("/v1/maison/action", json={"entite": "light.lampe", "action": "ma_position"}).status_code == 400
    assert ha.services == [("button", "press", {"entity_id": "button.volet_salon_my_position"}),
                           ("cover", "set_cover_position", {"entity_id": "cover.volet_chambre", "position": 30}),
                           ("media_player", "select_source", {"entity_id": "media_player.tv_salon", "source": "Netflix"})]
    r = c.get("/v1/maison/camera/camera.jardin")
    assert r.content == b"JPEG" and ha.image_demandee == "/api/camera_proxy/camera.jardin"
    assert c.get("/v1/maison/camera/light.lampe").status_code == 404
