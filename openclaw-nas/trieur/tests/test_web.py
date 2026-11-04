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
    c = trieur.Chemins(tmp_path)
    for d in ("Banque/2025", "Banque/2026", "Factures", "Photos", "@recycle"):
        (tmp_path / d).mkdir(parents=True)
    (tmp_path / "Banque/2026/releve.pdf").write_text("x")
    (tmp_path / "Photos/note.txt").write_text("x")
    c.creer()
    srv = web.serveur(c, "jeton", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield c, f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def appel(url, chemin, corps=None, jeton="jeton"):
    requete = urllib.request.Request(url + chemin, data=json.dumps(corps).encode() if corps is not None else None,
                                     headers={"Authorization": f"Bearer {jeton}"}, method="POST" if corps is not None else "GET")
    with urllib.request.urlopen(requete) as r:
        return json.loads(r.read())


def test_page_et_jeton(site):
    c, url = site
    assert b"Tri des documents" in urllib.request.urlopen(url + "/").read()
    with pytest.raises(urllib.error.HTTPError) as e:
        appel(url, "/api/etat", jeton="faux")
    assert e.value.code == 401


def test_arbre_des_dossiers(site):
    c, url = site
    racine = appel(url, "/api/dossiers")
    assert [d["nom"] for d in racine] == ["Banque", "Factures", "Photos"]  # ni @recycle ni _A_TRIER
    assert racine[0]["a_des_sous_dossiers"] is True
    assert [d["chemin"] for d in appel(url, "/api/dossiers?chemin=Banque")] == ["Banque/2025", "Banque/2026"]


def test_decocher_un_dossier(site):
    c, url = site
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert appel(url, "/api/etat")["en_attente"] == 2
    etat = appel(url, "/api/reglages", {"tout_trier": True, "exclusions": ["Photos", "*.mp4"]})
    assert etat["exclusions"] == ["Photos", "*.mp4"] and etat["en_attente"] == 1
    assert "# Ce que tu ne veux PAS trier" in c.exclure.read_text()  # commentaires conservés
    assert appel(url, "/api/dossiers")[2]["exclu"] is True


def test_reproposer_un_document_garde(site):
    c, url = site
    c.gardes.write_text("Banque/2026/releve.pdf\n")
    assert appel(url, "/api/etat")["gardes"] == ["Banque/2026/releve.pdf"]
    assert appel(url, "/api/reglages", {"reproposer": ["Banque/2026/releve.pdf"]})["gardes"] == []


@pytest.mark.parametrize("chemin", ["../../etc", "Banque/../../x"])
def test_chemins_dangereux_refuses(site, chemin):
    c, url = site
    with pytest.raises(urllib.error.HTTPError) as e:
        appel(url, "/api/reglages", {"exclusions": [chemin]})
    assert e.value.code == 400
    with pytest.raises(urllib.error.HTTPError):
        appel(url, f"/api/dossiers?chemin={chemin}")
