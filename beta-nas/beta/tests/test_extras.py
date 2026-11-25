"""Alertes, énergie, résumé du matin et commandes vocales en plus."""

from datetime import datetime

from app import alertes, commandes, energie, resume


def _a(eid, etat, nom=None, classe=None, **autres):
    attr = {"device_class": classe} if classe else {}
    attr.update(autres.pop("attr", {}))
    return {"id": eid, "etat": etat, "nom": nom or eid, "attr": attr, **autres}


# ---------------------------------------------------------------- alertes

def test_urgence_une_seule_fois_puis_rearmee():
    s = alertes.Surveillance()
    fuite = [_a("binary_sensor.fuite", "on", "Fuite cuisine", "moisture", piece="Cuisine")]
    premiere = s.verifier(fuite, [], [], maintenant=0)
    assert len(premiere) == 1 and premiere[0].niveau == "urgence" and "Cuisine" in premiere[0].message
    assert s.verifier(fuite, [], [], maintenant=60) == []  # pas de répétition
    s.verifier([_a("binary_sensor.fuite", "off", classe="moisture")], [], [], maintenant=120)
    assert len(s.verifier(fuite, [], [], maintenant=180)) == 1  # réarmée


def test_porte_ouverte_maison_vide_apres_5_minutes():
    s = alertes.Surveillance()
    porte = [_a("binary_sensor.porte", "on", "Porte d'entrée", "door")]
    partis = [{"id": "person.a", "etat": "not_home"}, {"id": "person.b", "etat": "work"}]
    assert s.verifier(porte, [], partis, maintenant=0) == []
    assert s.verifier(porte, [], partis, maintenant=200) == []
    alerte = s.verifier(porte, [], partis, maintenant=301)
    assert len(alerte) == 1 and "Porte d'entrée" in alerte[0].message
    assert s.verifier(porte, [], [{"id": "person.a", "etat": "home"}], maintenant=400) == []


def test_machine_terminee():
    s = alertes.Surveillance()
    g = [{"id": "d_ll", "type": "lave_linge", "principal": "switch.ll", "etat": "sensor.ll_etat", "piece": "Buanderie"}]
    s.verifier([_a("sensor.ll_etat", "run")], g, [], maintenant=0)
    fin = s.verifier([_a("sensor.ll_etat", "finished")], g, [], maintenant=60)
    assert len(fin) == 1 and "lave-linge a terminé" in fin[0].titre
    assert s.verifier([_a("sensor.ll_etat", "finished")], g, [], maintenant=120) == []


def test_batteries_une_fois_par_jour_et_services():
    s = alertes.Surveillance(batterie_faible=15)
    piles = [_a("sensor.porte_batterie", "9", "Porte batterie", "battery"), _a("sensor.autre_batterie", "80", classe="battery")]
    premiere = s.verifier(piles, [], [], maintenant=0)
    assert len(premiere) == 1 and "Porte batterie (9 %)" in premiere[0].message and "autre" not in premiere[0].message
    assert s.verifier(piles, [], [], maintenant=3600) == []
    assert len(s.verifier(piles, [], [], maintenant=24 * 3600 + 1)) == 1

    s = alertes.Surveillance()
    assert s.verifier([], [], [], {"presence": {"ok": False}}, maintenant=0) == []  # jamais vue en ligne : pas installée
    s.verifier([], [], [], {"whisper": {"ok": True}}, maintenant=0)
    assert s.verifier([], [], [], {"whisper": {"ok": False}}, maintenant=60) == []
    panne = s.verifier([], [], [], {"whisper": {"ok": False}}, maintenant=60 + 301)
    assert len(panne) == 1 and "Whisper" in panne[0].message
    retour = s.verifier([], [], [], {"whisper": {"ok": True}}, maintenant=500)
    assert len(retour) == 1 and retour[0].titre == "✅ Service rétabli"


