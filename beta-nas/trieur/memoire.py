"""La mémoire du tri : ce qui a déjà été trié, et comment tu ranges chaque type de document.

1. Les empreintes : chaque document rangé ou gardé est retenu par une empreinte de son CONTENU
   (SHA-256 du fichier, plus une empreinte du texte). Renommé, déplacé, restauré depuis une
   sauvegarde ou après une réorganisation du NAS, il est reconnu et n'est jamais reproposé.
   Rien n'est écrit dans tes fichiers : c'est une « étiquette » invisible, gardée dans data/tri.

2. Les exemples : pour chaque document validé, le titre, le dossier et les tags que TU as choisis
   (corrections comprises), avec un extrait de son texte. Avant de proposer un nouveau document, le
   modèle reçoit les exemples qui lui ressemblent le plus : deux factures Bouygues finissent dans le
   même dossier, avec la même forme de titre.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path

TEXTE_EXEMPLE = 2500  # caractères gardés par exemple : assez pour reconnaître émetteur et type
MIN_TEXTE_EMPREINTE = 80  # en dessous, le texte est trop pauvre pour reconnaître un document
SEUIL_EXEMPLE = 0.15  # ressemblance minimale pour montrer un exemple au modèle
SEUIL_REFAIRE = 0.45  # après une correction, les propositions en attente aussi proches sont refaites

_MOTS_VIDES = set("""
avec dans pour sans sous vous votre vos nous notre nos leur leurs elle elles sont etre avoir cette ces
celle celui mais donc plus moins tout tous toute toutes aussi comme entre chez page date total montant
merci madame monsieur bonjour ainsi afin lors depuis apres avant tres bien faire fait peut doit sera
the and for with from your this that have will are you our
""".split())


# ---------------------------------------------------------------- Fichiers JSON


def _lire_json(fichier: Path, defaut):
    try:
        return json.loads(fichier.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defaut


def _ecrire_json(fichier: Path, donnees) -> None:
    tmp = fichier.with_suffix(".tmp")
    tmp.write_text(json.dumps(donnees, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, fichier)


# ---------------------------------------------------------------- Empreintes


def empreinte_fichier(fichier: Path) -> str:
    h = hashlib.sha256()
    with fichier.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def _normaliser(texte: str) -> str:
    sans_accents = unicodedata.normalize("NFKD", texte).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", sans_accents.lower()).strip()


def empreinte_texte(texte: str) -> str | None:
    """Même texte (même document ré-enregistré, rescanné en PDF…) = même empreinte. None si trop court."""
    propre = _normaliser(texte)
    if len(propre) < MIN_TEXTE_EMPREINTE or texte.startswith("(aucun texte lisible"):
        return None
    return hashlib.sha256(propre.encode()).hexdigest()


class Empreintes:
    """Cache des empreintes des fichiers du NAS : un fichier n'est relu que s'il a changé."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.cache: dict[str, list] = _lire_json(fichier, {})
        self.modifie = False

    def de(self, racine: Path, rel: str) -> str | None:
        chemin = racine / rel
        try:
            st = chemin.stat()
            cle = [st.st_size, st.st_mtime_ns]
            connu = self.cache.get(rel)
            if connu and connu[:2] == cle:
                return connu[2]
            valeur = empreinte_fichier(chemin)
        except OSError:
            return None
        self.cache[rel] = [*cle, valeur]
        self.modifie = True
        return valeur

    def sauver(self, chemins_presents: set[str] | None = None) -> None:
        if chemins_presents is not None:  # oublie les fichiers disparus
            avant = len(self.cache)
            self.cache = {k: v for k, v in self.cache.items() if k in chemins_presents}
            self.modifie |= len(self.cache) != avant
        if self.modifie:
            _ecrire_json(self.fichier, self.cache)
            self.modifie = False


