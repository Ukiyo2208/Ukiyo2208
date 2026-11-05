"""Page web du trieur : valider les propositions, choisir les dossiers à trier ou à laisser de côté.

Serveur minimal (bibliothèque standard), joignable seulement depuis Bêta (réseau Docker interne) : c'est
Bêta qui sert la page sur http://IP_DU_NAS:8800/tri/ et qui vérifie qui y accède. Il ne déplace rien
lui-même : il écrit les réglages et les validations, que la boucle du trieur relit d'elle-même.
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import notifications
import trieur

PAGE = Path(__file__).with_name("page.html")
_verrou = threading.Lock()


def _ecrire(fichier: Path, entete: str, lignes: list[str]) -> None:
    """Écriture atomique : la boucle du trieur ne lit jamais un fichier à moitié écrit."""
    tmp = fichier.with_suffix(".tmp")
    tmp.write_text(entete + "".join(f"{l}\n" for l in lignes), encoding="utf-8")
    os.replace(tmp, fichier)


def _entete(fichier: Path) -> str:
    """Les commentaires en tête du fichier sont conservés."""
    if not fichier.exists():
        return ""
    return "".join(l + "\n" for l in fichier.read_text(encoding="utf-8").splitlines() if l.startswith("#"))


def _rel_sur(c: trieur.Chemins, rel: str) -> str:
    """Un chemin relatif propre, forcément à l'intérieur de la racine (les volumes du NAS)."""
    parties = [p for p in str(rel).replace("\\", "/").split("/") if p and p != "."]
    if any(p == ".." for p in parties):
        raise ValueError("chemin interdit")
    chemin = c.racine.joinpath(*parties).resolve()
    if not chemin.is_relative_to(c.racine.resolve()):
        raise ValueError("chemin hors du NAS")
    return "/".join(parties)


def lister_propositions(c: trieur.Chemins) -> list[dict]:
    resultat = []
    for f in sorted(c.propositions.glob("*.json"), key=lambda p: p.stat().st_mtime):
        prop = trieur.proposition_valide(f)
        if prop and prop["statut"] == "propose":
            resultat.append({**prop, "fichier": f.name[:-5]})
    return resultat


def modifier_proposition(c: trieur.Chemins, donnees: dict) -> None:
    ident = str(donnees.get("fichier", ""))
    fichier = c.propositions / f"{ident}.json"
    if "/" in ident or not ident or not fichier.exists():
        raise ValueError("proposition introuvable")
    statut = donnees.get("statut", "propose")
    if statut not in trieur.STATUTS:
        raise ValueError("statut inconnu")
    with _verrou:
        prop = json.loads(fichier.read_text(encoding="utf-8"))
        for cle in ("titre", "dossier"):
            if cle in donnees:
                prop[cle] = str(donnees[cle]).strip()
        if "tags" in donnees:
            prop["tags"] = [str(t).strip().lower() for t in donnees["tags"] if str(t).strip()][:6]
        if statut == "valide":
            trieur.dossier_sur(c, prop.get("dossier", ""))  # refuse tout de suite un dossier invalide
            trieur.titre_sur(prop.get("titre", ""))
        prop["statut"] = statut
        prop.pop("erreur", None)
        tmp = fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(prop, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, fichier)


def etat(c: trieur.Chemins, proposeur=None) -> dict:
    tous = trieur.candidats(c)
    en_attente = [i for i in tous if not (c.propositions / f"{i}.json").exists()]
    return {
        "rangement": c.rel_rangement() or "/",
        "surveilles": trieur.lire_liste(c.surveiller),
        "exclusions": trieur.lire_liste(c.exclure),
        "en_attente": len(en_attente),
        "propositions": len(lister_propositions(c)),  # le même nombre que la liste affichée
        "gardes": trieur.lire_liste(c.gardes),
        "ranges": max(0, sum(1 for _ in c.index.open(encoding="utf-8")) - 1) if c.index.exists() else 0,
        "proposeur": proposeur.etat() if proposeur else None,
        "notifications": notifications.resume(),
    }


def sous_dossiers(c: trieur.Chemins, rel: str) -> list[dict]:
    rel = _rel_sur(c, rel)
    base = c.racine / rel if rel else c.racine
    exclusions = trieur.lire_liste(c.exclure)
    resultat = []
    for d in sorted(base.iterdir(), key=lambda p: p.name.lower()) if base.is_dir() else []:
        chemin = f"{rel}/{d.name}" if rel else d.name
        if not d.is_dir() or not trieur.visible(d.name) or trieur.exclu(chemin, c.ignores):
            continue
        try:
            a_des_sous_dossiers = any(e.is_dir() and trieur.visible(e.name) for e in d.iterdir())
        except OSError:  # dossier sans droit de lecture
            continue
        resultat.append({
            "nom": d.name, "chemin": chemin, "exclu": trieur.exclu(chemin, exclusions),
            "exclu_directement": chemin in exclusions, "a_des_sous_dossiers": a_des_sous_dossiers,
        })
    return resultat


