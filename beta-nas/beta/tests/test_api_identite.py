from fastapi.testclient import TestClient

from app.routeur import IDENTIFICATION_REQUISE, Resultat


class FauxRouteur:
    def __init__(self):
        self.appels = []

    async def traiter(self, texte, personne, confiance, identite_possible=False):
        self.appels.append((texte, personne, identite_possible))
        if personne is None and identite_possible:
            return Resultat("Regarde la tablette une seconde.", IDENTIFICATION_REQUISE)
        return Resultat(f"Mails de {personne}", "mails")


def test_aller_retour_identite(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")
    from app import main

    async def transcrire(*args):
        return "lis mes mails"

    monkeypatch.setattr(main, "transcrire", transcrire)
    h = {"Authorization": "Bearer secret"}
    with TestClient(main.app) as client:
        faux = FauxRouteur()
        main.etat["routeur"] = faux
        r = client.post("/v1/commande", headers=h, files={"audio": ("a.wav", b"x")}, data={"sans_voix": "true"}).json()
        assert r["route"] == IDENTIFICATION_REQUISE and r["demande_id"]

        r2 = client.post("/v1/identite", headers=h, json={"demande_id": r["demande_id"], "personne": "bastien",
                                                           "confiance": 0.8, "sans_voix": True}).json()
        assert r2["reponse"] == "Mails de bastien" and r2["texte_reconnu"] == "lis mes mails"
        # Usage unique : la même demande ne peut pas être rejouée
        assert client.post("/v1/identite", headers=h, json={"demande_id": r["demande_id"]}).status_code == 404
        assert faux.appels[1] == ("lis mes mails", "bastien", False)
