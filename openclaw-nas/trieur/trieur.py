"""Trieur de documents : prépare le travail d'OpenClaw et applique ce que tu as validé.

Dossier « boîte d'entrée » : <Documents>/_A_TRIER. Tout fichier déposé là est « à trier ».

Toutes les 30 secondes :
1. extrait le texte de chaque document (PDF, scan avec reconnaissance de texte, Word, texte)
   dans _A_TRIER/_traitement/texte/<fichier>.txt ;
2. écrit _A_TRIER/_traitement/a_traiter.txt : les documents sans proposition, la liste de travail d'OpenClaw ;
3. écrit _A_TRIER/_traitement/dossiers.txt : les dossiers existants, où ranger ;
4. déplace les documents dont la proposition (_traitement/propositions/<fichier>.json) a le
   statut « valide », note l'opération dans _A_TRIER/_journal.md et dans _index_documents.csv.

OpenClaw n'a qu'un accès en lecture aux documents : seul ce service déplace des fichiers, et
uniquement après validation, jamais en écrasant un fichier existant.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path

log = logging.getLogger("trieur")

RACINE = Path(os.environ.get("DOCUMENTS", "/documents"))
INTERVALLE = int(os.environ.get("INTERVALLE_S", "30"))
MAX_CARACTERES = 6000  # suffisant pour un titre et un classement, et rapide pour le modèle local
PAGES_OCR = 3
PROFONDEUR_DOSSIERS = 3

STATUTS = {"propose", "valide", "refuse"}
_INTERDITS_TITRE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class Chemins:
    def __init__(self, racine: Path):
        self.racine = racine
        self.entree = racine / "_A_TRIER"
        self.traitement = self.entree / "_traitement"
        self.texte = self.traitement / "texte"
        self.propositions = self.traitement / "propositions"
        self.journal = self.entree / "_journal.md"
        self.index = racine / "_index_documents.csv"

    def creer(self) -> None:
        for d in (self.texte, self.propositions):
            d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------- Extraction du texte


def _commande(args: list[str], timeout: int = 120) -> str:
    try:
        r = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
        return r.stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("%s : %s", args[0], e)
        return ""


def _ocr_images(images: list[Path]) -> str:
    return "\n".join(_commande(["tesseract", str(i), "-", "-l", "fra+eng"]) for i in images)


def _pdf(fichier: Path) -> str:
    texte = _commande(["pdftotext", "-l", "10", "-layout", str(fichier), "-"])
    if len(texte.strip()) >= 20:
        return texte
    # Pas de texte : c'est un scan, on fait de la reconnaissance de caractères
    with tempfile.TemporaryDirectory() as tmp:
        _commande(["pdftoppm", "-r", "200", "-l", str(PAGES_OCR), "-png", str(fichier), f"{tmp}/page"])
        return _ocr_images(sorted(Path(tmp).glob("page*.png")))


def _docx(fichier: Path) -> str:
    with zipfile.ZipFile(fichier) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    return re.sub(r"<[^>]+>", "", xml)


def extraire(fichier: Path) -> str:
    ext = fichier.suffix.lower()
    try:
        if ext == ".pdf":
            texte = _pdf(fichier)
        elif ext in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}:
            texte = _ocr_images([fichier])
        elif ext == ".docx":
            texte = _docx(fichier)
        elif ext in {".txt", ".md", ".csv"}:
            texte = fichier.read_text(encoding="utf-8", errors="replace")
        else:
            texte = ""
    except (OSError, zipfile.BadZipFile, KeyError) as e:
        log.warning("Lecture impossible de %s : %s", fichier.name, e)
        texte = ""
    texte = re.sub(r"[ \t]+", " ", texte)
    texte = re.sub(r"\n{3,}", "\n\n", texte).strip()
    return texte[:MAX_CARACTERES] or "(aucun texte lisible : propose un titre d'après le nom du fichier)"


# ---------------------------------------------------------------- Préparation pour OpenClaw


def documents_en_attente(c: Chemins) -> list[Path]:
    if not c.entree.exists():
        return []
    return sorted(f for f in c.entree.iterdir() if f.is_file() and not f.name.startswith(("_", ".")))


def preparer(c: Chemins) -> None:
    documents = documents_en_attente(c)
    noms = {f.name for f in documents}
    for f in documents:
        sortie = c.texte / f"{f.name}.txt"
        if not sortie.exists() or sortie.stat().st_mtime < f.stat().st_mtime:
            log.info("Lecture de %s", f.name)
            sortie.write_text(extraire(f), encoding="utf-8")

    # Ménage : documents retirés à la main du dossier _A_TRIER
    for t in c.texte.glob("*.txt"):
        if t.name[:-4] not in noms:
            t.unlink()
    for p in c.propositions.glob("*.json"):
        if p.name[:-5] not in noms:
            p.unlink()

    a_faire = [f.name for f in documents if not (c.propositions / f"{f.name}.json").exists()]
    (c.traitement / "a_traiter.txt").write_text("\n".join(a_faire) + ("\n" if a_faire else ""), encoding="utf-8")


def lister_dossiers(c: Chemins) -> None:
    dossiers = []
    for chemin, sous, _ in os.walk(c.racine):
        rel = Path(chemin).relative_to(c.racine)
        # Ni la boîte d'entrée, ni les dossiers cachés / corbeilles du NAS (@recycle, #recycle…)
        sous[:] = sorted(d for d in sous if not d.startswith(("_", ".", "@", "#")))
        if len(rel.parts) >= PROFONDEUR_DOSSIERS:
            sous[:] = []
        if rel.parts:
            dossiers.append(rel.as_posix())
    (c.traitement / "dossiers.txt").write_text("\n".join(dossiers) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- Application des validations


class PropositionInvalide(ValueError):
    pass


def dossier_sur(c: Chemins, dossier: str) -> Path:
    """Le dossier de destination, garanti à l'intérieur des Documents et hors de _A_TRIER."""
    parties = [p.strip() for p in str(dossier).replace("\\", "/").split("/") if p.strip()]
    if not parties:
        raise PropositionInvalide("dossier vide")
    for p in parties:
        if p in {".", ".."} or p.startswith((".", "_", "@", "#")) or _INTERDITS_TITRE.search(p):
            raise PropositionInvalide(f"nom de dossier refusé : {p!r}")
    cible = c.racine.joinpath(*parties)
    if not cible.resolve().is_relative_to(c.racine.resolve()):
        raise PropositionInvalide("dossier hors des Documents")
    return cible


