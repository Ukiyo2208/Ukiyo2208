"""Suggestions sans IA : habitudes du journal et idées selon les appareils ; chacune passe les vérifications."""
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app import suggestions
from app.ia_web import en_yaml, verifier
from app.routeur import Routeur
from app.settings import Settings

LOCAL = datetime.now().astimezone().tzinfo
NOMS = {"light.cuisine": "Lumière cuisine", "cover.volet_salon": "Volet salon", "light.salon": "Lustre"}


def entree(eid, etat, jour, heure, minute, **contexte):
    quand = (datetime(2026, 11, 2, tzinfo=LOCAL) + timedelta(days=jour)).replace(hour=heure, minute=minute)  # 2 nov. = lundi
    return {"entity_id": eid, "state": etat, "when": quand.isoformat(), **contexte}


def journal_type():
    j = []
    for jour in range(14):
        if (datetime(2026, 11, 2) + timedelta(days=jour)).weekday() < 5:  # en semaine, vers 7h05
            j.append(entree("light.cuisine", "on", jour, 7, 2 + jour % 6))
        j.append(entree("light.salon", "on", jour, 3 + jour, 0))  # à des heures au hasard : pas une habitude
        j.append(entree("cover.volet_salon", "closed", jour, 21, 30, context_domain="automation"))  # déjà automatique
    return j


def test_habitude_reperee():
    h = suggestions.habitudes(journal_type(), NOMS)
    assert len(h) == 1
    s = h[0]
    assert s["titre"] == "Allumer Lumière cuisine à 7h05 en semaine" and "10 jours sur les 14" in s["pourquoi"]
    assert s["config"]["triggers"] == [{"trigger": "time", "at": "07:05:00"}]
    assert s["config"]["conditions"][0]["weekday"] == ["mon", "tue", "wed", "thu", "fri"]


APPAREILS = [
    {"id": "cover.volet_salon", "nom": "Volet salon", "piece": "Salon", "piece_id": "salon", "attr": {}},
    {"id": "cover.garage", "nom": "Garage", "piece": "Garage", "piece_id": "garage", "attr": {"device_class": "garage"}},
    {"id": "light.salon", "nom": "Lustre", "piece": "Salon", "piece_id": "salon", "attr": {}},
    {"id": "binary_sensor.salon_mouvement", "nom": "Mouvement", "piece": "Salon", "piece_id": "salon", "attr": {"device_class": "motion"}},
    {"id": "binary_sensor.fenetre_salon", "nom": "Fenêtre", "piece": "Salon", "piece_id": "salon", "attr": {"device_class": "window"}},
    {"id": "climate.salon", "nom": "Clim", "piece": "Salon", "piece_id": "salon", "attr": {}},
    {"id": "sensor.temperature_salon", "nom": "Température", "piece": "Salon", "piece_id": "salon", "attr": {"device_class": "temperature"}},
]
PERSONNES = [{"id": "person.bastien", "nom": "Bastien"}, {"id": "person.sarah", "nom": "Sarah"}]
EXPOSES = ["light", "switch", "cover", "climate", "binary_sensor", "sensor"]


def test_idees_selon_les_appareils_et_toutes_valides():
    idees = suggestions.idees(APPAREILS, PERSONNES)
    titres = {i["titre"] for i in idees}
    assert {"Fermer les volets au coucher du soleil", "Éteindre la lumière du Salon sans mouvement depuis 10 min",
            "Couper la clim du Salon si une fenêtre reste ouverte", "Fermer les volets du Salon quand il fait plus de 27 °C",
            "Tout éteindre quand tout le monde est parti"} <= titres
    assert "cover.garage" not in str(idees)  # jamais la porte de garage
    reels = {a["id"]: a["id"] for a in APPAREILS} | {p["id"]: p["id"] for p in PERSONNES}
    for i in idees + suggestions.habitudes(journal_type(), NOMS):
        verifier(en_yaml(i["config"]), reels | {k: k for k in NOMS}, EXPOSES)  # aucune n'est refusée


def test_la_nuit_s_ecrit_avec_un_ou():
    nuit = next(i for i in suggestions.idees(APPAREILS, PERSONNES) if "la nuit" in i["titre"])
    assert nuit["config"]["conditions"][0]["condition"] == "or"  # « après le coucher OU avant le lever »


class FauxHA:
    async def maison(self, motif_voiture="fordpass"):
        cuisine = {"id": "light.cuisine", "nom": "Lumière cuisine", "piece": "Cuisine", "piece_id": "cuisine", "attr": {}}
        return {"appareils": [*APPAREILS, cuisine], "personnes": PERSONNES, "appareils_ha": {}, "voiture": []}

    async def journal(self, jours):
        return journal_type()

    async def automatisations(self):
        return [{"entite": "automation.x", "nom": "Fermer les volets au coucher du soleil", "active": True, "derniere": None, "id": "1"}]


def test_api_suggestions(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    with TestClient(main.app, client=("192.168.68.20", 50000)) as c:
        main.etat["routeur"] = Routeur(Settings(), FauxHA(), None, None)
        main._maison_cache["valeur"] = None
        d = c.get("/v1/automatisations/suggestions?fraiches=true").json()
    titres = [x["titre"] for x in d["suggestions"]]
    assert d["journal"] is True and titres[0] == "Allumer Lumière cuisine à 7h05 en semaine"  # tes habitudes d'abord
    assert "Fermer les volets au coucher du soleil" not in titres  # déjà créée
    assert all(x["yaml"].startswith("alias:") for x in d["suggestions"])
