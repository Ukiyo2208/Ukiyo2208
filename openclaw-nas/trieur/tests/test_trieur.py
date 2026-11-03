import json
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trieur  # noqa: E402


@pytest.fixture
def c(tmp_path):
    chemins = trieur.Chemins(tmp_path)
    (tmp_path / "Factures" / "Énergie").mkdir(parents=True)
    (tmp_path / "Banque").mkdir()
    (tmp_path / "@recycle").mkdir()
    chemins.entree.mkdir()
    return chemins


def proposer(c, fichier, **champs):
    prop = {"fichier": fichier, "titre": "T", "dossier": "Banque", "tags": [], "statut": "valide"} | champs
    (c.propositions / f"{fichier}.json").write_text(json.dumps(prop), encoding="utf-8")


def test_preparation(c):
    (c.entree / "note.txt").write_text("Facture EDF octobre 2026, montant 84,20 €")
    (c.entree / "_journal.md").write_text("ignoré")
    trieur.tour(c)
    assert "Facture EDF" in (c.texte / "note.txt.txt").read_text()
    assert (c.traitement / "a_traiter.txt").read_text() == "note.txt\n"
    dossiers = (c.traitement / "dossiers.txt").read_text().split()
    assert "Factures/Énergie" in dossiers and "Banque" in dossiers
    assert not any(d.startswith(("_", "@")) for d in dossiers)


def test_document_propose_n_est_plus_a_traiter(c):
    (c.entree / "note.txt").write_text("x")
    trieur.tour(c)
    proposer(c, "note.txt", statut="propose")
    trieur.tour(c)
    assert (c.traitement / "a_traiter.txt").read_text() == ""
    assert (c.entree / "note.txt").exists()  # pas encore validé : rien ne bouge


def test_deplacement_apres_validation(c):
    (c.entree / "scan.TXT").write_text("Relevé")
    trieur.tour(c)
    proposer(c, "scan.TXT", titre="2026-10-31 - Relevé : compte courant", dossier="Banque/2026", tags=["banque"])
    trieur.tour(c)
    cible = c.racine / "Banque" / "2026" / "2026-10-31 - Relevé compte courant.txt"
    assert cible.read_text() == "Relevé"
    assert not (c.entree / "scan.TXT").exists()
    assert not list(c.propositions.glob("*.json")) and not list(c.texte.glob("*.txt"))
    assert "Banque/2026/2026-10-31 - Relevé compte courant.txt" in c.journal.read_text()
    assert "banque" in c.index.read_text()


def test_jamais_d_ecrasement(c):
    (c.racine / "Banque" / "T.txt").write_text("ancien")
    (c.entree / "a.txt").write_text("nouveau")
    trieur.tour(c)
    proposer(c, "a.txt")
    trieur.tour(c)
    assert (c.racine / "Banque" / "T.txt").read_text() == "ancien"
    assert (c.racine / "Banque" / "T (2).txt").read_text() == "nouveau"


def test_chemin_absolu_reste_dans_documents(c):
    assert trieur.dossier_sur(c, "/etc") == c.racine / "etc"


@pytest.mark.parametrize("dossier", ["../hors", "_A_TRIER", "Banque/../../x", ".cache", "", "@recycle"])
def test_dossier_dangereux_refuse(c, dossier):
    (c.entree / "a.txt").write_text("x")
    trieur.tour(c)
    proposer(c, "a.txt", dossier=dossier)
    trieur.tour(c)
    assert (c.entree / "a.txt").exists()
    prop = json.loads((c.propositions / "a.txt.json").read_text())
    assert prop["statut"] == "propose" and prop["erreur"]


def test_lien_symbolique_hors_documents_refuse(c, tmp_path_factory):
    dehors = tmp_path_factory.mktemp("dehors")
    (c.racine / "Lien").symlink_to(dehors)
    (c.entree / "a.txt").write_text("x")
    trieur.tour(c)
    proposer(c, "a.txt", dossier="Lien")
    trieur.tour(c)
    assert (c.entree / "a.txt").exists() and not list(dehors.iterdir())


def test_retire_a_la_main(c):
    (c.entree / "a.txt").write_text("x")
    trieur.tour(c)
    proposer(c, "a.txt", statut="propose")
    (c.entree / "a.txt").unlink()
    trieur.tour(c)
    assert not list(c.propositions.glob("*")) and not list(c.texte.glob("*"))


def test_docx(c):
    with zipfile.ZipFile(c.entree / "lettre.docx", "w") as z:
        z.writestr("word/document.xml", "<w:document><w:p><w:t>Contrat d'assurance</w:t></w:p><w:p><w:t>MAIF</w:t></w:p></w:document>")
    trieur.tour(c)
    assert (c.texte / "lettre.docx.txt").read_text() == "Contrat d'assurance\nMAIF"


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="poppler absent")
def test_pdf_avec_texte(c):
    canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    pdf = canvas.Canvas(str(c.entree / "impots.pdf"))
    pdf.drawString(50, 700, "Avis d'imposition 2026 - Direction des finances")
    pdf.save()
    trieur.tour(c)
    assert "Avis d'imposition 2026" in (c.texte / "impots.pdf.txt").read_text()
