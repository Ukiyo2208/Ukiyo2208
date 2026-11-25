"""Reconnaissance des documents administratifs (factures, fiches de paie, impôts…)
à partir de leur texte : type, catégorie, émetteur, date, montant, échéance.

Utilisé par Paperasse (classement) et Stockage → Rangement (suggestions).
Tout est fait en local, par mots-clés : rien n'est envoyé sur Internet."""

import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from datetime import date, datetime

CATEGORIES = [
    ("Factures", "receipt", "bleu"), ("Impôts", "landmark", "rose"), ("Banque", "chart", "vert"), ("Travail", "briefcase", "violet"),
    ("Santé", "heart", "rose"), ("Logement", "home", "ambre"), ("Assurances", "shield", "bleu-vert"), ("Véhicule", "car", ""),
    ("Identité & famille", "user", "violet"), ("Scolarité", "notebook", "vert"), ("Achats & garanties", "cart", "ambre"), ("Autres", "file", ""),
]
CATEGORY_NAMES = [c[0] for c in CATEGORIES]

# (libellé du type, catégorie, {mot-clé: poids})
TYPES = [
    ("Facture d'énergie", "Factures", {"kwh": 3, "electricite": 2, "fourniture d'energie": 3, "compteur": 1, "gaz naturel": 3, "point de livraison": 3, "pdl": 2, "edf": 2, "engie": 2, "totalenergies": 2}),
    ("Facture internet / téléphone", "Factures", {"forfait": 2, "box": 1, "mobile": 1, "internet": 1, "fibre": 2, "ligne fixe": 2, "go de donnees": 3, "appels": 1, "sms": 1}),
    ("Facture d'eau", "Factures", {"eau potable": 3, "assainissement": 3, "m3": 2, "consommation d'eau": 3}),
    ("Facture", "Factures", {"facture": 3, "total ttc": 2, "montant ttc": 2, "tva": 1, "net a payer": 2, "montant ht": 2, "reglement": 1}),
    ("Avis d'impôt", "Impôts", {"avis d'impot": 4, "impot sur le revenu": 4, "revenu fiscal de reference": 4, "dgfip": 3, "impots.gouv": 3, "finances publiques": 3, "prelevement a la source": 2}),
    ("Taxe foncière", "Impôts", {"taxe fonciere": 6, "proprietes baties": 3}),
    ("Taxe d'habitation", "Impôts", {"taxe d'habitation": 6}),
    ("Relevé de compte", "Banque", {"releve de compte": 4, "releve bancaire": 4, "iban": 2, "solde crediteur": 3, "solde debiteur": 3, "nouveau solde": 3, "ancien solde": 3, "bic": 1}),
    ("Prêt / crédit", "Banque", {"offre de pret": 5, "tableau d'amortissement": 5, "taeg": 3, "credit immobilier": 4, "mensualite": 2}),
    ("Fiche de paie", "Travail", {"bulletin de paie": 6, "bulletin de salaire": 6, "salaire brut": 3, "net a payer avant impot": 4, "cotisations salariales": 3, "conges payes": 2, "net imposable": 2}),
    ("Contrat de travail", "Travail", {"contrat de travail": 6, "periode d'essai": 3, "duree indeterminee": 2, "cdi": 1, "cdd": 1}),
    ("Attestation employeur", "Travail", {"attestation employeur": 5, "certificat de travail": 5, "france travail": 4, "pole emploi": 4}),
    ("Remboursement santé", "Santé", {"assurance maladie": 4, "ameli": 3, "cpam": 3, "decompte": 2, "remboursement": 1, "mutuelle": 3, "tiers payant": 2, "feuille de soins": 4, "complementaire sante": 3}),
    ("Ordonnance", "Santé", {"ordonnance": 4, "posologie": 3, "comprime": 2, "pharmacie": 2, "medecin": 1}),
    ("Compte rendu médical", "Santé", {"laboratoire": 2, "analyses medicales": 3, "compte rendu": 2, "radiologie": 3, "examen": 1}),
    ("Bail", "Logement", {"contrat de location": 5, "bail": 3, "locataire": 3, "bailleur": 3, "depot de garantie": 3}),
    ("Quittance de loyer", "Logement", {"quittance": 5, "loyer": 3, "charges locatives": 2}),
    ("Charges de copropriété", "Logement", {"copropriete": 4, "syndic": 3, "appel de fonds": 4, "tantiemes": 3}),
    ("Assurance", "Assurances", {"attestation d'assurance": 5, "assurance": 2, "assure": 2, "sinistre": 3, "multirisque habitation": 4, "responsabilite civile": 2, "avis d'echeance": 3, "cotisation annuelle": 2}),
    ("Carte grise", "Véhicule", {"certificat d'immatriculation": 6, "carte grise": 6, "immatriculation": 2}),
    ("Entretien du véhicule", "Véhicule", {"controle technique": 5, "vidange": 3, "kilometrage": 2, "pneumatiques": 2, "garage": 2, "vehicule": 1}),
    ("Amende", "Véhicule", {"avis de contravention": 6, "amende forfaitaire": 5, "antai": 5, "infraction": 2}),
    ("Papiers d'identité", "Identité & famille", {"carte nationale d'identite": 6, "passeport": 4, "livret de famille": 6, "acte de naissance": 6, "acte de mariage": 6, "etat civil": 3}),
    ("Allocations", "Identité & famille", {"caf": 3, "allocations familiales": 4, "prime d'activite": 4, "aide au logement": 3, "msa": 2}),
    ("Scolarité", "Scolarité", {"bulletin scolaire": 6, "bulletin trimestriel": 5, "eleve": 2, "academie": 2, "cantine": 3, "diplome": 3, "certificat de scolarite": 6, "universite": 2}),
    ("Ticket / garantie", "Achats & garanties", {"garantie": 3, "ticket de caisse": 4, "bon de commande": 3, "confirmation de commande": 4, "livraison": 1, "facture d'achat": 3, "numero de serie": 2}),
]