def titre_sur(titre: str) -> str:
    propre = re.sub(r"\s+", " ", _INTERDITS_TITRE.sub(" ", str(titre))).strip(" .")
    if not propre:
        raise PropositionInvalide("titre vide")
    return propre[:150]


def destination_libre(dossier: Path, titre: str, ext: str) -> Path:
    cible = dossier / f"{titre}{ext}"
    n = 2
    while cible.exists():
        cible = dossier / f"{titre} ({n}){ext}"
        n += 1
    return cible


def appliquer(c: Chemins) -> None:
    for fichier_prop in sorted(c.propositions.glob("*.json")):
        try:
            prop = json.loads(fichier_prop.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue  # en cours d'écriture, ou à corriger par OpenClaw
        if prop.get("statut") != "valide":
            continue

        source = c.entree / fichier_prop.name[:-5]
        try:
            if not source.is_file():
                raise PropositionInvalide("document introuvable dans _A_TRIER")
            dossier = dossier_sur(c, prop.get("dossier", ""))
            titre = titre_sur(prop.get("titre", ""))
            dossier.mkdir(parents=True, exist_ok=True)
            cible = destination_libre(dossier, titre, source.suffix.lower())
            shutil.move(str(source), str(cible))
        except (PropositionInvalide, OSError) as e:
            log.warning("%s : %s", fichier_prop.name, e)
            prop["statut"] = "propose"
            prop["erreur"] = str(e)
            fichier_prop.write_text(json.dumps(prop, ensure_ascii=False, indent=2), encoding="utf-8")
            continue

        rel = cible.relative_to(c.racine).as_posix()
        tags = [str(t) for t in prop.get("tags") or []]
        maintenant = datetime.now().strftime("%Y-%m-%d %H:%M")
        log.info("%s -> %s", source.name, rel)
        with c.journal.open("a", encoding="utf-8") as j:
            j.write(f"- {maintenant} : `{source.name}` → `{rel}`" + (f" ({', '.join(tags)})" if tags else "") + "\n")
        nouveau = not c.index.exists()
        with c.index.open("a", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";")
            if nouveau:
                w.writerow(["date", "chemin", "titre", "tags", "resume", "fichier_origine"])
            w.writerow([maintenant, rel, cible.stem, ", ".join(tags), prop.get("resume", ""), source.name])
        fichier_prop.unlink()
        (c.texte / f"{source.name}.txt").unlink(missing_ok=True)


def tour(c: Chemins) -> None:
    c.creer()
    appliquer(c)
    preparer(c)
    lister_dossiers(c)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    c = Chemins(RACINE)
    log.info("Surveillance de %s", c.entree)
    while True:
        try:
            tour(c)
        except Exception:
            log.exception("Erreur pendant le tri")
        time.sleep(INTERVALLE)


if __name__ == "__main__":
    main()