def enregistrer(c: trieur.Chemins, donnees: dict) -> None:
    with _verrou:
        if "tout_trier" in donnees:
            dossiers = ["."] if donnees["tout_trier"] else []
            _ecrire(c.surveiller, _entete(c.surveiller) or trieur.SURVEILLER_PAR_DEFAUT, dossiers)
        if "exclusions" in donnees:
            propres = []
            for e in donnees["exclusions"]:
                e = str(e).strip()
                if e and "*" not in e:
                    e = _rel_sur(c, e)
                if e and e not in propres:
                    propres.append(e)
            _ecrire(c.exclure, _entete(c.exclure) or trieur.EXCLURE_PAR_DEFAUT, propres)
        if "reproposer" in donnees:
            a_retirer = {str(x) for x in donnees["reproposer"]}
            _ecrire(c.gardes, "", [g for g in trieur.lire_liste(c.gardes) if g not in a_retirer])
    trieur._scan["signature"] = None  # prise en compte immédiate


def serveur(c: trieur.Chemins, port: int, proposeur=None, hote: str = "0.0.0.0") -> ThreadingHTTPServer:
    class Gestionnaire(BaseHTTPRequestHandler):
        def log_message(self, *args):  # pas de bruit dans les journaux
            pass

        def _repondre(self, code: int, corps: bytes, type_: str = "application/json") -> None:
            self.send_response(code)
            self.send_header("Content-Type", f"{type_}; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corps)

        def _json(self, code: int, donnees) -> None:
            self._repondre(code, json.dumps(donnees, ensure_ascii=False).encode())

        def do_GET(self):
            url = urlparse(self.path)
            if url.path in ("/", "/index.html"):
                return self._repondre(200, PAGE.read_bytes(), "text/html")
            try:
                if url.path == "/api/etat":
                    return self._json(200, etat(c, proposeur))
                if url.path == "/api/propositions":
                    return self._json(200, lister_propositions(c))
                if url.path == "/api/dossiers":
                    return self._json(200, sous_dossiers(c, parse_qs(url.query).get("chemin", [""])[0]))
            except (ValueError, OSError) as e:
                return self._json(400, {"erreur": str(e)})
            self._json(404, {"erreur": "inconnu"})

        def do_POST(self):
            chemin = urlparse(self.path).path
            if chemin not in ("/api/reglages", "/api/propositions", "/api/lancer", "/api/arreter", "/api/notifications/test"):
                return self._json(404, {"erreur": "inconnu"})
            try:
                taille = min(int(self.headers.get("Content-Length", 0)), 1_000_000)
                donnees = json.loads(self.rfile.read(taille) or b"{}")
                if chemin == "/api/reglages":
                    enregistrer(c, donnees)
                elif chemin == "/api/propositions":
                    modifier_proposition(c, donnees)
                elif chemin == "/api/notifications/test":
                    resultats = notifications.envoyer_maintenant(
                        "Bêta · test", "Les notifications du tri des documents fonctionnent.", os.environ.get("TRI_LIEN", ""))
                    if not resultats:
                        raise ValueError("aucune destination : renseigne NOTIFICATIONS dans .env")
                    erreurs = [f"{notifications.type_de(d)} : {r}" for d, r in resultats.items() if r != "ok"]
                    if erreurs:
                        raise ValueError(" ; ".join(erreurs))
                elif proposeur and chemin == "/api/arreter":
                    proposeur.arreter()
                elif proposeur:
                    proposeur.lancer(donnees.get("nombre", 5), tout=bool(donnees.get("tout")))
            except (ValueError, OSError, trieur.PropositionInvalide) as e:
                return self._json(400, {"erreur": str(e)})
            self._json(200, etat(c, proposeur))

    return ThreadingHTTPServer((hote, port), Gestionnaire)


def demarrer(c: trieur.Chemins, proposeur=None) -> None:
    port = int(os.environ.get("TRI_PORT", "8802"))
    threading.Thread(target=serveur(c, port, proposeur).serve_forever, daemon=True).start()
    trieur.log.info("Page du tri sur le port %d (servie par Bêta sur /tri/)", port)