ISSUERS = [
    (r"\bedf\b|electricite de france", "EDF"), (r"\bengie\b", "Engie"), (r"totalenergies|total energies|total direct energie", "TotalEnergies"),
    (r"\bekwateur\b", "ekWateur"), (r"\bveolia\b", "Veolia"), (r"\bsuez\b", "Suez"), (r"\borange\b", "Orange"), (r"\bsosh\b", "Sosh"),
    (r"\bsfr\b", "SFR"), (r"\bred by sfr\b", "RED by SFR"), (r"\bfree mobile\b", "Free Mobile"), (r"\bfree\b|freebox", "Free"),
    (r"bouygues telecom|\bbouygues\b", "Bouygues Telecom"), (r"\bb&you\b", "B&You"),
    (r"dgfip|finances publiques|impots\.gouv", "Impôts (DGFiP)"), (r"\burssaf\b", "Urssaf"), (r"\bcaf\b|caisse d'allocations familiales", "CAF"),
    (r"\bcpam\b|assurance maladie|\bameli\b", "Assurance Maladie"), (r"france travail|pole emploi", "France Travail"), (r"\bmsa\b", "MSA"),
    (r"credit agricole", "Crédit Agricole"), (r"\bbnp\b|bnp paribas", "BNP Paribas"), (r"societe generale", "Société Générale"),
    (r"\blcl\b", "LCL"), (r"caisse d'epargne", "Caisse d'Épargne"), (r"banque populaire", "Banque Populaire"), (r"banque postale", "La Banque Postale"),
    (r"boursorama|boursobank", "BoursoBank"), (r"credit mutuel", "Crédit Mutuel"), (r"\bcic\b", "CIC"), (r"hello ?bank", "Hello bank!"),
    (r"\brevolut\b", "Revolut"), (r"\bn26\b", "N26"), (r"\bmaif\b", "MAIF"), (r"\bmacif\b", "MACIF"), (r"\baxa\b", "AXA"), (r"\bmatmut\b", "Matmut"),
    (r"\bmma\b", "MMA"), (r"\ballianz\b", "Allianz"), (r"\bgroupama\b", "Groupama"), (r"\bgmf\b", "GMF"), (r"\bmaaf\b", "MAAF"),
    (r"\bharmonie mutuelle\b", "Harmonie Mutuelle"), (r"\bmgen\b", "MGEN"), (r"\balan\b", "Alan"), (r"\bamazon\b", "Amazon"), (r"\bfnac\b", "Fnac"),
    (r"\bdarty\b", "Darty"), (r"\bboulanger\b", "Boulanger"), (r"leroy merlin", "Leroy Merlin"), (r"\bikea\b", "IKEA"), (r"\bsncf\b", "SNCF"),
    (r"\bantai\b", "ANTAI"), (r"\bnetflix\b", "Netflix"), (r"\bspotify\b", "Spotify"), (r"\bapple\b", "Apple"), (r"\bgoogle\b", "Google"),
]

