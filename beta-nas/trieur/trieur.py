"""Trieur de documents de Bêta : propose titre, dossier et tags, et range ce que tu as validé.

Il voit tous les volumes du NAS (montés dans /nas : /nas/volume1, /nas/volume3…) et cherche les
documents (PDF, Word, texte) partout, sauf dans ce que tu as décoché sur la page (http://IP_DU_NAS:8800/tri/),
ce qu'il a déjà rangé et ce que tu as décidé de garder à sa place.

Ses fichiers de travail (texte extrait, propositions, journal, index) sont dans l'installation de Bêta
(data/tri, monté dans /etat) : rien n'est écrit dans tes dossiers, à part les documents rangés.

Toutes les 30 secondes :
1. extrait le texte des documents à traiter (PDF, scan avec reconnaissance de texte, Word, texte) ;
2. écrit a_traiter.txt (les documents sans proposition) et dossiers.txt (où ranger) ;
3. déplace les documents dont la proposition a le statut « valide », note l'opération dans journal.md
   et index_documents.csv. Jamais sans validation, jamais en écrasant un fichier existant.
"""

from __future__ import annotations

import csv
import fnmatch
import hashlib
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

RACINE = Path(os.environ.get("TRI_RACINE", "/nas"))
ETAT = Path(os.environ.get("TRI_ETAT", "/etat"))
# Dossier où ranger (relatif à la racine), par exemple « volume1/Document »
RANGEMENT = os.environ.get("TRI_RANGEMENT", "").strip().strip("/")
IGNORES = [i.strip().strip("/") for i in os.environ.get("TRI_IGNORER", "").split(";")]
INTERVALLE = int(os.environ.get("INTERVALLE_S", "30"))
MAX_CARACTERES = 6000  # suffisant pour un titre et un classement, et rapide pour le modèle local
PAGES_OCR = 3
PROFONDEUR_DOSSIERS = 3

STATUTS = {"propose", "valide", "garder"}  # « refuse » est accepté comme « garder »
EXTENSIONS_DOCUMENTS = {".pdf", ".docx", ".txt", ".md"}  # cherchées dans les dossiers surveillés
MAX_EN_ATTENTE = 50  # documents préparés à l'avance (le reste attend son tour)
INTERVALLE_SCAN = 600  # secondes entre deux parcours des dossiers surveillés

SURVEILLER_PAR_DEFAUT = """# Dossiers à surveiller, un par ligne, à partir de la racine (volume1, volume3…).
# « . » = tous les volumes. Plus simple : la page http://IP_DU_NAS:8800/tri/
.
"""

EXCLURE_PAR_DEFAUT = """# Ce que tu ne veux PAS trier, un par ligne : un dossier, ou un motif avec * .
# Plus simple : décoche les dossiers sur la page http://IP_DU_NAS:8800/tri/
# Exemples : volume1/Photos   *.mp4   */Banque/Anciens
*/Docker
*/Application
"""

# Dossiers système ou cachés jamais parcourus, sauf les dossiers personnels (@home)
_CACHES = ("_", ".", "@", "#")
_AUTORISES = {"@home"}


def visible(nom: str) -> bool:
    return nom in _AUTORISES or not nom.startswith(_CACHES)

_INTERDITS_TITRE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class Chemins:
    def __init__(self, racine: Path, etat: Path, rangement: str = "", ignores: list[str] | None = None):
        self.racine = racine
        # Jamais triés, quoi qu'il arrive (l'installation de Bêta elle-même, par exemple)
        self.ignores = [i for i in (ignores or []) if i]
        self.rangement = racine.joinpath(*rangement.split("/")) if rangement else racine
        self.etat = etat
        self.texte = etat / "texte"
        self.propositions = etat / "propositions"
        self.journal = etat / "journal.md"
        self.index = etat / "index_documents.csv"
        self.surveiller = etat / "a_surveiller.txt"
        self.exclure = etat / "a_exclure.txt"
        self.gardes = etat / "gardes.txt"
        self.sources = etat / "sources.json"
        self.a_traiter = etat / "a_traiter.txt"
        self.dossiers = etat / "dossiers.txt"

    def exclusions(self) -> list[str]:
        return lire_liste(self.exclure) + self.ignores

    def creer(self) -> None:
        for d in (self.texte, self.propositions):
            d.mkdir(parents=True, exist_ok=True)
        for fichier, contenu in ((self.surveiller, SURVEILLER_PAR_DEFAUT), (self.exclure, EXCLURE_PAR_DEFAUT)):
            if not fichier.exists():
                fichier.write_text(contenu, encoding="utf-8")

    def rel_rangement(self) -> str:
        """Le dossier de rangement vu depuis la racine (« volume1/Document »), ou « » pour la racine."""
        rel = self.rangement.relative_to(self.racine).as_posix()
        return "" if rel == "." else rel


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


