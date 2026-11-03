import asyncio
import importlib
import json

import httpx
from fastapi.testclient import TestClient

from app import stats as st
from app.routeur import Resultat


class FauxRouteur:
    async def traiter(self, texte, personne=None, confiance=0.0, **kwargs):
        return Resultat("Il est 10 h", "conversation:cloud")


def demarrer(monkeypatch, tmp_path, **env):
    valeurs = {
        "BETA_TOKEN": "principal", "BETA_LECTURE_TOKEN": "lecture", "BETA_CONFIG": str(tmp_path / "absent.yaml"),
        "OLLAMA_URL": "http://127.0.0.1:9", "HA_URL": "http://127.0.0.1:9", "PRESENCE_URL": "http://127.0.0.1:9",
        "NAS_DISQUES": "Racine=/", "NAS_NOM": "DXP4800", "BETA_CORS": "https://monsite.fr", **env,
    }
    for k, v in valeurs.items():
        monkeypatch.setenv(k, v)
    from app import main
    return importlib.reload(main)  # le site autorisé (CORS) est lu au chargement


def test_infos_du_nas_en_lecture_seule(monkeypatch, tmp_path):
    main = demarrer(monkeypatch, tmp_path)
    lecture, principal = {"Authorization": "Bearer lecture"}, {"Authorization": "Bearer principal"}
    with TestClient(main.app) as client:
        main.etat["routeur"] = FauxRouteur()
        main.statistiques = st.Statistiques()
        client.post("/v1/texte", headers=principal, json={"texte": "quelle heure est-il, je suis Bastien"})

        assert client.get("/v1/nas").status_code == 401
        d = client.get("/v1/nas", headers=lecture).json()
        assert d["nas"]["nom"] == "DXP4800" and d["nas"]["disques"][0]["nom"] == "Racine"
        assert 0 <= d["nas"]["processeur"]["utilisation_pct"] <= 100 and d["nas"]["memoire"]["total_go"] > 0
        assert d["api"]["appels"] == 1 and d["api"]["traite_par"] == {"conversation:cloud": 1}
        assert d["ia"]["taches"]["comprendre"] == ["rapide"] and d["ia"]["ollama"]["en_ligne"] is False

        # Rien de personnel ni de secret dans ce qui part vers le site
        brut = json.dumps(d)
        for interdit in ("Bastien", "quelle heure", "principal", "lecture", "127.0.0.1"):
            assert interdit not in brut

        # Le jeton de lecture ne pilote rien
        assert client.post("/v1/texte", headers=lecture, json={"texte": "ouvre la porte"}).status_code == 401
        assert client.get("/v1/stats", headers=lecture).status_code == 401
        assert client.get("/v1/nas", headers=principal).status_code == 200

        # Le site autorisé peut lire depuis le navigateur, pas un autre
        ok = client.options("/v1/nas", headers={"Origin": "https://monsite.fr", "Access-Control-Request-Method": "GET",
                                                 "Access-Control-Request-Headers": "authorization"})
        assert ok.headers.get("access-control-allow-origin") == "https://monsite.fr"
        autre = client.get("/v1/nas", headers={**lecture, "Origin": "https://pirate.example"})
        assert "access-control-allow-origin" not in autre.headers


def test_envoi_au_site(monkeypatch, tmp_path):
    recus = []

    def site(requete: httpx.Request):
        recus.append((requete.headers.get("authorization"), json.loads(requete.content)))
        return httpx.Response(200)

    vrai_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: vrai_client(
        *a, **{**k, "transport": httpx.MockTransport(site)}) if "timeout" in k and k.get("timeout") == 15 else vrai_client(*a, **k))
    main = demarrer(monkeypatch, tmp_path, PUBLICATION_URL="https://monsite.fr/api/nas", PUBLICATION_JETON="secret-site",
                    PUBLICATION_INTERVALLE="15")
    with TestClient(main.app):
        for _ in range(50):
            if recus:
                break
            asyncio.run(asyncio.sleep(0.1))
    assert recus and recus[0][0] == "Bearer secret-site" and recus[0][1]["nas"]["nom"] == "DXP4800"