MONTHS = {"janvier": 1, "janv": 1, "fevrier": 2, "fevr": 2, "fev": 2, "mars": 3, "avril": 4, "avr": 4, "mai": 5, "juin": 6, "juillet": 7,
          "juil": 7, "aout": 8, "septembre": 9, "sept": 9, "octobre": 10, "oct": 10, "novembre": 11, "nov": 11, "decembre": 12, "dec": 12}
DATE_RE = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b|\b(\d{1,2})(?:er)?\s+(" + "|".join(sorted(MONTHS, key=len, reverse=True))
                     + r")\.?\s+(\d{4})\b")
AMOUNT_RE = r"(\d{1,3}(?:[  .]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))\s?(?:€|eur\b|euros?\b)?"
TOTAL_KEYS = r"(?:total ttc|montant ttc|net a payer|montant a payer|total a payer|montant total|reste a payer|solde a payer|net paye|montant du|total facture|montant preleve)"
DUE_KEYS = r"(?:a payer avant|payable avant|date limite(?: de paiement)?|a regler avant|echeance|sera preleve|preleve le|date de prelevement|avant le)"


def plain(text):
    """Minuscules sans accents (pour comparer les mots-clés)."""
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[ \t]+", " ", text.lower().replace("’", "'"))


def parse_date(m):
    try:
        if m.group(1):
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            y += 2000 if y < 100 else 0
        else:
            d, mo, y = int(m.group(4)), MONTHS[m.group(5)], int(m.group(6))
        return date(y, mo, d)
    except (ValueError, KeyError):
        return None