# ---------------------------------------------------------------- Préparation


def lire_liste(fichier: Path) -> list[str]:
    if not fichier.exists():
        return []
    lignes = (l.strip() for l in fichier.read_text(encoding="utf-8").splitlines())
    return [l for l in lignes if l and not l.startswith("#")]


def identifiant(rel: str) -> str:
    """Nom unique d'un document : nom + empreinte du chemin (deux « facture.pdf » ne se confondent pas)."""
    chemin = Path(rel)
    empreinte = hashlib.sha1(rel.encode()).hexdigest()[:6]
    return f"{chemin.stem[:50]}~{empreinte}{chemin.suffix}"


def exclu(rel: str, motifs: list[str]) -> bool:
    rel_min = rel.lower()
    for motif in motifs:
        m = motif.strip().strip("/").lower()
        if m and (fnmatch.fnmatch(rel_min, m) or rel_min.startswith(m + "/") or fnmatch.fnmatch(rel_min, m + "/*")):
            return True
    return False


def deja_ranges(c: Chemins) -> set[str]:
    """Documents rangés par Bêta (index) ou gardés à leur place : jamais reproposés."""
    chemins = set(lire_liste(c.gardes))
    if c.index.exists():
        with c.index.open(encoding="utf-8", newline="") as f:
            chemins |= {ligne["chemin"] for ligne in csv.DictReader(f, delimiter=";") if ligne.get("chemin")}
    return chemins


_scan = {"instant": 0.0, "signature": None, "resultat": {}}


def _scanner_dossiers(c: Chemins) -> dict[str, str]:
    """Parcourt les dossiers surveillés (au plus toutes les 10 minutes, ou dès que les listes changent)."""
    surveilles, motifs = lire_liste(c.surveiller), c.exclusions()
    signature = (str(c.racine), tuple(surveilles), tuple(motifs), c.gardes.stat().st_mtime if c.gardes.exists() else 0,
                 c.index.stat().st_mtime if c.index.exists() else 0)
    if signature == _scan["signature"] and time.monotonic() - _scan["instant"] < INTERVALLE_SCAN:
        return _scan["resultat"]

    racine = c.racine.resolve()
    deja = deja_ranges(c)
    trouves: dict[str, str] = {}
    for dossier in surveilles:
        base = (c.racine / dossier).resolve()
        if not base.is_dir() or not base.is_relative_to(racine):
            log.warning("Dossier à surveiller introuvable ou hors des documents : %s", dossier)
            continue
        for chemin, sous, fichiers in os.walk(base):
            rel_dossier = Path(chemin).relative_to(racine).as_posix()
            rel_dossier = "" if rel_dossier == "." else rel_dossier + "/"
            sous[:] = sorted(d for d in sous if visible(d) and not exclu(rel_dossier + d, motifs))
            for nom in fichiers:
                rel = rel_dossier + nom
                if (Path(nom).suffix.lower() in EXTENSIONS_DOCUMENTS and not nom.startswith((".", "_", "~$"))
                        and not exclu(rel, motifs) and rel not in deja):
                    trouves[identifiant(rel)] = rel
    _scan.update(instant=time.monotonic(), signature=signature, resultat=trouves)
    return trouves


def candidats(c: Chemins) -> dict[str, str]:
    """identifiant -> chemin relatif à la racine."""
    return dict(_scanner_dossiers(c))


