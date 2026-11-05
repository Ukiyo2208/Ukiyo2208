import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import proposeur  # noqa: E402
import trieur  # noqa: E402
import web  # noqa: E402

REPONSE = {"titre": "2026-10-15 - Facture - EDF - Électricité octobre", "dossier": "Factures/Énergie/2026",
           "tags": ["Facture", "energie"], "resume": "84,20 € à payer avant le 30/11.", "confiance": "haute",
           "deja_bien_range": False}


@pytest.fixture
def ollama(monkeypatch):
    recus = []

    class Faux(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            corps = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            recus.append(corps)
            if corps.get("think") is False and getattr(Faux, "refuse_think", False):
                self.send_response(400); self.end_headers()
                self.wfile.write(b'{"error":"model does not support thinking"}')
                return
            sortie = json.dumps({"message": {"content": json.dumps(REPONSE)}}).encode()
            self.send_response(200); self.end_headers(); self.wfile.write(sortie)

    srv = HTTPServer(("127.0.0.1", 0), Faux)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(proposeur, "OLLAMA_URL", f"http://127.0.0.1:{srv.server_address[1]}")
    yield recus, Faux
    srv.shutdown()


@pytest.fixture
def c(tmp_path):
    chemins = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", "volume1/Document")
    (chemins.rangement / "Factures").mkdir(parents=True)
    (chemins.rangement / "scan.txt").write_text("EDF facture octobre 2026 montant 84,20")
    trieur._scan["signature"] = None
    trieur.tour(chemins)
    return chemins


def ident(c):
    return next(iter(json.loads(c.sources.read_text())))


def test_proposition_puis_validation(c, ollama):
    recus, _ = ollama
    p = proposeur.Proposeur(c)
    assert p.un_document() is True
    message = recus[0]["messages"][1]["content"]
    assert "Emplacement actuel : volume1/Document/scan.txt" in message and "EDF facture" in message and "Factures" in message
    assert recus[0]["format"]["required"] and recus[0]["think"] is False

    props = web.lister_propositions(c)
    assert props[0]["titre"] == REPONSE["titre"] and props[0]["tags"] == ["facture", "energie"]
    assert p.un_document() is False  # plus rien à faire

    web.modifier_proposition(c, {"fichier": ident(c), "statut": "valide", "dossier": "Factures/EDF"})
    trieur.tour(c)
    assert (c.rangement / "Factures" / "EDF" / f"{REPONSE['titre']}.txt").exists()
    assert web.lister_propositions(c) == []


def test_modele_sans_mode_reflexion(c, ollama):
    recus, faux = ollama
    faux.refuse_think = True
    assert proposeur.Proposeur(c).un_document() is True
    assert "think" not in recus[-1] and web.lister_propositions(c)


def test_garder_depuis_la_page(c, ollama):
    proposeur.Proposeur(c).un_document()
    web.modifier_proposition(c, {"fichier": ident(c), "statut": "garder"})
    trieur.tour(c)
    assert (c.rangement / "scan.txt").exists() and "volume1/Document/scan.txt" in c.gardes.read_text()


def test_dossier_invalide_refuse_a_la_validation(c, ollama):
    proposeur.Proposeur(c).un_document()
    with pytest.raises(trieur.PropositionInvalide):
        web.modifier_proposition(c, {"fichier": ident(c), "statut": "valide", "dossier": "../dehors"})
    with pytest.raises(ValueError):
        web.modifier_proposition(c, {"fichier": "../x", "statut": "valide"})


def test_ollama_absent(c, monkeypatch):
    monkeypatch.setattr(proposeur, "OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(proposeur.time, "sleep", lambda s: None)
    p = proposeur.Proposeur(c)
    assert p.un_document() is True and "scan.txt" in p.derniere_erreur and web.lister_propositions(c) == []


def test_heures_actives(monkeypatch):
    monkeypatch.setenv("TRI_HEURES", "1-3,22")
    assert proposeur.heures_actives() == {1, 2, 3, 22}


@pytest.fixture
def plusieurs(tmp_path, ollama, monkeypatch):
    chemins = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", "volume1/Document")
    chemins.rangement.mkdir(parents=True)
    for i in range(3):
        (chemins.rangement / f"doc{i}.txt").write_text(f"document {i}")
    trieur._scan["signature"] = None
    trieur.tour(chemins)
    monkeypatch.setattr(proposeur, "heures_actives", lambda: set())  # hors des heures de tri
    envois = []
    return proposeur.Proposeur(chemins, lambda titre, message: envois.append(message)), envois


def test_tout_traiter_a_la_suite(plusieurs):
    p, envois = plusieurs
    assert p.etape() is False and envois == []  # hors des heures : rien ne se passe
    p.lancer(tout=True)
    assert p.etat()["continu"] is True
    while p.etape():
        pass
    assert len(web.lister_propositions(p.c)) == 3 and p.faits_continu == 3
    assert p.continu is False  # s'arrête tout seul à la fin
    assert envois == ["Tout est traité (3 document(s)). 3 nouvelles propositions à valider."]


def test_arreter(plusieurs):
    p, envois = plusieurs
    p.lancer(tout=True)
    assert p.etape() is True
    p.arreter()
    assert p.etape() is False and len(web.lister_propositions(p.c)) == 1
    assert envois == ["Tri arrêté après 1 document(s). 1 nouvelle proposition à valider."]


def test_cinq_documents_puis_notification(plusieurs):
    p, envois = plusieurs
    p.lancer(2)
    while p.etape():
        pass
    assert len(web.lister_propositions(p.c)) == 2
    assert envois == ["Préparation terminée. 2 nouvelles propositions à valider."]


def test_tri_bloque_prevenu_une_fois(plusieurs, monkeypatch):
    p, envois = plusieurs
    monkeypatch.setattr(proposeur, "OLLAMA_URL", "http://127.0.0.1:9")
    monkeypatch.setattr(proposeur.time, "sleep", lambda s: None)
    p.lancer(tout=True)
    for _ in range(8):
        p.etape()
    assert p.continu is False and len(envois) == 1 and "échecs d'affilée" in envois[0]
