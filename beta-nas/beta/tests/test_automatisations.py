"""Automatisations depuis la page : l'IA (locale si besoin) écrit, Bêta vérifie, tu relis puis tu crées."""
import pytest
from fastapi.testclient import TestClient

from app import ia
from app.homeassistant import Appareil
from app.ia_web import ErreurAutomatisation, anonymiser, en_yaml, verifier
from app.routeur import Routeur
from app.settings import Settings, _charger_ia

APPAREILS = [Appareil("cover.volet_salon", "cover", "Volet salon", "Salon"),
             Appareil("light.cuisine", "light", "Lumière cuisine", "Cuisine"),
             Appareil("lock.porte", "lock", "Porte d'entrée", "Entrée")]
DOMAINES = ["cover", "light", "lock"]


def test_le_modele_local_ecrit_les_automatisations_sans_cloud(monkeypatch):
    monkeypatch.delenv("PUISSANT_URL", raising=False)
    monkeypatch.setenv("TRI_MODELE", "qwen3.5:9b")
    s = Settings(anthropic_api_key="")
    noms = [m.nom for m in _charger_ia(s, {}).candidats(ia.AUTOMATISATIONS)]
    assert noms == ["local"]  # ni clé cloud ni PC puissant : le modèle du tri, sur le NAS
    s.anthropic_api_key = "cle"
    assert [m.nom for m in _charger_ia(s, {}).candidats(ia.AUTOMATISATIONS)][0] == "cloud"


def test_jamais_ouvrir_une_serrure():
    table = anonymiser(APPAREILS, False)[1]
    for action in ("lock.unlock", "lock.open"):
        with pytest.raises(ErreurAutomatisation, match="sécurité"):
            verifier(f"triggers:\n  - trigger: time\n    at: '23:00:00'\nactions:\n  - action: {action}\n    target:\n      entity_id: lock.appareil_1",
                     table, DOMAINES)
    config = verifier("triggers:\n  - trigger: time\n    at: '23:00:00'\nactions:\n  - action: lock.lock\n    target:\n      entity_id: lock.appareil_1",
                      table, DOMAINES)  # verrouiller, oui
    assert config["actions"][0]["target"]["entity_id"] == "lock.porte"


def test_yaml_dans_l_ordre_de_home_assistant():
    texte = en_yaml({"id": "x", "actions": [{"action": "light.turn_on"}], "alias": "Soir", "triggers": [{"trigger": "sun", "event": "sunset"}]})
    assert texte.index("alias") < texte.index("triggers") < texte.index("actions") and "id:" not in texte


class FausseIA:
    def disponible(self, tache):
        return True

    def candidats(self, tache):
        return [ia.Modele("local", "ollama", "qwen3.5:9b", url="http://x")]

    async def demander_json(self, tache, systeme, message, schema, **kw):
        self.message = message
        assert "Exemples de YAML valides" in systeme  # le modèle local a des exemples
        return {"possible": True, "resume": "Au coucher du soleil, je ferme le volet du salon.",
                "yaml": "triggers:\n  - trigger: sun\n    event: sunset\nactions:\n  - action: cover.close_cover\n    target:\n      entity_id: cover.appareil_1"}, "local"