def preparer(c: Chemins) -> None:
    tous = candidats(c)
    en_attente = [i for i in tous if not (c.propositions / f"{i}.json").exists()][:MAX_EN_ATTENTE]
    utiles = set(en_attente) | {p.name[:-5] for p in c.propositions.glob("*.json") if p.name[:-5] in tous}

    for ident in en_attente:
        fichier = c.racine / tous[ident]
        sortie = c.texte / f"{ident}.txt"
        if not sortie.exists() or sortie.stat().st_mtime < fichier.stat().st_mtime:
            log.info("Lecture de %s", tous[ident])
            sortie.write_text(extraire(fichier), encoding="utf-8")

    # Ménage : documents déplacés ou supprimés à la main, ou exclus depuis
    for t in c.texte.glob("*.txt"):
        if t.name[:-4] not in utiles:
            t.unlink()
    for p in c.propositions.glob("*.json"):
        if p.name[:-5] not in tous:
            p.unlink()

    c.sources.write_text(json.dumps({i: tous[i] for i in utiles}, ensure_ascii=False, indent=1), encoding="utf-8")
    lignes = [f"{i} | {tous[i]}" for i in en_attente]
    restants = len([i for i in tous if not (c.propositions / f"{i}.json").exists()]) - len(en_attente)
    if restants > 0:
        lignes.append(f"# … et {restants} autres documents, qui seront préparés au fur et à mesure")
    c.a_traiter.write_text("\n".join(lignes) + ("\n" if lignes else ""), encoding="utf-8")


