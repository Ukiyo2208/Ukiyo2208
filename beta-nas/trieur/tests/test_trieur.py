import csv
import json
import shutil
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trieur  # noqa: E402
import web  # noqa: E402

DOCS = "volume1/Document"


@pytest.fixture
def c(tmp_path):
    chemins = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", DOCS, ignores=["volume3/Docker/Beta IA"])
    (chemins.rangement / "Factures" / "Énergie").mkdir(parents=True)
    (chemins.rangement / "Banque").mkdir()
    (chemins.racine / "volume1" / "@recycle").mkdir()
    trieur._scan["signature"] = None  # pas d'attente des 10 minutes dans les tests
    return chemins


def ecrire(c, rel, texte="x"):
    f = c.racine / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(texte)
    trieur._scan["signature"] = None
    return f


def ident(c, rel):
    return {r: i for i, r in json.loads(c.sources.read_text()).items()}[rel]


def proposer(c, rel, **champs):
    i = ident(c, rel)
    prop = {"fichier": i, "titre": "T", "dossier": "Banque", "tags": [], "statut": "valide"} | champs
    (c.propositions / f"{i}.json").write_text(json.dumps(prop), encoding="utf-8")
    return i


def a_traiter(c):
    return [l.split(" | ")[1] for l in c.a_traiter.read_text().splitlines() if " | " in l]


def test_preparation(c):
    ecrire(c, f"{DOCS}/note.txt", "Facture EDF octobre 2026, montant 84,20 €")
    trieur.tour(c)
    assert a_traiter(c) == [f"{DOCS}/note.txt"]
    assert "Facture EDF" in (c.texte / f"{ident(c, f'{DOCS}/note.txt')}.txt").read_text()
    dossiers = c.dossiers.read_text().split()
    assert "Factures/Énergie" in dossiers and "Banque" in dossiers  # relatifs au dossier de rangement
    assert not any(d.startswith(("_", "@")) for d in dossiers)
    assert not list(c.racine.rglob("_*"))  # rien d'écrit dans les dossiers du NAS


def test_tous_les_volumes_et_dossiers_personnels(c):
    ecrire(c, "volume3/Travail/contrat.pdf")
    ecrire(c, "volume1/@home/bastien/PC/impots.pdf")
    ecrire(c, "volume1/@appstore/notice.pdf")  # dossier système
    ecrire(c, "volume3/Docker/projet/readme.md")  # exclu par défaut
    ecrire(c, "volume1/@home/bastien/APPLICATION/doc.txt")  # exclu par défaut
    ecrire(c, "volume3/Docker/Beta IA/beta/data/tri/texte/a.txt")  # l'installation de Bêta
    trieur.tour(c)
    assert sorted(a_traiter(c)) == ["volume1/@home/bastien/PC/impots.pdf", "volume3/Travail/contrat.pdf"]


def test_document_propose_n_est_plus_a_traiter(c):
    ecrire(c, f"{DOCS}/note.txt")
    trieur.tour(c)
    proposer(c, f"{DOCS}/note.txt", statut="propose")
    trieur.tour(c)
    assert c.a_traiter.read_text() == ""
    assert (c.rangement / "note.txt").exists()  # pas encore validé : rien ne bouge


def test_deplacement_apres_validation(c):
    ecrire(c, "volume3/scan.TXT", "Relevé")
    trieur.tour(c)
    proposer(c, "volume3/scan.TXT", titre="2026-10-31 - Relevé : compte courant", dossier="Banque/2026", tags=["banque"])
    trieur.tour(c)
    cible = c.rangement / "Banque" / "2026" / "2026-10-31 - Relevé compte courant.txt"
    assert cible.read_text() == "Relevé"
    assert not (c.racine / "volume3" / "scan.TXT").exists()
    assert not list(c.propositions.glob("*.json")) and not list(c.texte.glob("*.txt"))
    assert f"{DOCS}/Banque/2026/2026-10-31 - Relevé compte courant.txt" in c.journal.read_text()
    assert "banque" in c.index.read_text()
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert a_traiter(c) == []  # un document rangé ne revient pas


