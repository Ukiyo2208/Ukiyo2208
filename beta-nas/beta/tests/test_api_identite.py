from fastapi.testclient import TestClient

from app.routeur import IDENTIFICATION_REQUISE, QUI_REQUIS, Resultat


class FauxRouteur:
    def __init__(self):
        self.appels = []

    async def traiter(self, texte, personne=None, confiance=0.0, *, niveau=None, piece=None, etape="finale"):
        self.appels.append((texte, personne, niveau, piece, etape))
        if personne:
            return Resultat(f"Mails de {personne}", "mails")
        if etape == "initiale":
            return Resultat("Regarde la tablette une seconde.", IDENTIFICATION_REQUISE)
        return Resultat("C'est pour qui ?", QUI_REQUIS)


def test_camera_puis_pour_qui(monkeypatch, tmp_path):
    config = tmp_path / "config.yaml"
    config.write_text("personnes:\n  bastien:\n    role: admin\n")
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(config))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    reponses = iter(["lis mes mails", "c'est pour Bastien"])

    async def transcrire(*args):
        return next(reponses)

    monkeypatch.setattr(main, "transcrire", transcrire)
    h = {"Authorization": "Bearer secret"}
    with TestClient(main.app) as client:
        faux = FauxRouteur()
        main.etat["routeur"] = faux
        wav = {"audio": ("a.wav", b"x")}
        r = client.post("/v1/commande", headers=h, files=wav, data={"sans_voix": "true", "piece": "salon"}).json()
        assert r["route"] == IDENTIFICATION_REQUISE and r["demande_id"]

        # La tablette n'a vu personne
        r2 = client.post("/v1/identite", headers=h, json={"demande_id": r["demande_id"], "sans_voix": True}).json()
        assert r2["route"] == QUI_REQUIS and r2["demande_id"]
        # Usage unique
        assert client.post("/v1/identite", headers=h, json={"demande_id": r["demande_id"]}).status_code == 404

        r3 = client.post("/v1/qui", headers=h, files=wav, data={"demande_id": r2["demande_id"], "sans_voix": "true"})
        assert r3.json()["reponse"] == "Mails de bastien"
        assert faux.appels[-1] == ("lis mes mails", "bastien", "declaration", "salon", "finale")
        assert faux.appels[0][3:] == ("salon", "initiale")
