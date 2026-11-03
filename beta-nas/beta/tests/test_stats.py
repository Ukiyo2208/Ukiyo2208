from fastapi.testclient import TestClient

from app import stats as st
from app.routeur import Resultat


class FauxRouteur:
    async def traiter(self, texte, personne=None, confiance=0.0, **kwargs):
        return Resultat("Lumière allumée", "home_assistant")


def test_statistiques_en_temps_reel(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("HA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("PRESENCE_URL", "http://127.0.0.1:9")
    from app import main

    h = {"Authorization": "Bearer secret"}
    with TestClient(main.app) as client:
        main.etat["routeur"] = FauxRouteur()
        main.statistiques = st.Statistiques()  # repartir de zéro (d'autres tests utilisent la même app)
        assert client.get("/v1/stats").status_code == 401
        client.post("/v1/texte", headers=h, json={"texte": "allume le salon"})
        client.post("/v1/texte", json={"texte": "sans jeton"})

        d = client.get("/v1/stats", headers=h).json()
        assert d["points"]["POST /v1/texte"]["appels"] == 2
        assert d["points"]["POST /v1/texte"]["erreurs"] == 1
        assert d["routes"] == {"home_assistant": 1}
        derniere_ok = d["dernieres"][1]
        assert derniere_ok["route"] == "home_assistant" and derniere_ok["texte"] == "allume le salon"
        assert d["services"]["ollama"]["ok"] is False and "ia_web" in d["services"]

        texte = client.get("/v1/stats?format=texte", headers=h).text
        assert "POST /v1/texte" in texte and "allume le salon" in texte
        assert "Tableau de bord" in client.get("/tableau").text