def test_jamais_d_ecrasement(c):
    (c.rangement / "Banque" / "T.txt").write_text("ancien")
    ecrire(c, f"{DOCS}/a.txt", "nouveau")
    trieur.tour(c)
    proposer(c, f"{DOCS}/a.txt")
    trieur.tour(c)
    assert (c.rangement / "Banque" / "T.txt").read_text() == "ancien"
    assert (c.rangement / "Banque" / "T (2).txt").read_text() == "nouveau"


def test_chemin_absolu_reste_dans_le_rangement(c):
    assert trieur.dossier_sur(c, "/etc") == c.rangement / "etc"


@pytest.mark.parametrize("dossier", ["../hors", "_A_TRIER", "Banque/../../x", ".cache", "", "@recycle"])
def test_dossier_dangereux_refuse(c, dossier):
    ecrire(c, f"{DOCS}/a.txt")
    trieur.tour(c)
    i = proposer(c, f"{DOCS}/a.txt", dossier=dossier)
    trieur.tour(c)
    assert (c.rangement / "a.txt").exists()
    prop = json.loads((c.propositions / f"{i}.json").read_text())
    assert prop["statut"] == "propose" and prop["erreur"]


def test_lien_symbolique_hors_rangement_refuse(c, tmp_path_factory):
    dehors = tmp_path_factory.mktemp("dehors")
    (c.rangement / "Lien").symlink_to(dehors)
    ecrire(c, f"{DOCS}/a.txt")
    trieur.tour(c)
    proposer(c, f"{DOCS}/a.txt", dossier="Lien")
    trieur.tour(c)
    assert (c.rangement / "a.txt").exists() and not list(dehors.iterdir())


def test_retire_a_la_main(c):
    f = ecrire(c, f"{DOCS}/a.txt")
    trieur.tour(c)
    proposer(c, f"{DOCS}/a.txt", statut="propose")
    f.unlink()
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert not list(c.propositions.glob("*")) and not list(c.texte.glob("*"))


def test_proposition_illisible_retiree_et_pas_comptee(c, monkeypatch):
    ecrire(c, f"{DOCS}/a.txt")
    trieur.tour(c)
    i = ident(c, f"{DOCS}/a.txt")
    (c.propositions / f"{i}.json").write_text("{pas du json")
    assert web.etat(c)["propositions"] == 0 == len(web.lister_propositions(c))
    monkeypatch.setattr(trieur.time, "time", lambda: 10**10)  # le fichier n'est plus en cours d'écriture
    trieur.tour(c)
    assert a_traiter(c) == [f"{DOCS}/a.txt"]  # sera reproposé


def test_docx(c):
    f = c.rangement / "lettre.docx"
    with zipfile.ZipFile(f, "w") as z:
        z.writestr("word/document.xml", "<w:document><w:p><w:t>Contrat d'assurance</w:t></w:p><w:p><w:t>MAIF</w:t></w:p></w:document>")
    trieur.tour(c)
    assert (c.texte / f"{ident(c, f'{DOCS}/lettre.docx')}.txt").read_text() == "Contrat d'assurance\nMAIF"


@pytest.mark.skipif(not shutil.which("pdftotext"), reason="poppler absent")
def test_pdf_avec_texte(c):
    canvas = pytest.importorskip("reportlab.pdfgen.canvas")
    pdf = canvas.Canvas(str(c.rangement / "impots.pdf"))
    pdf.drawString(50, 700, "Avis d'imposition 2026 - Direction des finances")
    pdf.save()
    trieur.tour(c)
    assert "Avis d'imposition 2026" in (c.texte / f"{ident(c, f'{DOCS}/impots.pdf')}.txt").read_text()


def surveiller(c, *dossiers, exclure=()):
    c.creer()
    c.surveiller.write_text("\n".join(dossiers) + "\n")
    c.exclure.write_text("# commentaire\n" + "\n".join(exclure) + "\n")
    trieur._scan["signature"] = None