def lister_dossiers(c: Chemins) -> None:
    """Les dossiers existants du dossier de rangement (3 niveaux), proposés au modèle."""
    dossiers = []
    motifs = c.exclusions()
    for chemin, sous, _ in os.walk(c.rangement):
        rel = Path(chemin).relative_to(c.rangement)
        rel_racine = Path(chemin).relative_to(c.racine).as_posix()
        # Ni les dossiers cachés / corbeilles du NAS (@recycle, #recycle…), ni ceux exclus du tri
        sous[:] = sorted(d for d in sous if not d.startswith(_CACHES)
                         and not exclu(f"{rel_racine}/{d}".removeprefix("./"), motifs))
        if len(rel.parts) >= PROFONDEUR_DOSSIERS:
            sous[:] = []
        if rel.parts:
            dossiers.append(rel.as_posix())
    c.dossiers.write_text("\n".join(dossiers) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- Application des validations


class PropositionInvalide(ValueError):
    pass


def dossier_sur(c: Chemins, dossier: str) -> Path:
    """Le dossier de destination (relatif au dossier de rangement), garanti à l'intérieur de celui-ci."""
    parties = [p.strip() for p in str(dossier).replace("\\", "/").split("/") if p.strip()]
    if not parties:
        raise PropositionInvalide("dossier vide")
    for p in parties:
        if p in {".", ".."} or p.startswith(_CACHES) or _INTERDITS_TITRE.search(p):
            raise PropositionInvalide(f"nom de dossier refusé : {p!r}")
    cible = c.rangement.joinpath(*parties)
    if not cible.resolve().is_relative_to(c.rangement.resolve()):
        raise PropositionInvalide("dossier hors du dossier de rangement")
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


def garder(c: Chemins, rel: str) -> None:
    with c.gardes.open("a", encoding="utf-8") as f:
        f.write(rel + "\n")


def appliquer(c: Chemins) -> None:
    sources = json.loads(c.sources.read_text(encoding="utf-8")) if c.sources.exists() else {}
    for fichier_prop in sorted(c.propositions.glob("*.json")):
        try:
            prop = json.loads(fichier_prop.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue  # en cours d'écriture
        ident = fichier_prop.name[:-5]
        rel_source = sources.get(ident)
        if not rel_source:
            continue

        if prop.get("statut") in ("garder", "refuse"):
            # Le document reste où il est et ne sera plus proposé
            garder(c, rel_source)
            fichier_prop.unlink()
            (c.texte / f"{ident}.txt").unlink(missing_ok=True)
            log.info("%s : gardé à sa place", rel_source)
            continue
        if prop.get("statut") != "valide":
            continue

        source = c.racine / rel_source
        try:
            if not source.is_file():
                raise PropositionInvalide(f"document introuvable : {rel_source}")
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
            j.write(f"- {maintenant} : `{rel_source}` → `{rel}`" + (f" ({', '.join(tags)})" if tags else "") + "\n")
        nouveau = not c.index.exists()
        with c.index.open("a", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";")
            if nouveau:
                w.writerow(["date", "chemin", "titre", "tags", "resume", "fichier_origine"])
            w.writerow([maintenant, rel, cible.stem, ", ".join(tags), prop.get("resume", ""), rel_source])
        fichier_prop.unlink()
        (c.texte / f"{ident}.txt").unlink(missing_ok=True)


def tour(c: Chemins) -> None:
    c.creer()
    appliquer(c)
    preparer(c)
    lister_dossiers(c)


def proposition_valide(fichier: Path) -> dict | None:
    """Le contenu d'une proposition, ou None si le fichier est illisible ou incomplet."""
    try:
        prop = json.loads(fichier.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return prop if isinstance(prop, dict) and prop.get("titre") and prop.get("statut") in STATUTS | {"refuse"} else None


def nettoyer_propositions(c: Chemins) -> None:
    """Retire les propositions illisibles : le document sera reproposé."""
    for f in c.propositions.glob("*.json"):
        if time.time() - f.stat().st_mtime > 60 and proposition_valide(f) is None:
            log.warning("Proposition illisible retirée : %s", f.name)
            f.unlink(missing_ok=True)


def migrer(c: Chemins) -> None:
    """Reprend l'ancienne installation (<Documents>/_A_TRIER) : journal, index, documents gardés, réglages.
    Les anciennes propositions sont refaites. La boîte d'entrée devient un dossier normal « À trier »."""
    ancien = c.rangement / "_A_TRIER"
    if not ancien.is_dir():
        return
    prefixe = c.rel_rangement()
    avec = (lambda rel: f"{prefixe}/{rel}") if prefixe else (lambda rel: rel)
    log.info("Reprise de l'ancien tri (%s)", ancien)
    c.creer()
    try:
        traitement = ancien / "_traitement"
        anciens_gardes = lire_liste(traitement / "gardes.txt")
        if anciens_gardes:
            with c.gardes.open("a", encoding="utf-8") as f:
                f.writelines(avec(g.replace("_A_TRIER/", "À trier/", 1)) + "\n" for g in anciens_gardes)
        exclusions = [m if "*" in m else avec(m) for m in lire_liste(ancien / "_a_exclure.txt")]
        if exclusions:
            with c.exclure.open("a", encoding="utf-8") as f:
                f.writelines(m + "\n" for m in exclusions)
        if (ancien / "_journal.md").exists():
            with c.journal.open("a", encoding="utf-8") as j:
                j.write((ancien / "_journal.md").read_text(encoding="utf-8"))
        ancien_index = c.rangement / "_index_documents.csv"
        if ancien_index.exists():
            with ancien_index.open(encoding="utf-8", newline="") as f:
                lignes = list(csv.DictReader(f, delimiter=";"))
            nouveau = not c.index.exists()
            with c.index.open("a", encoding="utf-8", newline="") as f:
                w = csv.writer(f, delimiter=";")
                if nouveau:
                    w.writerow(["date", "chemin", "titre", "tags", "resume", "fichier_origine"])
                for l in lignes:
                    w.writerow([l.get("date", ""), avec(l.get("chemin", "")), l.get("titre", ""), l.get("tags", ""),
                                l.get("resume", ""), avec(l.get("fichier_origine", ""))])
            ancien_index.unlink()
        shutil.rmtree(traitement, ignore_errors=True)
        for nom in ("_journal.md", "_a_surveiller.txt", "_a_exclure.txt"):
            (ancien / nom).unlink(missing_ok=True)
        if any(ancien.iterdir()):
            cible = destination_libre(c.rangement, "À trier", "")
            ancien.rename(cible)
            log.info("Les documents de _A_TRIER sont maintenant dans « %s »", cible.name)
        else:
            ancien.rmdir()
    except OSError:
        log.exception("Reprise de l'ancien tri incomplète")
    _scan["signature"] = None


def tour(c: Chemins) -> None:
    c.creer()
    appliquer(c)
    nettoyer_propositions(c)
    preparer(c)
    lister_dossiers(c)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    c = Chemins(RACINE, ETAT, RANGEMENT, IGNORES)
    migrer(c)
    c.creer()
    import proposeur as prop  # propositions par le modèle local
    import web  # page de réglage et de validation (servie par Bêta sur /tri/)

    proposeur = None
    if os.environ.get("TRI_PROPOSITIONS", "oui") != "non":
        import notifications

        proposeur = prop.Proposeur(c, notifications.envoyer)
        proposeur.demarrer()
    web.demarrer(c, proposeur)
    log.info("Tri de %s, rangement dans %s", c.racine, c.rangement)
    while True:
        try:
            tour(c)
        except Exception:
            log.exception("Erreur pendant le tri")
        time.sleep(INTERVALLE)


if __name__ == "__main__":
    main()
