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