class Memoire:
    """Les documents déjà triés, reconnus à leur contenu."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        donnees = _lire_json(fichier, {})
        self.fichiers: dict[str, dict] = donnees.get("fichiers", {})  # empreinte -> {chemin, statut, date}
        self.textes: dict[str, str] = donnees.get("textes", {})  # empreinte du texte -> empreinte du fichier

    def connu(self, empreinte: str | None) -> bool:
        return bool(empreinte) and empreinte in self.fichiers

    def texte_connu(self, empreinte: str | None) -> dict | None:
        if not empreinte or empreinte not in self.textes:
            return None
        return self.fichiers.get(self.textes[empreinte])

    def chemins(self) -> set[str]:
        return {v["chemin"] for v in self.fichiers.values()}

    def noter(self, empreinte: str | None, chemin: str, statut: str, emp_texte: str | None = None) -> None:
        """statut : « range » (rangé par Bêta), « garde » (laissé à sa place), « connu » (même contenu qu'un autre)."""
        if not empreinte:
            return
        self.fichiers[empreinte] = {"chemin": chemin, "statut": statut, "date": datetime.now().strftime("%Y-%m-%d")}
        if emp_texte:
            self.textes[emp_texte] = empreinte

    def oublier_chemins(self, chemins: set[str]) -> None:
        """« Re-proposer » un document gardé : on l'oublie."""
        oublies = {e for e, v in self.fichiers.items() if v["chemin"] in chemins}
        self.fichiers = {e: v for e, v in self.fichiers.items() if e not in oublies}
        self.textes = {t: e for t, e in self.textes.items() if e not in oublies}

    def compter(self) -> Counter:
        return Counter(v["statut"] for v in self.fichiers.values())

    def sauver(self) -> None:
        _ecrire_json(self.fichier, {"fichiers": self.fichiers, "textes": self.textes})


# ---------------------------------------------------------------- Exemples et ressemblance


def mots(texte: str) -> set[str]:
    """Les mots qui caractérisent un document (émetteur, type, objet), sans les chiffres ni les mots vides."""
    return {m for m in _normaliser(texte[:TEXTE_EXEMPLE * 2]).split()
            if len(m) >= 4 and not m.isdigit() and not any(ch.isdigit() for ch in m) and m not in _MOTS_VIDES}


class Exemples:
    """Les documents validés, avec ce que tu as choisi pour eux : la « base » à laquelle on compare."""

    def __init__(self, fichier: Path):
        self.fichier = fichier
        self.liste: list[dict] = []
        if fichier.exists():
            for ligne in fichier.read_text(encoding="utf-8").splitlines():
                try:
                    self.liste.append(json.loads(ligne))
                except ValueError:
                    continue
        self._mots: list[set[str]] | None = None  # calculés à la première comparaison
        self._poids: dict[str, float] = {}

    def _preparer(self) -> None:
        if self._mots is not None:
            return
        self._mots = [mots(e.get("texte", "") + " " + e.get("titre", "")) for e in self.liste]
        frequences = Counter(m for ensemble in self._mots for m in ensemble)
        n = len(self.liste) + 1
        self._poids = {m: math.log(1 + n / f) for m, f in frequences.items()}

    def chemins(self) -> set[str]:
        return {e.get("chemin", "") for e in self.liste}

    def ajouter(self, chemin: str, titre: str, dossier: str, tags: list[str], texte: str) -> None:
        exemple = {"chemin": chemin, "titre": titre, "dossier": dossier, "tags": tags,
                   "texte": texte[:TEXTE_EXEMPLE], "date": datetime.now().strftime("%Y-%m-%d")}
        with self.fichier.open("a", encoding="utf-8") as f:
            f.write(json.dumps(exemple, ensure_ascii=False) + "\n")
        self.liste.append(exemple)
        if self._mots is not None:
            self._mots.append(mots(texte + " " + titre))

    def _poids_de(self, m: str) -> float:
        return self._poids.get(m, math.log(1 + (len(self.liste) + 1)))  # mot jamais vu : rare, donc important

    def ressemblance(self, a: set[str], b: set[str]) -> float:
        """Cosinus pondéré : les mots rares (nom de l'émetteur, numéro de client…) comptent plus que « facture »."""
        if not a or not b:
            return 0.0
        self._preparer()
        commun = sum(self._poids_de(m) ** 2 for m in a & b)
        norme = math.sqrt(sum(self._poids_de(m) ** 2 for m in a)) * math.sqrt(sum(self._poids_de(m) ** 2 for m in b))
        return commun / norme if norme else 0.0

    def plus_proches(self, texte: str, n: int = 3, seuil: float = SEUIL_EXEMPLE) -> list[tuple[float, dict]]:
        cible = mots(texte)
        self._preparer()
        scores = sorted(((self.ressemblance(cible, m), e) for m, e in zip(self._mots, self.liste)),
                        key=lambda x: x[0], reverse=True)
        resultat, vus = [], set()
        for score, e in scores:
            cle = (e.get("dossier"), e.get("titre"))
            if score < seuil or len(resultat) >= n:
                break
            if cle not in vus:  # pas deux fois le même exemple
                vus.add(cle)
                resultat.append((score, e))
        return resultat
