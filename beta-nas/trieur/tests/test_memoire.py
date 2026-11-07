import csv
import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import memoire as mem  # noqa: E402
import trieur  # noqa: E402
import web  # noqa: E402

DOCS = "volume1/Document"
BOUYGUES_1 = ("Bouygues Telecom Facture Bbox Ultym numéro client 4455667 période du 01/09/2026 au 30/09/2026 "
              "abonnement internet fibre montant 42,99 euros prélèvement le 15/10/2026 Bouygues Telecom")
BOUYGUES_2 = ("Bouygues Telecom Facture Bbox Ultym numéro client 4455667 période du 01/10/2026 au 31/10/2026 "
              "abonnement internet fibre montant 44,99 euros prélèvement le 15/11/2026 Bouygues Telecom")
MUTUELLE = ("Harmonie Mutuelle remboursement soins dentaires décompte assuré prestations santé "
            "consultation chirurgien dentiste remboursement sécurité sociale part complémentaire")


@pytest.fixture
def c(tmp_path):
    chemins = trieur.Chemins(tmp_path / "nas", tmp_path / "etat", DOCS)
    (chemins.rangement / "Factures").mkdir(parents=True)
    trieur._scan["signature"] = None
    return chemins


def ecrire(c, rel, texte):
    f = c.racine / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(texte)
    trieur._scan["signature"] = None
    return f


def a_traiter(c):
    return [l.split(" | ")[1] for l in c.a_traiter.read_text().splitlines() if " | " in l]


def ident(c, rel):
    return {r: i for i, r in json.loads(c.sources.read_text()).items()}[rel]


def valider(c, rel, **champs):
    i = ident(c, rel)
    prop = {"fichier": i, "titre": "T", "dossier": "Factures", "tags": [], "statut": "valide"} | champs
    (c.propositions / f"{i}.json").write_text(json.dumps(prop), encoding="utf-8")
    trieur.tour(c)


def test_reconnu_apres_reorganisation_du_nas(c):
    ecrire(c, "volume3/scan.txt", BOUYGUES_1)
    trieur.tour(c)
    valider(c, "volume3/scan.txt", titre="2026-09 - Facture - Bouygues Telecom - Box", dossier="Factures/Internet")
    range = c.rangement / "Factures/Internet/2026-09 - Facture - Bouygues Telecom - Box.txt"
    assert range.exists()
    # Le NAS est réorganisé : le fichier est déplacé et renommé, une copie est restaurée ailleurs
    (c.rangement / "Archives").mkdir()
    shutil.move(range, c.rangement / "Archives/bouygues.txt")
    shutil.copy(c.rangement / "Archives/bouygues.txt", c.racine / "volume3/restauré.txt")
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert a_traiter(c) == [] and web.etat(c)["reconnus"] == 2


def test_meme_texte_dans_un_autre_fichier(c):
    ecrire(c, f"{DOCS}/a.txt", BOUYGUES_1)
    trieur.tour(c)
    valider(c, f"{DOCS}/a.txt", titre="Bouygues")
    ecrire(c, "volume3/rescanné.txt", BOUYGUES_1.upper().replace(" ", "   "))  # autre fichier, même texte
    trieur.tour(c)
    assert a_traiter(c) == []
    assert mem.Memoire(c.memoire).compter()["connu"] == 1


def test_garde_reconnu_puis_repropose(c):
    f = ecrire(c, "volume3/note.txt", MUTUELLE)
    trieur.tour(c)
    valider(c, "volume3/note.txt", statut="garder")
    shutil.move(f, c.racine / "volume3/note renommée.txt")
    trieur._scan["signature"] = None
    trieur.tour(c)
    assert a_traiter(c) == []
    web.enregistrer(c, {"reproposer": ["volume3/note.txt"]})
    trieur.tour(c)
    assert a_traiter(c) == ["volume3/note renommée.txt"]


def test_ressemblance():
    exemples = mem.Exemples(Path("/inexistant"))
    a, b, m = mem.mots(BOUYGUES_1), mem.mots(BOUYGUES_2), mem.mots(MUTUELLE)
    assert exemples.ressemblance(a, b) > 0.8 > 0.1 > exemples.ressemblance(a, m)
    assert mem.empreinte_texte("trop court") is None


def test_exemples_appris_et_plus_proches(c):
    ecrire(c, f"{DOCS}/b1.txt", BOUYGUES_1)
    ecrire(c, f"{DOCS}/m.txt", MUTUELLE)
    trieur.tour(c)
    valider(c, f"{DOCS}/b1.txt", titre="2026-09 - Facture - Bouygues Telecom - Bbox", dossier="Factures/Internet",
            tags=["facture", "internet"])
    valider(c, f"{DOCS}/m.txt", titre="2026 - Remboursement - Harmonie Mutuelle", dossier="Santé/Mutuelle")
    proches = mem.Exemples(c.exemples).plus_proches(BOUYGUES_2)
    assert proches[0][1]["dossier"] == "Factures/Internet" and proches[0][0] > 0.7
    assert all(e["dossier"] != "Santé/Mutuelle" for _, e in proches)


def test_correction_refait_les_propositions_du_meme_genre(c):
    ecrire(c, f"{DOCS}/b1.txt", BOUYGUES_1)
    ecrire(c, f"{DOCS}/b2.txt", BOUYGUES_2)
    ecrire(c, f"{DOCS}/m.txt", MUTUELLE)
    trieur.tour(c)
    for rel in (f"{DOCS}/b2.txt", f"{DOCS}/m.txt"):  # propositions en attente
        i = ident(c, rel)
        (c.propositions / f"{i}.json").write_text(json.dumps(
            {"fichier": i, "titre": "Mauvais", "dossier": "Divers", "statut": "propose"}))
    # Tu corriges la première facture avant de la valider
    valider(c, f"{DOCS}/b1.txt", titre="Facture Bouygues", dossier="Factures/Internet",
            titre_modele="Bouygues doc", dossier_modele="Divers")
    restantes = {p["fichier"] for p in web.lister_propositions(c)}
    assert ident(c, f"{DOCS}/m.txt") in restantes  # pas du même genre : gardée
    assert ident(c, f"{DOCS}/b2.txt") not in restantes  # même genre : sera refaite avec ton choix
    assert f"{DOCS}/b2.txt" in a_traiter(c)


def test_reprise_des_documents_tries_avant(c):
    # Rangé avant cette version : seulement dans l'index
    f = ecrire(c, f"{DOCS}/Factures/ancienne.txt", BOUYGUES_1)
    c.creer()
    with c.index.open("w", newline="") as fi:
        w = csv.writer(fi, delimiter=";")
        w.writerow(["date", "chemin", "titre", "tags", "resume", "fichier_origine"])
        w.writerow(["2026-10-01", f"{DOCS}/Factures/ancienne.txt", "ancienne", "facture", "", "x"])
    trieur.completer_memoire(c)
    assert mem.Memoire(c.memoire).connu(mem.empreinte_fichier(f))
    exemple = mem.Exemples(c.exemples).liste[0]
    assert exemple["dossier"] == "Factures" and exemple["tags"] == ["facture"]
    trieur.completer_memoire(c)
    assert len(mem.Exemples(c.exemples).liste) == 1  # pas en double