def parse_amount(s):
    s = s.replace(" ", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def find_dates(p):
    today = date.today()
    out = []
    for m in DATE_RE.finditer(p):
        d = parse_date(m)
        if d and date(1950, 1, 1) <= d <= date(today.year + 3, 12, 31):
            out.append((m.start(), d))
    return out


def analyze(text, filename=""):
    """Renvoie {type, category, issuer, date, amount, due, title, confidence, suggested_name}."""
    p = plain(text)
    pf = plain(os.path.splitext(os.path.basename(filename))[0].replace("_", " ").replace("-", " "))
    scores = []
    for label, cat, words in TYPES:
        score = 0
        for w, weight in words.items():
            n = len(re.findall(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", p))
            score += weight * min(n, 3) + (weight if w in pf else 0)
        scores.append((score, label, cat))
    scores.sort(reverse=True)
    best = scores[0]
    kind, category = (best[1], best[2]) if best[0] >= 4 else ("Document", "Autres")
    # Une facture générique est précisée par son émetteur (énergie, télécoms…)
    issuer = next((name for rx, name in ISSUERS if re.search(rx, p[:4000])), None) or first_line_issuer(text)

    dates = find_dates(p)
    doc_date = None
    for m in re.finditer(r"(?:date(?: de| d')? ?(?:facture|emission|edition|document)|emis le|edite le|fait le|date)\s*:?\s*", p):
        near = [d for pos, d in dates if m.end() <= pos <= m.end() + 25]
        if near:
            doc_date = near[0]
            break
    if not doc_date and dates:
        doc_date = dates[0][1]
    due = None
    for m in re.finditer(DUE_KEYS, p):
        near = [d for pos, d in dates if m.end() <= pos <= m.end() + 40]
        if near and (not doc_date or near[0] >= doc_date):
            due = near[0]
            break

    amount = None
    for m in re.finditer(TOTAL_KEYS + r"[^0-9\n]{0,40}" + AMOUNT_RE, p):
        amount = parse_amount(m.group(1))
        if amount:
            break
    if amount is None and category in ("Factures", "Achats & garanties"):
        vals = [parse_amount(m.group(1)) for m in re.finditer(r"(\d[\d  .]*,\d{2})\s?(?:€|eur)", p)]
        vals = [v for v in vals if v]
        amount = max(vals) if vals else None

    if category == "Travail" and kind == "Fiche de paie":
        m = re.search(r"net a payer(?! avant)[^0-9\n]{0,40}" + AMOUNT_RE, p)
        amount = parse_amount(m.group(1)) if m else amount
    confidence = "haute" if best[0] >= 10 else "moyenne" if best[0] >= 4 else "faible"
    title = kind if kind != "Document" else (os.path.splitext(os.path.basename(filename))[0][:60] or "Document")
    return {"type": kind, "category": category, "issuer": issuer, "date": doc_date.isoformat() if doc_date else None,
            "due": due.isoformat() if due else None, "amount": amount, "title": title, "confidence": confidence,
            "score": best[0], "suggested_name": suggested_name(kind, issuer, doc_date, filename)}


def first_line_issuer(text):
    """Faute de nom connu : la première ligne qui ressemble à un nom d'organisme (en-tête)."""
    for line in (text or "").splitlines()[:12]:
        line = line.strip()
        if 3 <= len(line) <= 40 and re.search(r"[A-Za-zÀ-ÿ]{3}", line) and not re.search(r"\d{2}[/.]\d{2}|page|facture|madame|monsieur|@|www\.", line, re.I):
            letters = [c for c in line if c.isalpha()]
            if letters and sum(c.isupper() for c in letters) / len(letters) > .6:
                return " ".join(w.upper() if len(w) <= 3 and w.isalpha() else w.capitalize() for w in line.split())[:40]
    return None


def suggested_name(kind, issuer, d, filename=""):
    ext = os.path.splitext(filename)[1].lower() or ".pdf"
    parts = [d.isoformat() if isinstance(d, date) else (d or datetime.now().strftime("%Y-%m-%d"))]
    parts.append(" - ".join(x for x in (issuer, kind if kind != "Document" else None) if x) or os.path.splitext(os.path.basename(filename))[0] or "Document")
    name = " ".join(parts)
    return re.sub(r'[\\/:*?"<>|]+', " ", name).strip()[:120] + (".pdf" if ext in (".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff") else ext)


# --- Extraction du texte ----------------------------------------------------

def pdf_text(path, max_pages=6):
    try:
        out = subprocess.run(["pdftotext", "-l", str(max_pages), "-layout", path, "-"], capture_output=True, text=True, timeout=60)
        return out.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def ocr_image(path, lang="fra+eng"):
    try:
        out = subprocess.run(["tesseract", path, "stdout", "-l", lang], capture_output=True, text=True, timeout=180)
        return out.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def ocr_pdf(src, dst, sidecar, force=False):
    """PDF → PDF cherchable (OCRmyPDF) + texte. Renvoie True si l'OCR a réussi."""
    cmd = [sys.executable, "-m", "ocrmypdf", "-l", "fra+eng", "--rotate-pages", "--deskew", "--output-type", "pdf",
           "--sidecar", sidecar, "--force-ocr" if force else "--skip-text", "--optimize", "1", src, dst]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        return False
    return proc.returncode in (0, 4, 6)  # 6 = le PDF contenait déjà du texte


def quick_text(path):
    """Texte rapide pour un aperçu : texte du PDF, sinon OCR de la première page seulement."""
    ext = os.path.splitext(path)[1].lower()
    if ext != ".pdf":
        return text_of(path, ocr=ext in (".jpg", ".jpeg", ".png"))
    t = pdf_text(path, max_pages=2)
    if len(t.strip()) >= 40:
        return t
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "p")
        try:
            subprocess.run(["pdftoppm", "-r", "200", "-gray", "-png", "-f", "1", "-l", "1", "-singlefile", path, base], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return t
        return ocr_image(base + ".png") if os.path.exists(base + ".png") else t


def text_of(path, ocr=True):
    """Texte d'un document (PDF, image ou texte), avec OCR si besoin."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        t = pdf_text(path)
        if len(t.strip()) < 40 and ocr:  # PDF scanné : pas de texte
            with tempfile.TemporaryDirectory() as tmp:
                side = os.path.join(tmp, "t.txt")
                if ocr_pdf(path, os.path.join(tmp, "o.pdf"), side, force=True) and os.path.exists(side):
                    t = open(side, encoding="utf-8", errors="replace").read()
        return t
    if ext in (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp") and ocr:
        return ocr_image(path)
    if ext in (".txt", ".md"):
        return open(path, encoding="utf-8", errors="replace").read(200_000)
    if ext in (".docx", ".odt"):
        try:
            import zipfile
            with zipfile.ZipFile(path) as z:
                xml = z.read("word/document.xml" if ext == ".docx" else "content.xml").decode("utf-8", "replace")
            return re.sub(r"<[^>]+>", " ", xml)
        except Exception:  # noqa: BLE001
            return ""
    return ""
