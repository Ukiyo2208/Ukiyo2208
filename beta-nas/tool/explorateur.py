"""Paperasse « Sur le NAS » : parcourt les dossiers du NAS, reconnaît les papiers qui s'y trouvent et propose de
les ranger dans le bon outil. C'est le remplaçant du trieur automatique de Bêta.

- factures, impôts, fiches de paie, santé (ordonnances, remboursements), logement, assurances… → Paperasse ;
  les documents de santé apparaissent aussi dans l'outil Santé, les échéances dans l'Agenda ;
- relevés bancaires exportés (CSV, OFX, QIF) → Budget ;
- rien ne bouge sans ta validation : « Ajouter » envoie le fichier dans Paperasse (déplacé, ou copié si tu
  préfères garder l'original à sa place), « Ignorer » ne le propose plus.

Reconnaissance locale par mots-clés (doctype.py) ; pour ce qu'elle ne reconnaît pas, l'IA locale du NAS
(Ollama, PAPERASSE_IA_URL) peut aider. Rien ne part sur Internet.

Dossiers parcourus : NAS_DIRS (séparés par « ; »), sinon tout ce qui est monté dans /nas (l'installateur de
Bêta y monte les volumes du NAS). PAPERASSE_IGNORER : chemins jamais parcourus (séparés par « ; »).
Analyse chaque nuit (réglage « heure ») et à la demande."""

import hashlib
import json
import os
import re
import threading
import time
import uuid
from datetime import datetime

from flask import Blueprint, g, jsonify, request, send_file

import activity
import doctype
import store

bp = Blueprint("explorateur", __name__)
NAS_ROOT = os.environ.get("NAS_ROOT", "/nas")
IA_URL = os.environ.get("PAPERASSE_IA_URL", "").rstrip("/")
IA_MODELE = os.environ.get("PAPERASSE_IA_MODELE", "qwen3.5:9b")
DOCS = (".pdf",)
IMAGES = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp")
RELEVES = (".csv", ".ofx", ".qfx", ".qif")
# Images : seulement celles qui ressemblent à un papier (les photos de vacances ne sont pas lues)
IMAGE_PAPIER = re.compile(r"scan|numeris|facture|document|papier|attestation|ordonnance|releve|relevé|contrat|avis|quittance|"
                          r"bulletin|courrier|devis|impot|impôt|fiche|certificat|carte.?grise|justificatif|cerfa", re.I)
CSV_BANQUE = re.compile(r"releve|relevé|compte|banque|operations|opérations|export|transactions|bank|statement", re.I)
SKIP = {"@eaDir", "#recycle", "#snapshot", "@Recycle", "@Recently-Snapshot", ".snapshot", "$RECYCLE.BIN", "lost+found",
        "System Volume Information", "node_modules", "docker", "Docker", "BetaTool", "Sauvegardes", "@docker", "@appstore",
        ".a-valider", ".corbeille", "Plex Media Server", "@tmp", "@sharesnap", ".Trash-1000"}
MAX_TAILLE = 60 * 1024 * 1024
DEFAUT = {"settings": {"actif": True, "deplacer": True, "heure": "02:30", "ocr_max": 40, "ia_max": 30},
          "vus": {}, "props": {}, "empreintes": [], "dernier": None}
_lock = threading.Lock()
_etat = {"en_cours": False, "fichiers": 0, "dossier": "", "debut": None}


def load():
    d = store.load("explorateur", DEFAUT)
    for k, v in DEFAUT.items():
        d.setdefault(k, v if not isinstance(v, dict) else dict(v))
    d["settings"] = {**DEFAUT["settings"], **d.get("settings", {})}
    return d


def update(fn):
    def go(d):
        for k, v in DEFAUT.items():
            d.setdefault(k, v if not isinstance(v, (dict, list)) else type(v)(v))
        return fn(d)
    return store.update("explorateur", json.loads(json.dumps(DEFAUT)), go)


def racines():
    brut = os.environ.get("NAS_DIRS", "")
    if brut.strip():
        return [p.strip() for p in brut.split(";") if p.strip() and os.path.isdir(p.strip())]
    if not os.path.isdir(NAS_ROOT):
        return []
    return sorted(os.path.join(NAS_ROOT, n) for n in os.listdir(NAS_ROOT) if os.path.isdir(os.path.join(NAS_ROOT, n)))


def ignores():
    return [os.path.realpath(p.strip()) for p in os.environ.get("PAPERASSE_IGNORER", "").split(";") if p.strip()]


def affiche(path):
    """Chemin lisible : /nas/volume1/Documents/x.pdf → volume1/Documents/x.pdf"""
    return path[len(NAS_ROOT) + 1:] if path.startswith(NAS_ROOT + "/") else path