def test_tous_les_documents_sauf_exclusions(c):
    ecrire(c, f"{DOCS}/Banque/releve.txt")
    ecrire(c, f"{DOCS}/Factures/Énergie/edf.txt")
    ecrire(c, "volume1/Photos/notes.txt")
    ecrire(c, f"{DOCS}/Banque/film.mp4")  # pas un document
    ecrire(c, f"{DOCS}/Banque/brouillon.txt")
    surveiller(c, ".", exclure=["volume1/Photos", "*brouillon*"])
    trieur.tour(c)
    assert a_traiter(c) == [f"{DOCS}/Banque/releve.txt", f"{DOCS}/Factures/Énergie/edf.txt"]


def test_meme_nom_dans_deux_dossiers(c):
    ecrire(c, f"{DOCS}/Banque/doc.txt", "banque")
    ecrire(c, f"{DOCS}/Factures/doc.txt", "facture")
    trieur.tour(c)
    identifiants = [l.split(" | ")[0] for l in c.a_traiter.read_text().splitlines()]
    assert len(set(identifiants)) == 2 and all(i.startswith("doc~") for i in identifiants)


def test_garder_et_ranger(c):
    ecrire(c, f"{DOCS}/Banque/a.txt", "à ranger")
    ecrire(c, f"{DOCS}/Banque/b.txt", "à garder")
    surveiller(c, f"{DOCS}/Banque")
    trieur.tour(c)
    proposer(c, f"{DOCS}/Banque/a.txt", titre="2026 - Relevé", dossier="Banque/2026")
    proposer(c, f"{DOCS}/Banque/b.txt", statut="garder")
    trieur.tour(c)
    assert (c.rangement / "Banque" / "2026" / "2026 - Relevé.txt").read_text() == "à ranger"
    assert (c.rangement / "Banque" / "b.txt").exists()  # gardé à sa place
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert a_traiter(c) == []


def test_dossier_surveille_hors_nas_ignore(c, tmp_path_factory):
    dehors = tmp_path_factory.mktemp("dehors")
    (dehors / "secret.txt").write_text("x")
    surveiller(c, "../" + dehors.name, str(dehors))
    trieur.tour(c)
    assert a_traiter(c) == []


def test_reprise_de_l_ancien_tri(c):
    ancien = c.rangement / "_A_TRIER"
    (ancien / "_traitement" / "propositions").mkdir(parents=True)
    (ancien / "_traitement" / "propositions" / "x.json").write_text("{}")
    (ancien / "_traitement" / "gardes.txt").write_text("Banque/vieux.pdf\n")
    (ancien / "_a_exclure.txt").write_text("# commentaire\nPhotos\n*.mp4\n")
    (ancien / "_journal.md").write_text("- 2026-10-01 : `a` → `Banque/a.pdf`\n")
    (ancien / "scan.pdf").write_text("pas encore trié")
    with (c.rangement / "_index_documents.csv").open("w", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["date", "chemin", "titre", "tags", "resume", "fichier_origine"])
        w.writerow(["2026-10-01", "Banque/a.pdf", "a", "", "", "_A_TRIER/a.pdf"])
    trieur.migrer(c)
    assert not ancien.exists() and not (c.rangement / "_index_documents.csv").exists()
    assert (c.rangement / "À trier" / "scan.pdf").exists()  # la boîte d'entrée devient un dossier normal
    assert trieur.lire_liste(c.gardes) == [f"{DOCS}/Banque/vieux.pdf"]
    assert f"{DOCS}/Photos" in trieur.lire_liste(c.exclure) and "*.mp4" in trieur.lire_liste(c.exclure)
    assert "Banque/a.pdf" in c.journal.read_text()
    assert f"{DOCS}/Banque/a.pdf" in trieur.deja_ranges(c)
    trieur.tour(c)
    assert a_traiter(c) == [f"{DOCS}/À trier/scan.pdf"]


def test_reprise_boite_vide_supprimee(c):
    (c.rangement / "_A_TRIER" / "_traitement").mkdir(parents=True)
    trieur.migrer(c)
    assert not (c.rangement / "_A_TRIER").exists() and not (c.rangement / "À trier").exists()
