import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trieur  # noqa: E402
import web  # noqa: E402


@pytest.fixture
def site(tmp_path):
    c = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", "volume1")
    for d in ("Banque/2025", "Banque/2026", "Factures", "Photos", "@recycle", "@home/bastien", "Docker/x"):
        (c.rangement / d).mkdir(parents=True)
    (c.rangement / "Banque/2026/releve.pdf").write_text("x")
    (c.rangement / "Photos/note.txt").write_text("x")
    c.creer()
    srv = web.serveur(c, 0, hote="127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield c, f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def appel(url, chemin, corps=None):
    requete = urllib.request.Request(url + chemin, data=json.dumps(corps).encode() if corps is not None else None,
                                     method="POST" if corps is not None else "GET")
    with urllib.request.urlopen(requete) as r:
        return json.loads(r.read())


def test_page(site):
    c, url = site
    page = urllib.request.urlopen(url + "/").read()
    assert b"Tri des documents" in page and b'"/api/' not in page  # chemins relatifs : servie sous /tri/


def test_arbre_des_dossiers(site):
    c, url = site
    racine = appel(url, "/api/dossiers")
    assert [d["nom"] for d in racine] == ["volume1"]
    volume = appel(url, "/api/dossiers?chemin=volume1")
    assert [d["nom"] for d in volume] == ["@home", "Banque", "Docker", "Factures", "Photos"]  # pas @recycle
    assert [d["exclu"] for d in volume] == [False, False, True, False, False]  # Docker exclu par défaut
    assert volume[1]["a_des_sous_dossiers"] is True
    assert [d["chemin"] for d in appel(url, "/api/dossiers?chemin=volume1/Banque")] == ["volume1/Banque/2025", "volume1/Banque/2026"]


def test_decocher_un_dossier(site):
    c, url = site
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert appel(url, "/api/etat")["en_attente"] == 2
    etat = appel(url, "/api/reglages", {"tout_trier": True, "exclusions": ["volume1/Photos", "*.mp4"]})
    assert etat["exclusions"] == ["volume1/Photos", "*.mp4"] and etat["en_attente"] == 1
    assert "# Ce que tu ne veux PAS trier" in c.exclure.read_text()  # commentaires conservés
    assert appel(url, "/api/dossiers?chemin=volume1")[4]["exclu"] is True


def test_reproposer_un_document_garde(site):
    c, url = site
    c.gardes.write_text("volume1/Banque/2026/releve.pdf\n")
    assert appel(url, "/api/etat")["gardes"] == ["volume1/Banque/2026/releve.pdf"]
    assert appel(url, "/api/reglages", {"reproposer": ["volume1/Banque/2026/releve.pdf"]})["gardes"] == []


@pytest.mark.parametrize("chemin", ["../../etc", "Banque/../../x"])
def test_chemins_dangereux_refuses(site, chemin):
    c, url = site
    with pytest.raises(urllib.error.HTTPError) as e:
        appel(url, "/api/reglages", {"exclusions": [chemin]})
    assert e.value.code == 400
    with pytest.raises(urllib.error.HTTPError):
        appel(url, f"/api/dossiers?chemin={chemin}")


def test_tout_traiter_et_arreter_depuis_la_page(tmp_path):
    import proposeur

    c = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", "volume1")
    c.rangement.mkdir(parents=True)
    c.creer()
    p = proposeur.Proposeur(c)
    srv = web.serveur(c, 0, p, hote="127.0.0.1")
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        assert appel(url, "/api/lancer", {"tout": True})["proposeur"]["continu"] is True
        etat = appel(url, "/api/arreter", {})
        assert etat["proposeur"]["continu"] is False and etat["notifications"] == []
        with pytest.raises(urllib.error.HTTPError) as e:  # aucune destination configurée
            appel(url, "/api/notifications/test", {})
        assert e.value.code == 400
    finally:
        srv.shutdown()