def candidat(path, name):
    n = name.lower()
    if n.startswith((".", "~$")):
        return None
    if n.endswith(DOCS):
        return "doc"
    if n.endswith(IMAGES) and IMAGE_PAPIER.search(path):
        return "image"
    if n.endswith(RELEVES) and (not n.endswith(".csv") or CSV_BANQUE.search(name)):
        return "releve"
    return None


def parcourir():
    exclus = ignores()
    for racine in racines():
        for dossier, sous, fichiers in os.walk(racine):
            reel = os.path.realpath(dossier)
            if any(reel == e or reel.startswith(e + os.sep) for e in exclus):
                sous[:] = []
                continue
            sous[:] = [s for s in sous if s not in SKIP and not s.startswith((".", "@", "#"))]
            _etat["dossier"] = affiche(dossier)
            for f in fichiers:
                genre = candidat(os.path.join(dossier, f), f)
                if genre:
                    yield os.path.join(dossier, f), genre


def empreinte(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def demander_ia(texte, nom):
    """L'IA locale dit si c'est un papier à garder et dans quelle catégorie (None si elle ne sait pas)."""
    if not IA_URL or len(texte.strip()) < 80:
        return None
    import requests
    consigne = ("Tu classes des documents pour un particulier français. Réponds en JSON : "
                '{"papier": true/false (document administratif ou personnel à garder : facture, contrat, banque, santé, impôts, '
                'travail, logement, assurance, véhicule, identité, scolarité, garantie), "categorie": une valeur parmi '
                f"{json.dumps(doctype.CATEGORY_NAMES, ensure_ascii=False)}, \"titre\": titre court en français, "
                '"emetteur": organisme ou entreprise, ou ""}.\n\n'
                f"Nom du fichier : {nom}\nTexte :\n{texte[:3500]}")
    try:
        r = requests.post(f"{IA_URL}/api/generate", timeout=240, json={
            "model": IA_MODELE, "prompt": consigne, "format": "json", "stream": False, "think": False,
            "options": {"temperature": 0, "num_ctx": 4096}})
        r.raise_for_status()
        rep = json.loads(r.json().get("response") or "{}")
    except Exception as e:  # noqa: BLE001  (IA arrêtée, modèle absent…)
        print("explorateur ia", e)
        return None
    if not rep.get("papier") or rep.get("categorie") not in doctype.CATEGORY_NAMES or rep["categorie"] == "Autres":
        return None
    return {"category": rep["categorie"], "title": str(rep.get("titre") or "")[:80] or None,
            "issuer": str(rep.get("emetteur") or "")[:60] or None}


def analyser(path, genre, budget):
    """Une proposition pour ce fichier, ou None (pas un papier). budget : OCR et IA restants pour cette analyse."""
    nom = os.path.basename(path)
    if genre == "releve":
        import budget as budget_
        with open(path, "rb") as f:
            lignes, compte = budget_.parse_file(nom, f.read(20 * 1024 * 1024))
        if not lignes:
            return None
        return {"outil": "budget", "titre": f"Relevé bancaire ({len(lignes)} opérations)", "categorie": "Banque",
                "type": "Relevé de compte", "compte": f"Compte …{compte[-4:]}" if compte else "Compte courant",
                "operations": len(lignes), "confiance": "haute"}
    texte = doctype.pdf_text(path, max_pages=3) if genre == "doc" else ""
    if len(texte.strip()) < 40 and budget["ocr"] > 0:  # scan : OCR de la première page seulement
        budget["ocr"] -= 1
        texte = doctype.quick_text(path)
    info = doctype.analyze(texte, nom)
    source = "mots-clés"
    if info["category"] == "Autres" or info["confidence"] == "faible":
        ia = None
        if budget["ia"] > 0 and IA_URL:
            budget["ia"] -= 1
            ia = demander_ia(texte, nom)
        if not ia:
            return None
        info.update({k: v for k, v in ia.items() if v})
        info["type"] = info.get("title") or info["type"]
        info["confidence"], source = "moyenne", "IA locale"
    return {"outil": "paperasse", "titre": info["title"], "categorie": info["category"], "type": info["type"],
            "emetteur": info.get("issuer"), "date": info.get("date"), "montant": info.get("amount"), "echeance": info.get("due"),
            "nom_propose": info.get("suggested_name"), "confiance": info["confidence"], "reconnu_par": source}


def analyse(max_fichiers=20000):
    """Parcourt le NAS et ajoute les nouvelles propositions. Une seule à la fois."""
    with _lock:
        if _etat["en_cours"]:
            return False
        _etat.update(en_cours=True, fichiers=0, dossier="", debut=time.time())
    nouvelles = 0
    try:
        d = load()
        reg = d["settings"]
        budget = {"ocr": int(reg.get("ocr_max", 40)), "ia": int(reg.get("ia_max", 30))}
        vus, connues = d["vus"], set(d["empreintes"])
        props_chemins = {p["chemin"] for p in d["props"].values()}
        a_ecrire_vus, a_ecrire_props, a_ecrire_empreintes = {}, {}, set()
        for path, genre in parcourir():
            _etat["fichiers"] += 1
            if _etat["fichiers"] > max_fichiers:
                break
            try:
                st = os.stat(path)
            except OSError:
                continue
            cle = f"{st.st_size}:{int(st.st_mtime)}"
            if vus.get(path) == cle or path in props_chemins or st.st_size > MAX_TAILLE or st.st_size < 64:
                continue
            if time.time() - st.st_mtime < 120:
                continue  # copie peut-être en cours : la prochaine fois
            a_ecrire_vus[path] = cle
            try:
                emp = empreinte(path)
                if emp in connues or emp in a_ecrire_empreintes:
                    continue  # le même fichier ailleurs, ou déjà ajouté
                p = analyser(path, genre, budget)
            except Exception as e:  # noqa: BLE001  (fichier illisible, PDF abîmé…)
                print("explorateur", path, e)
                continue
            if not p:
                continue
            a_ecrire_empreintes.add(emp)
            pid = uuid.uuid4().hex[:10]
            a_ecrire_props[pid] = {"id": pid, "chemin": path, "affiche": affiche(path), "nom": os.path.basename(path),
                                   "taille": st.st_size, "modifie": st.st_mtime, "trouve": time.time(), "empreinte": emp, **p}
            nouvelles += 1
            if len(a_ecrire_vus) >= 200:  # on enregistre au fil de l'eau : une coupure ne fait pas tout recommencer
                _enregistrer(a_ecrire_vus, a_ecrire_props, a_ecrire_empreintes)
                a_ecrire_vus, a_ecrire_props, a_ecrire_empreintes = {}, {}, set()
        _enregistrer(a_ecrire_vus, a_ecrire_props, a_ecrire_empreintes, fin=True)
        if nouvelles:
            activity.log("*", "paperasse", f"{nouvelles} papier{'s' if nouvelles > 1 else ''} trouvé{'s' if nouvelles > 1 else ''} "
                         "sur le NAS : à vérifier avant de les ranger", "#/paperasse/nas", title="📄 Paperasse · sur le NAS")
    finally:
        _etat.update(en_cours=False, dossier="")
    return nouvelles


def _enregistrer(vus, props, empreintes, fin=False):
    def go(d):
        d["vus"].update(vus)
        d["props"].update(props)
        d["empreintes"] = sorted(set(d["empreintes"]) | empreintes)
        if fin:
            d["dernier"] = {"fin": time.time(), "fichiers": _etat["fichiers"], "duree": round(time.time() - (_etat["debut"] or time.time()))}
    update(go)


def lancer():
    if _etat["en_cours"]:
        return False
    threading.Thread(target=analyse, daemon=True).start()
    return True


def boucle():
    fait = None
    while True:
        time.sleep(60)
        reg = load()["settings"]
        maintenant = datetime.now()
        if reg.get("actif") and maintenant.strftime("%H:%M") >= reg.get("heure", "02:30") and fait != maintenant.date():
            fait = maintenant.date()
            try:
                analyse()
            except Exception as e:  # noqa: BLE001
                print("explorateur", e)


def start():
    threading.Thread(target=boucle, daemon=True).start()


# --- Ajouter / ignorer -----------------------------------------------------------------------------

def accepter(pid, user, categorie=None):
    d = load()
    p = d["props"].get(pid)
    if not p:
        raise ValueError("Proposition introuvable (déjà traitée ?)")
    if not os.path.exists(p["chemin"]):
        update(lambda x: x["props"].pop(pid, None))
        raise ValueError(f"« {p['nom']} » n'est plus à sa place sur le NAS")
    deplacer = d["settings"].get("deplacer", True)
    if p["outil"] == "budget":
        import budget
        with open(p["chemin"], "rb") as f:
            lignes, _ = budget.parse_file(p["nom"], f.read(20 * 1024 * 1024))
        r = budget.import_rows(user, lignes, p.get("compte") or "Compte courant", p["nom"])
        resultat = {"outil": "Budget", "detail": f"{r.get('added', 0)} opération(s) ajoutée(s) dans {r.get('account')}"}
    else:
        import paperasse
        preset = {"category": categorie if categorie in doctype.CATEGORY_NAMES else p["categorie"]}
        paperasse.ingest_file(p["chemin"], user, "nas", move=deplacer, preset=preset)
        resultat = {"outil": "Paperasse", "detail": "rangé dans " + preset["category"]}

    def go(x):
        x["props"].pop(pid, None)
        x["vus"].pop(p["chemin"], None) if deplacer and p["outil"] == "paperasse" else None
    update(go)
    return resultat


def ignorer(pid):
    def go(x):
        p = x["props"].pop(pid, None)
        if p:
            x["empreintes"] = sorted(set(x["empreintes"]) | {p["empreinte"]})
        return p
    return update(go)


def etat(limite=500):
    d = load()
    props = sorted(d["props"].values(), key=lambda p: (p["outil"] != "budget", p.get("categorie") or "", -(p.get("modifie") or 0)))
    return {"propositions": props[:limite], "total": len(d["props"]), "settings": d["settings"], "dernier": d["dernier"],
            "en_cours": dict(_etat), "racines": [affiche(r) for r in racines()], "ia": bool(IA_URL), "analyses": len(d["vus"]),
            "par_categorie": {c: sum(1 for p in d["props"].values() if p.get("categorie") == c) for c in doctype.CATEGORY_NAMES}}


# --- Routes (administrateurs seulement : elles voient tous les fichiers du NAS) ------------------------

@bp.before_request
def reserve_admin():
    if not g.user or g.user.get("role") != "admin":
        raise PermissionError("Réservé aux administrateurs : « Sur le NAS » voit tous les dossiers du NAS")


@bp.get("/api/explorateur")
def route_etat():
    return jsonify(etat())


@bp.post("/api/explorateur/analyser")
def route_analyser():
    if not racines():
        raise ValueError("Aucun dossier du NAS n'est accessible à Bêta Tool : relance l'installateur de Bêta (volumes du NAS)")
    return jsonify(lance=lancer(), en_cours=dict(_etat))


def _proposition(pid):
    p = load()["props"].get(pid)
    if not p or not os.path.exists(p["chemin"]):
        raise ValueError("Fichier introuvable")
    return p


@bp.get("/api/explorateur/<pid>/fichier")
def route_fichier(pid):
    p = _proposition(pid)
    return send_file(p["chemin"], download_name=p["nom"], as_attachment=request.args.get("dl") == "1")


@bp.get("/api/explorateur/<pid>/miniature")
def route_miniature(pid):
    import paperasse
    p = _proposition(pid)
    image = os.path.join(paperasse.THUMBS, "nas-" + pid + ".jpg")
    if not os.path.exists(image):
        if p["nom"].lower().endswith(".pdf"):
            paperasse.thumb("nas-" + pid, p["chemin"])
        elif p["nom"].lower().endswith(IMAGES):
            from PIL import Image, ImageOps
            os.makedirs(paperasse.THUMBS, exist_ok=True)
            im = ImageOps.exif_transpose(Image.open(p["chemin"])).convert("RGB")
            im.thumbnail((480, 680))
            im.save(image, "JPEG", quality=80)
    if not os.path.exists(image):
        return "", 404
    rep = send_file(image, mimetype="image/jpeg")
    rep.headers["Cache-Control"] = "max-age=86400"
    return rep


@bp.post("/api/explorateur/accepter")
def route_accepter():
    d = request.get_json(silent=True) or {}
    ids = d.get("ids") or []
    faits, erreurs = [], []
    for pid in ids[:500]:
        try:
            faits.append(accepter(pid, g.user["name"], (d.get("categories") or {}).get(pid)))
        except Exception as e:  # noqa: BLE001
            erreurs.append(str(e))
    return jsonify(faits=len(faits), erreurs=erreurs[:10])


@bp.post("/api/explorateur/ignorer")
def route_ignorer():
    ids = (request.get_json(silent=True) or {}).get("ids") or []
    return jsonify(ignores=sum(1 for pid in ids[:2000] if ignorer(pid)))


@bp.put("/api/explorateur/reglages")
def route_reglages():
    f = request.get_json(silent=True) or {}

    def go(d):
        s = d["settings"]
        if "actif" in f:
            s["actif"] = bool(f["actif"])
        if "deplacer" in f:
            s["deplacer"] = bool(f["deplacer"])
        if re.fullmatch(r"\d{2}:\d{2}", str(f.get("heure", ""))):
            s["heure"] = f["heure"]
        for k, maxi in (("ocr_max", 500), ("ia_max", 200)):
            if k in f:
                s[k] = max(0, min(maxi, int(f[k] or 0)))
        return s
    return jsonify(update(go))


def resume():
    """Pour l'API externe (Bêta, Home Assistant) : propositions en attente et dernière analyse."""
    d = load()
    return {"propositions": len(d["props"]), "dernier": d["dernier"], "en_cours": _etat["en_cours"]}