def test_sauvegarde_ratee_ou_trop_vieille():
    s = alertes.Surveillance()
    assert len(s.verifier([], [], [], sauvegarde={"existe": True, "erreur": "disque plein"}, maintenant=0)) == 1
    s = alertes.Surveillance()
    vieille = {"existe": True, "derniere_reussie": 1000, "erreur": ""}
    assert s.verifier([], [], [], sauvegarde=vieille, maintenant=1000 + 3600) == []
    assert len(s.verifier([], [], [], sauvegarde=vieille, maintenant=1000 + 40 * 3600)) == 1
    assert alertes.Surveillance().verifier([], [], [], sauvegarde={"existe": False}, maintenant=0) == []


# ---------------------------------------------------------------- énergie

def test_bilan_energie_compteur_general_et_appareils():
    appareils = [
        _a("sensor.linky_index", "12345", "Linky", "energy", attr={"unit_of_measurement": "kWh"}),
        _a("sensor.prise_lave_linge_energie", "5000", "Lave-linge énergie", "energy", attr={"unit_of_measurement": "Wh"}),
        _a("sensor.linky_puissance", "1500", "Linky puissance", "power", attr={"unit_of_measurement": "W"}),
        _a("sensor.prise_tv_puissance", "80", "Télé puissance", "power", attr={"unit_of_measurement": "W"}),
    ]
    minuit = lambda j: datetime(2026, 11, j).timestamp() * 1000  # noqa: E731 (Home Assistant : millisecondes, heure locale)
    stats = {"sensor.linky_index": [{"start": minuit(24), "change": 10}, {"start": minuit(25), "change": 4}],
             "sensor.prise_lave_linge_energie": [{"start": minuit(25), "change": 1500}]}
    b = energie.bilan(appareils, stats, 0.25, aujourdhui="2026-11-25")
    assert b["compteur_general"] and b["resume"]["aujourdhui"] == {"kwh": 4.0, "euros": 1.0}
    assert b["resume"]["hier"]["kwh"] == 10 and b["resume"]["mois"]["kwh"] == 14
    ll = next(l for l in b["appareils"] if l["id"] == "sensor.prise_lave_linge_energie")
    assert ll["aujourdhui"] == 1.5 and not ll["general"]  # Wh convertis en kWh
    assert b["puissance"]["maintenant"] == 1500 and len(b["jours"]) == 30 and b["jours"][-1]["kwh"] == 4


def test_points_historique_reduits():
    brut = [{"state": str(i), "last_changed": f"t{i}"} for i in range(1000)] + [{"state": "unavailable", "last_changed": "x"}]
    points = energie.points_historique(brut, maximum=100)
    assert len(points) == 100 and points[0][1] == 4.5


# ---------------------------------------------------------------- résumé

def test_resume_du_matin():
    maison = {"meteo": {"etat": "rainy", "temperature": 7.6},
              "appareils": [_a("light.salon", "on", "Salon"), _a("binary_sensor.fenetre", "on", "Fenêtre chambre", "window")]}
    outil = {"weather": None, "fete": "Catherine", "bins": ["🟡 Jaune (recyclage)"], "parcels": 2,
             "events": [{"time": "14:00", "title": "Dentiste"}], "tasks_count": 3}
    r = resume.composer(maison, [], outil, [alertes.Alerte("urgence:x", "t", "Fuite d'eau détectée : Cuisine.")],
                        {"kwh": 8.43, "euros": 2.12}, perso=False, maintenant=datetime(2026, 11, 26, 7, 30))
    t = r["texte"]
    assert t.startswith("Bonjour ! Nous sommes jeudi 26 novembre.") and "8 degrés, pluvieux" in t
    assert "poubelle jaune" in t and "2 colis" in t and "Salon" in t and "Fenêtre chambre" in t
    assert "Fuite d'eau" in t and "8,4 kilowattheures" in t and "Dentiste" not in t  # agenda : seulement si reconnu
    assert "Dentiste" in resume.composer(maison, [], outil, [], None, perso=True, maintenant=datetime(2026, 11, 26, 7))["texte"]