class FauxHA:
    def __init__(self):
        self.creees, self.supprimees, self.services = [], [], []

    async def appareils(self, domaines):
        return APPAREILS

    async def automatisations(self):
        return [{"entite": "automation.volets", "nom": "Volets", "active": True, "derniere": None, "id": "beta_0123456789ab"},
                {"entite": "automation.alarme", "nom": "Alarme", "active": False, "derniere": None, "id": "1690000000"}]

    async def creer_automatisation(self, identifiant, config):
        self.creees.append((identifiant, config))

    async def supprimer_automatisation(self, identifiant):
        self.supprimees.append(identifiant)

    async def service(self, domaine, service, donnees):
        self.services.append((domaine, service, donnees))


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("BETA_DONNEES", str(tmp_path / "donnees"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    with TestClient(main.app, client=("192.168.68.20", 50000)) as c:
        ha, fausse_ia = FauxHA(), FausseIA()
        main.etat["routeur"] = Routeur(Settings(), ha, None, fausse_ia)
        yield c, ha, fausse_ia


def test_proposer_relire_creer(client):
    c, ha, fausse_ia = client
    p = c.post("/v1/automatisations/proposer", json={"texte": "Au coucher du soleil, ferme le volet du salon"}).json()
    assert p["possible"] and p["modele"] == "local" and "cover.volet_salon" in p["yaml"]  # vrais identifiants pour relire
    assert "cover.volet_salon" not in fausse_ia.message  # l'IA n'a vu que des alias
    # Tu modifies le YAML (ajout d'une lumière), puis tu crées
    import yaml
    contenu = yaml.safe_load(p["yaml"])
    contenu["actions"].append({"action": "light.turn_on", "target": {"entity_id": "light.cuisine"}})
    modifie = yaml.safe_dump(contenu, allow_unicode=True)
    r = c.post("/v1/automatisations", json={"yaml": modifie})
    assert r.status_code == 200, r.text
    identifiant, config = ha.creees[0]
    assert identifiant.startswith("beta_") and config["id"] == identifiant and len(config["actions"]) == 2


@pytest.mark.parametrize("yaml_texte, motif", [
    ("triggers:\n  - trigger: time\n    at: '08:00:00'\nactions:\n  - action: light.turn_on\n    target:\n      entity_id: light.inconnue", "inconnu"),
    ("triggers:\n  - trigger: time\n    at: '08:00:00'\nactions:\n  - action: lock.unlock\n    target:\n      entity_id: lock.porte", "sécurité"),
    ("triggers:\n  - trigger: time\n    at: '08:00:00'\nactions:\n  - action: shell_command.x", "non autorisée"),
    ("actions:\n  - action: light.turn_on", "déclencheur"),
    ("triggers: [", "YAML invalide"),
])
def test_creation_refusee(client, yaml_texte, motif):
    c, ha, _ = client
    r = c.post("/v1/automatisations", json={"yaml": yaml_texte})
    assert r.status_code == 422 and motif in r.json()["detail"] and ha.creees == []


def test_liste_activer_supprimer(client):
    c, ha, _ = client
    d = c.get("/v1/automatisations").json()
    assert [(a["nom"], a["beta"]) for a in d["automatisations"]] == [("Alarme", False), ("Volets", True)]
    assert d["ia"] == ["local (qwen3.5:9b)"]
    assert c.post("/v1/automatisations/action", json={"entite": "automation.alarme", "action": "activer"}).status_code == 200
    assert c.post("/v1/automatisations/action", json={"entite": "light.cuisine", "action": "activer"}).status_code == 400
    assert c.delete("/v1/automatisations/beta_0123456789ab").status_code == 200
    assert c.delete("/v1/automatisations/1690000000").status_code == 403  # les tiennes restent
    assert ha.services == [("automation", "turn_on", {"entity_id": "automation.alarme"})] and ha.supprimees == ["beta_0123456789ab"]


def _exemples_de_la_consigne():
    from app.ia_web import _CONSIGNE
    texte = _CONSIGNE.split("Exemples de YAML valides :\n", 1)[1].split("\n\nRègles pour", 1)[0]
    return texte.split("\n\n")


def test_les_exemples_donnes_a_l_ia_passent_nos_verifications():
    """Sinon l'IA apprendrait à écrire ce que Bêta refuse."""
    exemples = _exemples_de_la_consigne()
    assert len(exemples) == 5 and any("choose" in x for x in exemples)
    table = {f"{d}.appareil_{i}": f"{d}.vrai_{i}" for d in ("cover", "light", "binary_sensor", "sensor", "person") for i in (1, 2, 3)}
    for exemple in exemples:
        config = verifier(exemple, table, ["cover", "light", "binary_sensor", "sensor"])
        assert "appareil_" not in str(config), exemple  # tous les alias remplacés par les vrais identifiants


def test_saisons_avec_choose():
    config = verifier(_exemples_de_la_consigne()[3], {"sensor.appareil_3": "sensor.season", "cover.appareil_1": "cover.volet_salon"},
                      ["cover", "sensor"])
    branches = config["actions"][0]["choose"]
    assert [b["conditions"][1]["state"] for b in branches] == [["autumn", "winter"], ["spring", "summer"]]
    assert [t["at"] for t in config["triggers"]] == ["17:30:00", "21:30:00"]


def test_l_ia_recoit_les_appareils_utiles_d_abord():
    from app.ia_web import choisir_appareils
    bruit = [Appareil(f"sensor.telephone_{i}", "sensor", f"Téléphone capteur {i}", "") for i in range(400)]
    utiles = [Appareil("cover.volet_salon", "cover", "Volet salon", "Salon"), Appareil("sensor.season", "sensor", "Season", ""),
              Appareil("person.bastien", "person", "Bastien", "")]
    choisis = choisir_appareils("En hiver, ferme les volets du salon à 17h30", bruit + utiles, maximum=50)
    assert len(choisis) == 50 and {a.entity_id for a in utiles} <= {a.entity_id for a in choisis}
    assert choisis[0].entity_id == "cover.volet_salon"


def test_la_saison_est_indiquee_a_l_ia(client):
    c, ha, fausse_ia = client
    saison = Appareil("sensor.season", "sensor", "Season", "")
    ha.appareils = lambda domaines: _async([*APPAREILS, saison])
    c.post("/v1/automatisations/proposer", json={"texte": "En hiver, ferme le volet du salon à 17h30"})
    assert "Capteur de saison : sensor.appareil_1" in fausse_ia.message
    assert c.get("/v1/automatisations").json()["saison"] is True


async def _valeur(v):
    return v


def _async(v):
    return _valeur(v)