# ---------------------------------------------------------------- commandes vocales

def test_commandes_reconnues():
    r = commandes.reconnaitre
    assert r("Bêta, quoi de neuf ?").type == "resume"
    assert r("combien j'ai consommé aujourd'hui").type == "energie"
    assert (r("lance la tondeuse").domaine, r("lance la tondeuse").action) == ("lawn_mower", "lancer")
    assert r("rentre la tondeuse").action == "base"
    i = r("mets le ballon à 60 degrés")
    assert (i.domaine, i.action, i.valeur) == ("water_heater", "temperature", 60)
    assert r("éteins le chauffe-eau").action == "eteindre"
    assert r("règle le déshumidificateur à 45 %").valeur == 45
    for phrase in ("ajoute du lait à la liste de courses", "rappelle-moi d'appeler le garage demain à 9h",
                   "rendez-vous chez le dentiste mardi à 14h", "qu'est-ce que j'ai demain", "où en sont mes colis"):
        assert r(phrase).type == "beta_tool" and r(phrase).capacite == commandes.PERSO, phrase
    assert r("allume la lumière du salon") is None and r("quelle heure est-il") is None


def test_choix_entite_et_phrase():
    appareils = [_a("water_heater.ballon_garage", "eco", "Ballon garage"), _a("water_heater.ballon_maison", "eco", "Ballon maison")]
    i = commandes.reconnaitre("mets le ballon de la maison à 55")
    assert commandes.choisir_entite(i, appareils, i.texte)["id"] == "water_heater.ballon_maison"
    assert commandes.phrase(i, appareils[1]) == "Je règle Ballon maison à 55 degrés."


# ---------------------------------------------------------------- par l'API

def test_api_resume_energie_et_voix(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app import main
    from app.routeur import Routeur
    from app.settings import Settings

    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_SAUVEGARDES", str(tmp_path / "sauvegardes"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("ALERTES", "non")

    class HA:
        services = []

        async def maison(self, motif_voiture="fordpass"):
            return {"appareils": [_a("lawn_mower.robot", "docked", "Robot tondeuse"), _a("light.salon", "on", "Salon"),
                                  _a("sensor.prise_energie", "3", "Prise énergie", "energy", attr={"unit_of_measurement": "kWh"})],
                    "appareils_ha": {}, "personnes": [], "voiture": [], "domicile": None, "meteo": {"etat": "sunny", "temperature": 21}}

        async def statistiques(self, ids, debut, periode="day"):
            assert ids == ["sensor.prise_energie"]
            return {"sensor.prise_energie": [{"start": datetime.now().timestamp() * 1000, "change": 2}]}

        async def service(self, domaine, service, donnees):
            self.services.append((domaine, service, donnees))

    with TestClient(main.app, client=("192.168.68.20", 50000)) as c:
        ha = HA()
        main.etat["routeur"] = Routeur(Settings(), ha, None, None, extras=main._commandes_beta)
        main._maison_cache["valeur"] = None
        main._energie_cache["valeur"] = None
        e = c.get("/v1/energie").json()
        assert e["resume"]["aujourdhui"]["kwh"] == 2 and e["appareils"][0]["nom"] == "Prise énergie"
        r = c.get("/v1/resume").json()
        assert "21 degrés, ensoleillé" in r["texte"] and "Salon" in r["texte"]
        d = c.post("/v1/texte", json={"texte": "lance la tondeuse"}).json()
        assert d["route"] == "beta" and "Robot tondeuse commence à tondre" in d["reponse"]
        assert ha.services == [("lawn_mower", "start_mowing", {"entity_id": "lawn_mower.robot"})]
        assert "kilowattheures" in c.post("/v1/texte", json={"texte": "combien j'ai consommé ?"}).json()["reponse"]
        assert c.get("/v1/sauvegarde").json() == {"existe": False}
        assert c.get("/v1/alertes").json()["actives"] is False
        assert c.get("/v1/maison/historique/pas une entité").status_code in (400, 404)
