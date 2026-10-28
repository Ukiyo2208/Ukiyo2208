"""Outil « Budget » : les relevés de la banque (CSV, OFX, QIF) importés et rangés par catégorie,
le budget du mois, les charges fixes repérées toutes seules, et des pistes d'économies
(assurances, énergie, box et forfaits, abonnements, frais bancaires, doubles prélèvements…).

Rien n'est envoyé à l'extérieur : pas de connexion à la banque, tout est calculé sur le NAS
à partir des fichiers que tu importes. Chaque compte Bêta Tool a son propre budget."""

import io
import re
import statistics
import time
import unicodedata
import uuid
from collections import defaultdict
from datetime import date, timedelta

from flask import Blueprint, g, jsonify, request

import store

bp = Blueprint("budget", __name__)

CATEGORIES = [  # (nom, icône, couleur)
    ("Revenus", "chart", "vert"), ("Courses", "cart", "vert"), ("Logement", "home", "ambre"), ("Énergie", "flame", "ambre"),
    ("Internet & téléphone", "wifi", "bleu"), ("Assurances", "shield", "bleu-vert"), ("Transports", "car", "violet"), ("Santé", "heart", "rose"),
    ("Restaurants", "utensils", "rose"), ("Abonnements", "play", "violet"), ("Shopping", "tag", "rose"), ("Loisirs", "sparkles", "violet"),
    ("Enfants", "users", "ambre"), ("Impôts", "landmark", "rose"), ("Frais bancaires", "landmark", ""), ("Épargne", "lock", "vert"),
    ("Retraits", "receipt", ""), ("Virements", "send", ""), ("Autres", "file", ""),
]
CAT_NAMES = [c[0] for c in CATEGORIES]
INCOME = {"Revenus"}
NOT_SPENDING = {"Revenus", "Épargne", "Virements"}  # ne comptent pas comme des dépenses

RULES = [  # (motif sur le libellé simplifié, catégorie) : le premier qui correspond gagne
    (r"salaire|\bpaie\b|remuneration|traitement mensuel|pole emploi|france travail|\bcaf\b|allocations? fam|prime d'activite|\bcpam\b|ameli|retraite|pension|carsat|agirc|arrco", "Revenus"),
    (r"livret|ldds|\bldd\b|\blep\b|\bpel\b|assurance vie|epargne|virement.*(livret|epargne)", "Épargne"),
    (r"frais|cotisation (carte|cb|compte)|commission|agios|interets debiteurs|tenue de compte|cotis.*(visa|mastercard|carte)|offre groupee|package", "Frais bancaires"),
    (r"\bdgfip\b|impot|\bdrfip\b|tresor public|taxe (fonciere|habitation)|amende|antai", "Impôts"),
    (r"maif|macif|\baxa\b|matmut|allianz|groupama|\bgmf\b|\bmma\b|\bmaaf\b|generali|direct assurance|l'?olivier|leocare|lovys|\bapril\b|mutuelle|harmonie|malakoff|ag2r|swiss ?life|\bmgen\b|\bcnp\b|cardif|pacifica|\bsogessur\b|assu|alan\b|luko|hiscox|\bbalo?ise\b|\bacheel\b|ornikar assurance|\bclaims\b", "Assurances"),
    (r"\bedf\b|engie|totalenergies|total energies|ekwateur|\beni\b|vattenfall|mint energie|ohm energie|\bgrdf\b|enedis|plenitude|octopus|\bveolia\b|\bsuez\b|eau de|saur\b|fioul|butagaz|primagaz", "Énergie"),
    (r"orange|\bsosh\b|\bsfr\b|red by sfr|bouygues|b ?& ?you|free ?mobile|freebox|\bfree\b|prixtel|la poste mobile|nrj mobile|youprice|coriolis|lebara|syma|cdiscount mobile|auchan telecom", "Internet & téléphone"),
    (r"netflix|spotify|disney|canal\+?|canalplus|deezer|amazon prime|prime video|apple\.com/bill|itunes|icloud|google (storage|one|play)|youtube premium|max\b|hbo|paramount|molotov|dazn|bein|playstation|xbox|nintendo|adobe|microsoft 365|office 365|dropbox|chatgpt|openai|audible|kindle unlimited|ocs\b|salto|crunchyroll|tidal|qobuz|le monde|figaro|mediapart|basic ?fit|fitness park|keep cool|neoness|l'orange bleue", "Abonnements"),
    (r"loyer|foncia|nexity|citya|syndic|copropriete|credit immo|pret immo|echeance pret|bail|quittance|ikea|leroy merlin|castorama|brico|mr bricolage|weldom|point p|boulanger|darty|conforama|but\b", "Logement"),
    (r"carrefour|leclerc|e\.leclerc|auchan|lidl|aldi|intermarche|super u|hyper u|\bu express\b|systeme u|monoprix|franprix|casino|geant|cora\b|match\b|netto|picard|grand frais|biocoop|naturalia|la vie claire|leader price|spar\b|vival|carrefour (city|market|express)|drive|boulangerie|boucherie|primeur|marche|epicerie|thiriet", "Courses"),
    (r"total(?! ?energies)|esso|shell|\bbp\b|avia|dyneff|station|carburant|essence|gazole|peage|sanef|vinci autoroutes|aprr|\bapr\b|area|parking|indigo|onepark|sncf|ratp|navigo|\btcl\b|\btan\b|keolis|transdev|uber(?! ?eats)|bolt|heetch|blablacar|flixbus|ouigo|trainline|air france|easyjet|ryanair|transavia|vueling|volotea|norauto|feu vert|speedy|midas|point s|controle technique|lime|dott|velib", "Transports"),
    (r"pharmacie|pharma|docteur|\bdr\b|medecin|dentiste|kine|osteo|ophtalmo|opticien|optic|krys|afflelou|atol|laboratoire|labo|hopital|clinique|doctolib|orthodont|psycho|infirmier", "Santé"),
    (r"restaurant|resto|brasserie|bistrot|cafe|bar\b|pizz|burger|mcdo|mc ?donald|kfc|quick|subway|starbucks|paul\b|la mie|sushi|kebab|deliveroo|uber ?eats|just ?eat|frichti|o'tacos|buffalo|hippopotamus|flunch|courtepaille|del arte|bk\b|burger king|five guys|domino", "Restaurants"),
    (r"creche|nounou|assistante maternelle|cantine|periscolaire|ecole|college|lycee|garderie|pajemploi|cesu|jouet|king jouet|la grande recre|toys|vertbaudet|cyrillus|okaidi|jacadi|du pareil", "Enfants"),
    (r"cinema|ugc|pathe|gaumont|mk2|fnac|cultura|decathlon|intersport|go sport|musee|concert|ticketmaster|fnac spectacles|theatre|bowling|parc|airbnb|booking|hotel|camping|abritel|gites|steam|epic games|jeux|loisir|piscine|club", "Loisirs"),
    (r"amazon|amzn|cdiscount|zalando|vinted|leboncoin|ebay|aliexpress|shein|temu|zara|h&m|h ?& ?m|kiabi|primark|uniqlo|celio|jules|sephora|nocibe|marionnaud|yves rocher|action\b|gifi|la foir'?fouille|hema|maisons du monde|apple store|fnac|rakuten|veepee|showroomprive", "Shopping"),
    (r"retrait|\bdab\b|\bgab\b|distributeur", "Retraits"),
    (r"^vir\b|virement|vir sepa|vir inst|lydia|paylib|wero|paypal", "Virements"),
]
_RULES = [(re.compile(p), c) for p, c in RULES]

INSURERS = ["maif", "macif", "axa", "matmut", "allianz", "groupama", "gmf", "mma", "maaf", "generali", "direct assurance", "olivier", "leocare", "lovys",
            "april", "harmonie", "malakoff", "ag2r", "swiss life", "mgen", "cnp", "cardif", "pacifica", "sogessur", "alan", "luko", "hiscox", "acheel", "mutuelle"]
INS_TYPES = [  # (motif, type, coût annuel « habituel » indicatif, part d'économie souvent possible)
    (r"emprunteur|\bpret\b|\bcnp\b|cardif|deces|invalidite", "emprunteur", None, .30),
    (r"mutuelle|sante|complementaire|harmonie|mgen|malakoff|alan\b|swiss life", "santé", None, .12),
    (r"auto|vehicule|voiture|moto|scooter|\bvam\b|\bvtm\b", "auto", 650, .15),
    (r"habitation|\bmrh\b|logement|multirisque|\bpno\b|luko|leocare|lovys", "habitation", 250, .15),
    (r"mobile|smartphone|telephone|casse|vol tel|garantie|protection|extension", "appareils", None, .80),
    (r"animal|animaux|chien|chat|santevet|bulle bleue", "animaux", None, .15),
    (r"scolaire|ecole", "scolaire", None, .50),
]
STREAM_VIDEO = r"netflix|disney|canal|prime video|amazon prime|max\b|hbo|paramount|ocs\b|salto|molotov|dazn|bein|crunchyroll|apple tv"
STREAM_MUSIC = r"spotify|deezer|apple music|youtube (premium|music)|tidal|qobuz|amazon music"


def plain(s):
    s = unicodedata.normalize("NFKD", str(s or "").lower()).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip()


NOISE = re.compile(r"\b(cb|carte|paiement|pai|prlv|prelevement|prelev|sepa|vir|virement|recu|emis|inst|instantane|achat|facture|du|le|de|par|en|ref|rum|ics|mandat|ech|"
                   r"x\d{4}|\d{2}[/.]\d{2}([/.]\d{2,4})?|\d{2}h\d{2}|[a-z]*\d[a-z\d]{5,})\b")


def merchant(label):
    """Nom du commerçant tiré du libellé : « CB CARREFOUR MARKET 12/10 » → « carrefour market »."""
    s = NOISE.sub(" ", plain(label))
    s = re.sub(r"[^a-z&' ]", " ", s)
    words = [w for w in s.split() if len(w) > 1][:3]
    return " ".join(words) or plain(label)[:20]


BRANDS = ["RED by SFR", "Bouygues Telecom", "B&You", "Free Mobile", "Freebox", "Orange", "Sosh", "SFR", "Free", "Prixtel", "La Poste Mobile", "NRJ Mobile",
          "EDF", "Engie", "TotalEnergies", "ekWateur", "Eni", "Vattenfall", "Mint Énergie", "Ohm Énergie", "Octopus", "Veolia", "Suez", "Saur",
          "MAIF", "MACIF", "AXA", "Matmut", "Allianz", "Groupama", "GMF", "MMA", "MAAF", "Generali", "Direct Assurance", "L'olivier", "Leocare", "Lovys",
          "April", "Harmonie", "Malakoff", "AG2R", "Swiss Life", "MGEN", "CNP", "Cardif", "Pacifica", "Sogessur", "Alan", "Luko", "Hiscox", "Acheel",
          "Netflix", "Disney+", "Canal+", "Spotify", "Deezer", "Amazon Prime", "Prime Video", "Apple", "iCloud", "Google One", "YouTube Premium",
          "Max", "Paramount+", "DAZN", "beIN", "PlayStation", "Xbox", "Nintendo", "Adobe", "Microsoft 365", "Dropbox", "Audible", "Basic-Fit",
          "Foncia", "Nexity", "Citya", "Carrefour", "Leclerc", "Auchan", "Lidl", "Aldi", "Intermarché", "Monoprix", "Franprix", "Picard",
          "Amazon", "Cdiscount", "Fnac", "Darty", "Boulanger", "Ikea", "Decathlon", "Deliveroo", "Uber Eats", "Uber", "SNCF", "RATP", "Total"]
_BRANDS = [(re.compile(r"(?<![a-z])" + re.escape(plain(b).replace("+", "")).replace(r"\ ", r"\s*") + r"(?![a-z])"), b) for b in BRANDS]
LEGAL = re.compile(r"\b(sa|sas|sasu|sarl|eurl|com|fr|www|clients?|particuliers?|france|services?|ste|societe|ltd|inc|gmbh|europe|payments?|sepa)\b")


def pretty(label, m=None):
    """Nom lisible d'un commerçant : « PRLV SEPA ORANGE SA LIVEBOX » → « Orange »."""
    p = plain(label).replace("+", "")
    for rx, b in _BRANDS:
        if rx.search(p):
            return b
    name = re.sub(r"\s+", " ", LEGAL.sub(" ", m or merchant(label))).strip()
    return name.title() if name else (m or "").title()


def categorize(label, amount, user_rules=()):
    p = plain(label)
    for r in user_rules:
        if plain(r["match"]) in p:
            return r["category"]
    for rx, cat in _RULES:
        if rx.search(p):
            if cat in INCOME and amount < 0:
                continue
            return cat
    return "Revenus" if amount > 0 else "Autres"


# --- Lecture des relevés ----------------------------------------------------------------------------------

def parse_amount(s):
    s = str(s or "").strip().replace(" ", "").replace(" ", "").replace("€", "").replace("EUR", "")
    if not s:
        return None
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.strip("-+()")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(s):
    s = str(s or "").strip()[:10]
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.match(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", s)
        if not m:
            return None
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
        y += 2000 if y < 100 else 0
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def _decode(raw):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def parse_csv(text):
    import csv
    sample = text[:5000]
    delim = max([";", ",", "\t", "|"], key=lambda d: sample.count(d))
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]
    hdr_i, cols = None, {}
    for i, r in enumerate(rows[:30]):
        names = [plain(c) for c in r]
        c = {}
        for j, n in enumerate(names):
            if "date" not in c and re.search(r"^date|date (operation|op|comptable)|^le$", n) and "valeur" not in n:
                c["date"] = j
            elif "date" not in c and n.startswith("date"):
                c["date"] = j
            elif re.search(r"libelle|description|intitule|^operation|^label|^detail|nature|beneficiaire|^tiers|^payee|^memo", n) and "label" not in c:
                c["label"] = j
            elif re.search(r"^debit|^montant debit|^sortie", n):
                c["debit"] = j
            elif re.search(r"^credit|^montant credit|^entree", n):
                c["credit"] = j
            elif re.search(r"^montant|^amount|^somme|^valeur$", n) and "amount" not in c:
                c["amount"] = j
            elif re.search(r"categorie|category", n) and "cat" not in c:
                c["cat"] = j
        if "date" in c and ("amount" in c or "debit" in c or "credit" in c):
            hdr_i, cols = i, c
            break
    body = rows[hdr_i + 1:] if hdr_i is not None else rows
    if hdr_i is None:  # pas d'en-tête : on devine les colonnes au contenu
        sample_rows = [r for r in body[:20] if len(r) >= 3]
        if not sample_rows:
            raise ValueError("Je ne reconnais pas ce fichier : il faut un relevé CSV avec une date, un libellé et un montant.")
        n = max(len(r) for r in sample_rows)
        score = lambda f, j: sum(1 for r in sample_rows if j < len(r) and f(r[j]))
        cols["date"] = max(range(n), key=lambda j: score(parse_date, j))
        nums = [j for j in range(n) if j != cols["date"] and score(lambda v: parse_amount(v) is not None and re.search(r"\d", v), j) >= len(sample_rows) * .6]
        texts = [j for j in range(n) if j != cols["date"] and j not in nums]
        if not nums or not texts:
            raise ValueError("Je ne trouve pas les colonnes date / libellé / montant dans ce fichier.")
        cols["amount"] = nums[0]
        cols["label"] = max(texts, key=lambda j: sum(len(r[j]) for r in sample_rows if j < len(r)))
    out = []
    for r in body:
        get = lambda k: r[cols[k]] if k in cols and cols[k] < len(r) else ""
        d = parse_date(get("date"))
        if not d:
            continue
        if "amount" in cols:
            a = parse_amount(get("amount"))
        else:
            deb, cre = parse_amount(get("debit")), parse_amount(get("credit"))
            a = (cre or 0) - abs(deb or 0) if (deb or cre) else None
        if a is None:
            continue
        label = get("label") or " ".join(c for j, c in enumerate(r) if j not in cols.values())
        out.append({"date": d, "label": re.sub(r"\s+", " ", label).strip()[:200], "amount": round(a, 2), "bank_cat": get("cat")})
    return out


def parse_ofx(text):
    acct = re.search(r"<ACCTID>([^<\r\n]+)", text)
    out = []
    for block in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|</BANKTRANLIST>)", text, re.S):
        tag = lambda t: (re.search(rf"<{t}>([^<\r\n]*)", block) or [None, ""])[1].strip()
        d = tag("DTPOSTED")
        a = parse_amount(tag("TRNAMT").replace(",", "."))
        if len(d) < 8 or a is None:
            continue
        name, memo = tag("NAME"), tag("MEMO")
        label = name if not memo or memo in name else (f"{name} {memo}" if name else memo)
        out.append({"date": f"{d[:4]}-{d[4:6]}-{d[6:8]}", "label": label[:200], "amount": round(a, 2), "fitid": tag("FITID")})
    return out, (acct[1].strip() if acct else "")


def parse_qif(text):
    out, cur = [], {}
    for line in text.splitlines():
        if not line:
            continue
        k, v = line[0], line[1:].strip()
        if k == "D":
            cur["date"] = parse_date(v.replace("'", "/"))
        elif k in "TU":
            cur["amount"] = parse_amount(v)
        elif k == "P":
            cur["label"] = v
        elif k == "M" and not cur.get("label"):
            cur["label"] = v
        elif k == "^":
            if cur.get("date") and cur.get("amount") is not None:
                out.append({"date": cur["date"], "label": (cur.get("label") or "")[:200], "amount": round(cur["amount"], 2)})
            cur = {}
    return out


def parse_file(name, raw):
    text = _decode(raw)
    n = name.lower()
    if n.endswith((".ofx", ".qfx")) or "<OFX>" in text[:2000].upper():
        return parse_ofx(text)
    if n.endswith(".qif") or text.lstrip().startswith("!Type"):
        return parse_qif(text), ""
    return parse_csv(text), ""


# --- Données ------------------------------------------------------------------------------------------

def key(user):
    return "budget/" + re.sub(r"[^\w-]", "_", user)


EMPTY = {"accounts": [], "tx": [], "budgets": {}, "rules": [], "dismissed": [], "imports": []}


def load(user):
    d = store.load(key(user), EMPTY)
    for k, v in EMPTY.items():
        d.setdefault(k, type(v)())
    return d


def _txkey(t):
    return t.get("fitid") or f"{t['date']}|{t['amount']:.2f}|{plain(t['label'])}"


def import_rows(user, rows, account_name, filename=""):
    """Ajoute les opérations sans doublons (même date, montant et libellé déjà là = déjà importée)."""
    added, skipped, out = [], 0, {}

    def go(d):
        nonlocal skipped
        acc = next((a for a in d["accounts"] if a["name"].lower() == account_name.lower()), None)
        if not acc:
            acc = {"id": uuid.uuid4().hex[:8], "name": account_name}
            d["accounts"].append(acc)
        have = defaultdict(int)
        for t in d["tx"]:
            if t["account"] == acc["id"]:
                have[_txkey(t)] += 1
        seen = defaultdict(int)
        for r in rows:
            k = _txkey(r)
            seen[k] += 1
            if seen[k] <= have[k]:
                skipped += 1
                continue
            t = {"id": uuid.uuid4().hex[:10], "date": r["date"], "label": r["label"], "amount": r["amount"], "account": acc["id"],
                 "category": categorize(r["label"], r["amount"], d["rules"]), "note": ""}
            if r.get("fitid"):
                t["fitid"] = r["fitid"]
            d["tx"].append(t)
            added.append(t)
        d["tx"].sort(key=lambda t: t["date"], reverse=True)
        d["imports"].insert(0, {"at": time.time(), "file": filename[:120], "account": acc["name"], "added": len(added), "skipped": skipped})
        d["imports"] = d["imports"][:30]
        out["account"] = acc
    store.update(key(user), EMPTY, go)
    paid = match_papers(added)
    return {"added": len(added), "skipped": skipped, "account": out["account"]["name"], "papers_paid": paid,
            "from": min((t["date"] for t in added), default=None), "to": max((t["date"] for t in added), default=None)}


def match_papers(txs):
    """Une facture de Paperasse « à payer » dont on retrouve le prélèvement (même montant, ±15 jours,
    nom de l'émetteur dans le libellé) est marquée payée."""
    try:
        import paperasse
    except Exception:  # noqa: BLE001
        return []
    paid = []
    for doc in paperasse.load()["docs"].values():
        if doc.get("paid") or not doc.get("amount") or not doc.get("due"):
            continue
        due = date.fromisoformat(doc["due"])
        issuer = plain(doc.get("issuer") or "").split(" ")[0]
        for t in txs:
            if abs(-t["amount"] - doc["amount"]) < .01 and abs((date.fromisoformat(t["date"]) - due).days) <= 15 and (not issuer or len(issuer) < 3 or issuer in plain(t["label"])):
                doc["paid"] = True
                paperasse.save_doc(doc)
                paid.append(doc.get("issuer") or doc.get("title"))
                break
    return paid


# --- Analyses -----------------------------------------------------------------------------------------

def months_back(n, ref=None):
    ref = ref or date.today()
    y, m = ref.year, ref.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def summary(d, month):
    tx = [t for t in d["tx"] if t["date"].startswith(month)]
    spent = defaultdict(float)
    income = 0.0
    for t in tx:
        if t["category"] in INCOME:
            income += t["amount"]
        elif t["category"] not in NOT_SPENDING:
            spent[t["category"]] -= t["amount"]
    total = sum(spent.values())
    return {"month": month, "income": round(income, 2), "spent": round(total, 2), "by_cat": {k: round(v, 2) for k, v in sorted(spent.items(), key=lambda x: -x[1]) if abs(v) >= .005},
            "count": len(tx)}


def recurring(d):
    """Charges fixes : même commerçant, montant proche, à intervalle régulier (mois, trimestre, an)."""
    groups = defaultdict(list)
    for t in d["tx"]:
        if t["amount"] < 0 and t["category"] not in ("Retraits", "Courses", "Restaurants", "Virements", "Shopping") and not (
                re.match(r"(cb|carte)\b", plain(t["label"])) and t["category"] not in ("Abonnements", "Assurances", "Internet & téléphone", "Énergie")):
            groups[merchant(t["label"])].append(t)
    out = []
    for m, ts in groups.items():
        if len(ts) < 2:
            continue
        ts = sorted(ts, key=lambda t: t["date"])
        dates = [date.fromisoformat(t["date"]) for t in ts]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 3]
        if not gaps:
            continue
        gap = statistics.median(gaps)
        period = "mois" if 25 <= gap <= 35 else "trimestre" if 80 <= gap <= 100 else "an" if 340 <= gap <= 390 else "semaine" if 6 <= gap <= 8 else None
        if not period or (period == "mois" and len(ts) < 2):
            continue
        amounts = [-t["amount"] for t in ts]
        med = statistics.median(amounts)
        if med <= 0 or any(abs(a - med) > max(3, med * .35) for a in amounts[-4:]):
            continue
        last = ts[-1]
        per_year = {"semaine": 52, "mois": 12, "trimestre": 4, "an": 1}[period]
        step = {"semaine": 7, "mois": 30, "trimestre": 91, "an": 365}[period]
        nxt = dates[-1] + timedelta(days=round(gap) if period != "mois" else 0)
        if period == "mois":
            y, mo = (dates[-1].year + (dates[-1].month == 12), dates[-1].month % 12 + 1)
            nxt = date(y, mo, min(dates[-1].day, 28))
        active = (date.today() - dates[-1]).days <= step * 1.6 + 5
        first_amount, last_amount = amounts[0], amounts[-1]
        out.append({"merchant": m, "name": pretty(last["label"], m), "label": last["label"], "category": last["category"], "period": period, "amount": round(last_amount, 2),
                    "yearly": round(last_amount * per_year, 2), "monthly": round(last_amount * per_year / 12, 2), "count": len(ts),
                    "first": ts[0]["date"], "last": last["date"], "next": nxt.isoformat() if active else None, "active": active,
                    "increase": round(last_amount - first_amount, 2) if last_amount > first_amount * 1.03 and last_amount - first_amount >= 1 else 0,
                    "increase_pct": round((last_amount / first_amount - 1) * 100) if first_amount and last_amount > first_amount * 1.03 else 0})
    return sorted(out, key=lambda r: -r["yearly"])


def euros(v):
    return f"{v:,.0f} €".replace(",", " ") if abs(v) >= 100 else f"{v:,.2f} €".replace(",", " ").replace(".", ",")


def suggestions(d, today=None):
    """Pistes d'économies avec une estimation annuelle (indicative)."""
    today = today or date.today()
    year_ago = (today - timedelta(days=365)).isoformat()
    rec = [r for r in recurring(d) if r["active"]]
    tx_year = [t for t in d["tx"] if t["date"] >= year_ago]
    history_days = (today - date.fromisoformat(min(t["date"] for t in d["tx"]))).days if d["tx"] else 0
    out = []

    def add(sid, kind, title, text, saving=None, links=(), level="tip"):
        if sid in d["dismissed"]:
            return
        out.append({"id": sid, "kind": kind, "title": title, "text": text, "saving": round(saving) if saving else None, "links": list(links), "level": level})

    # 1. Assurances
    ins = defaultdict(lambda: {"yearly": 0.0, "labels": set(), "first": None, "rec": None})
    for t in tx_year:
        if t["category"] == "Assurances" and t["amount"] < 0:
            m = merchant(t["label"])
            ins[m]["yearly"] -= t["amount"]
            ins[m]["labels"].add(plain(t["label"]))
    for r in rec:
        if r["category"] == "Assurances":
            ins[r["merchant"]]["rec"] = r
            ins[r["merchant"]]["yearly"] = max(ins[r["merchant"]]["yearly"], r["yearly"])
            ins[r["merchant"]]["first"] = r["first"]
    hamon = "Depuis la loi Hamon, une assurance auto, moto ou habitation se résilie à tout moment après un an de contrat, sans frais : c'est le nouvel assureur qui s'occupe de tout."
    kinds, grouped = set(), {}
    for m, info in sorted(ins.items(), key=lambda x: -x[1]["yearly"]):
        if info["yearly"] < 20:
            continue
        text_all = " ".join(info["labels"]) + " " + m
        typ, ref, share = next(((t, ref, s) for rx, t, ref, s in INS_TYPES if re.search(rx, text_all)), ("", None, .12))
        kinds.add(typ)
        if typ in ("auto", "habitation"):
            grouped[m] = info["yearly"]
        name = pretty(next(iter(info["labels"])), m)
        yearly = info["yearly"]
        label = f"assurance {typ}" if typ else "assurance"
        if typ == "emprunteur":
            add(f"ins-{m}", "assurance", f"Assurance de prêt {name} : {euros(yearly)} par an",
                "Depuis la loi Lemoine (2022), l'assurance de ton prêt immobilier se change à tout moment, sans frais, si les garanties sont équivalentes. "
                "Les contrats proposés par les banques sont souvent bien plus chers que ceux des assureurs spécialisés : l'écart se compte parfois en milliers d'euros sur la durée du prêt.",
                yearly * share, [("Assurance emprunteur (service-public.fr)", "https://www.service-public.fr/particuliers/recherche?keyword=assurance+emprunteur+loi+Lemoine")], "good")
        elif typ == "santé":
            add(f"ins-{m}", "assurance", f"Mutuelle {name} : {euros(yearly)} par an",
                "Une complémentaire santé se résilie à tout moment après un an. Vérifie si ton employeur propose une mutuelle d'entreprise (elle est obligatoire et payée au moins à moitié par lui), "
                "et compare les garanties dont tu te sers vraiment (optique, dentaire, hospitalisation) plutôt que de payer pour des options inutiles.",
                yearly * share, [("Résilier sa mutuelle (service-public.fr)", "https://www.service-public.fr/particuliers/recherche?keyword=résilier+complémentaire+santé")])
        elif typ == "appareils":
            add(f"ins-{m}", "assurance", f"Assurance d'appareil {name} : {euros(yearly)} par an",
                "Les assurances de téléphone ou d'électroménager coûtent souvent cher pour ce qu'elles couvrent (franchise, vol « à l'arraché » seulement, vétusté…). "
                "Vérifie les exclusions, et regarde si ton assurance habitation ou ta carte bancaire ne te couvrent pas déjà en partie. Si l'appareil a plus de 2 ans, elle vaut rarement le coup.",
                yearly * share, level="good")
        else:
            bench = f" Pour une {label}, on paie en moyenne autour de {euros(ref)} par an en France : tu es au-dessus." if ref and yearly > ref * 1.25 else ""
            add(f"ins-{m}", "assurance", f"{label.capitalize()} {name} : {euros(yearly)} par an",
                f"{hamon}{bench} Demande 2 ou 3 devis avec les mêmes garanties et la même franchise : on économise souvent 10 à 20 %. "
                "Tu peux aussi d'abord appeler ton assureur avec un devis moins cher : il fait souvent un geste.",
                yearly * share, [("Résilier une assurance (service-public.fr)", "https://www.service-public.fr/particuliers/recherche?keyword=résiliation+assurance+loi+Hamon"),
                                 ("Comparer : LeLynx", "https://www.lelynx.fr"), ("LesFurets", "https://www.lesfurets.com")],
                "good" if bench else "tip")
        if info["rec"] and info["rec"]["increase_pct"] >= 5:
            r = info["rec"]
            add(f"inc-{m}", "hausse", f"{name} a augmenté de {r['increase_pct']} %",
                f"Ta cotisation est passée de {euros(r['amount'] - r['increase'])} à {euros(r['amount'])} par {r['period']}. "
                "Une hausse est le bon moment pour faire jouer la concurrence ou demander un geste à ton assureur.", r["increase"] * {"mois": 12, "trimestre": 4, "an": 1, "semaine": 52}[r["period"]])
    if len(grouped) >= 2:
        total = sum(grouped.values())
        add("ins-group", "assurance", "Regrouper tes assurances auto et habitation",
            f"Ton auto et ton habitation sont chez des assureurs différents ({euros(total)} par an au total). Beaucoup d'assureurs font une remise de 5 à 15 % quand auto et habitation sont chez eux : demande un devis groupé.",
            total * .07)
    try:
        import paperasse
        for doc in paperasse.load()["docs"].values():
            if doc.get("category") == "Assurances" and doc.get("due") and not doc.get("paid"):
                days = (date.fromisoformat(doc["due"]) - today).days
                if 0 <= days <= 75:
                    add(f"ins-due-{doc['id']}", "assurance", f"Échéance {doc.get('issuer') or 'assurance'} le {date.fromisoformat(doc['due']).strftime('%d/%m')}",
                        "Ton contrat se renouvelle bientôt : c'est le bon moment pour comparer. Avec la loi Chatel, tu peux résilier dans les 20 jours après avoir reçu l'avis d'échéance "
                        "(et à tout moment après un an avec la loi Hamon pour l'auto et l'habitation).", (doc.get("amount") or 0) * .15, level="good")
    except Exception:  # noqa: BLE001
        pass

    # 2. Énergie
    energy = [r for r in rec if r["category"] == "Énergie"]
    for r in energy:
        p = plain(r["label"])
        if re.search(r"eau|veolia|suez|saur", p):
            continue
        add(f"nrj-{r['merchant']}", "energie", f"Énergie {r['name']} : {euros(r['yearly'])} par an",
            "Compare ton offre avec le comparateur officiel et gratuit du médiateur national de l'énergie. Vérifie aussi ta puissance souscrite (kVA) : "
            "trop élevée, elle augmente l'abonnement pour rien. L'option heures creuses ne vaut le coup que si tu consommes beaucoup la nuit (chauffe-eau, voiture électrique).",
            r["yearly"] * .10, [("Comparateur officiel énergie-info.fr", "https://www.energie-info.fr")])

    # 3. Box et forfaits
    for r in [r for r in rec if r["category"] == "Internet & téléphone" and r["period"] == "mois"]:
        p = plain(r["label"]) + " " + r["merchant"]
        box = re.search(r"box|fibre|adsl|internet|livebox|freebox|bbox|fixe", p) or r["amount"] >= 28
        target = 25 if box else 10
        if r["amount"] > target + 7:
            add(f"tel-{r['merchant']}", "telecom", f"{'Box' if box else 'Forfait'} {r['name']} : {euros(r['amount'])} par mois",
                ("Les offres fibre sans engagement démarrent souvent autour de 20 à 30 € par mois : les prix « promo la première année » augmentent ensuite. "
                 "Appelle le service client en parlant de résilier : ils proposent souvent une remise.") if box else
                ("Un forfait mobile avec beaucoup de données coûte souvent moins de 10 à 15 € par mois chez les opérateurs à petit prix, sans engagement, et tu gardes ton numéro (code RIO : appelle le 3179)."),
                (r["amount"] - target) * 12, level="good")
        if r["increase_pct"] >= 5:
            add(f"inc-{r['merchant']}", "hausse", f"{r['name']} a augmenté de {r['increase_pct']} %",
                f"Ton forfait est passé de {euros(r['amount'] - r['increase'])} à {euros(r['amount'])} par mois : fin de promotion ou hausse de prix. Une hausse de tarif te permet souvent de résilier sans frais.",
                r["increase"] * 12)

    # 4. Abonnements
    subs = [r for r in rec if r["category"] == "Abonnements"]
    video = [r for r in subs if re.search(STREAM_VIDEO, plain(r["label"]))]
    music = [r for r in subs if re.search(STREAM_MUSIC, plain(r["label"]))]
    if len(video) >= 2:
        tot = sum(r["monthly"] for r in video)
        add("subs-video", "abonnements", f"{len(video)} plateformes vidéo : {euros(tot)} par mois",
            f"Tu paies {', '.join(r['name'] for r in video)}. Astuce : n'en garde qu'une à la fois et change chaque mois selon ce que tu veux regarder (elles sont sans engagement).",
            (tot - max(r["monthly"] for r in video)) * 12, level="good")
    if len(music) >= 2:
        add("subs-music", "abonnements", "Deux abonnements de musique", f"Tu paies {', '.join(r['name'] for r in music)} : un seul suffit, ou passe à une offre famille si vous êtes plusieurs.",
            min(r["monthly"] for r in music) * 12, level="good")
    if subs:
        tot = sum(r["monthly"] for r in subs)
        if tot >= 30:
            add("subs-all", "abonnements", f"Abonnements : {euros(tot)} par mois ({euros(tot * 12)} par an)",
                "Fais le tri : pour chacun, demande-toi si tu t'en es servi le mois dernier. Le paiement à l'année est souvent 15 à 20 % moins cher pour ceux que tu gardes.",
                tot * 12 * .2)

    # 5. Frais bancaires
    fees = [t for t in tx_year if t["category"] == "Frais bancaires" and t["amount"] < 0]
    fee_total = -sum(t["amount"] for t in fees)
    incidents = [t for t in fees if re.search(r"commission|intervention|agios|interets debiteurs|rejet|incident|lettre", plain(t["label"]))]
    if fee_total >= 30:
        scale = 365 / max(30, min(365, history_days)) if history_days else 1
        add("bank-fees", "banque", f"Frais bancaires : {euros(fee_total * scale)} par an",
            "Les banques en ligne proposent souvent un compte et une carte sans frais (sous conditions de revenus ou d'utilisation). Ta banque doit t'aider à changer : "
            "le service de mobilité bancaire transfère tes prélèvements et virements gratuitement.",
            fee_total * scale * .8, [("Changer de banque (service-public.fr)", "https://www.service-public.fr/particuliers/recherche?keyword=mobilité+bancaire")], "good")
    if incidents:
        tot = -sum(t["amount"] for t in incidents)
        add("bank-incidents", "banque", f"Frais de découvert ou d'incident : {euros(tot)}",
            "Appelle ta banque pour demander un remboursement : c'est souvent accepté, surtout la première fois. Une alerte SMS de solde bas ou une autorisation de découvert adaptée évite ces frais.",
            tot, level="good")

    # 6. Doubles prélèvements
    by = defaultdict(list)
    for t in d["tx"]:
        if t["amount"] <= -5 and t["date"] >= (today - timedelta(days=90)).isoformat():
            by[(merchant(t["label"]), t["amount"])].append(t)
    for (m, a), ts in by.items():
        ts.sort(key=lambda t: t["date"])
        for x, y in zip(ts, ts[1:]):
            if (date.fromisoformat(y["date"]) - date.fromisoformat(x["date"])).days <= 2 and x["category"] not in ("Courses", "Restaurants", "Transports", "Retraits", "Virements"):
                add(f"dup-{y['id']}", "doublon", f"Payé deux fois ? {pretty(ts[0]['label'], m)} · {euros(-a)}",
                    f"Deux paiements identiques le {date.fromisoformat(x['date']).strftime('%d/%m')} et le {date.fromisoformat(y['date']).strftime('%d/%m')}. "
                    "Si c'est une erreur, demande le remboursement au commerçant ou conteste auprès de ta banque.", -a, level="warn")

    # 7. Autres hausses (charges fixes)
    for r in rec:
        if r["category"] not in ("Assurances", "Internet & téléphone") and r["increase_pct"] >= 8 and r["period"] in ("mois", "an"):
            add(f"inc-{r['merchant']}", "hausse", f"{r['name']} a augmenté de {r['increase_pct']} %",
                f"Ce prélèvement est passé de {euros(r['amount'] - r['increase'])} à {euros(r['amount'])} par {r['period']}. Vérifie que c'est normal ou cherche moins cher.",
                r["increase"] * (12 if r["period"] == "mois" else 1))

    # 8. Épargne
    months = months_back(4, today)[:-1]
    rest = [summary(d, m) for m in months]
    rest = [s["income"] - s["spent"] for s in rest if s["count"]]
    saving_tx = any(t["category"] == "Épargne" and t["date"] >= (today - timedelta(days=120)).isoformat() for t in d["tx"])
    if len(rest) >= 2 and statistics.mean(rest) >= 150 and not saving_tx:
        add("save-auto", "epargne", f"Il te reste environ {euros(statistics.mean(rest))} par mois",
            "Programme un virement automatique vers un livret réglementé (Livret A, LDDS, LEP si tu y as droit) juste après la paie : l'argent rapporte des intérêts sans impôt et reste disponible.",
            None, [("Livrets réglementés (service-public.fr)", "https://www.service-public.fr/particuliers/recherche?keyword=livret+A+LDDS+LEP")])

    order = {"warn": 0, "good": 1, "tip": 2}
    return sorted(out, key=lambda s: (order[s["level"]], -(s["saving"] or 0)))


# --- Ma journée ---------------------------------------------------------------------------------------

def brief(user, today):
    d = load(user)
    if not d["tx"]:
        return None
    s = summary(d, today.isoformat()[:7])
    over = [f"{c} {euros(s['by_cat'][c])} / {euros(v)}" for c, v in d["budgets"].items() if v and s["by_cat"].get(c, 0) > v]
    sub = f"Budget dépassé : {', '.join(over[:2])}" if over else "Budgets respectés" if d["budgets"] else f"{s['count']} opérations ce mois-ci"
    return {"spent": euros(s["spent"]), "sub": sub}


def start():
    import journee
    journee.SOURCES["budget"] = ("budget", brief)


# --- Routes -------------------------------------------------------------------------------------------

@bp.get("/api/budget")
def overview():
    user = g.user["name"]
    d = load(user)
    month = request.args.get("month") or date.today().isoformat()[:7]
    if d["tx"] and not request.args.get("month") and not any(t["date"].startswith(month) for t in d["tx"]):
        month = d["tx"][0]["date"][:7]  # pas encore d'opérations ce mois-ci : on montre le dernier mois importé
    ref = date.fromisoformat(month + "-15")
    hist = [summary(d, m) | {"by_cat": None} for m in months_back(12, ref)]
    rec = recurring(d)
    try:
        import paperasse
        bills = [{"id": x["id"], "issuer": x.get("issuer") or x.get("title"), "due": x["due"], "amount": x.get("amount")} for x in paperasse.upcoming(45) if x["due"] >= (date.today() - timedelta(days=31)).isoformat()]
        bills.sort(key=lambda x: x["due"])
    except Exception:  # noqa: BLE001
        bills = []
    sugg = suggestions(d)
    return jsonify(month=month, summary=summary(d, month), history=hist, budgets=d["budgets"],
                   categories=[{"name": n, "icon": i, "color": c} for n, i, c in CATEGORIES], accounts=d["accounts"],
                   recurring=[r for r in rec if r["active"]], fixed_monthly=round(sum(r["monthly"] for r in rec if r["active"]), 2),
                   bills=bills, suggestions=sugg, savings=round(sum(s["saving"] or 0 for s in sugg)), count=len(d["tx"]),
                   first=d["tx"][-1]["date"] if d["tx"] else None, last=d["tx"][0]["date"] if d["tx"] else None, imports=d["imports"][:5], rules=d["rules"])


@bp.get("/api/budget/tx")
def list_tx():
    user, a = g.user["name"], request.args
    d = load(user)
    tx = d["tx"]
    if a.get("month"):
        tx = [t for t in tx if t["date"].startswith(a["month"])]
    if a.get("category"):
        tx = [t for t in tx if t["category"] == a["category"]]
    if a.get("account"):
        tx = [t for t in tx if t["account"] == a["account"]]
    q = plain(a.get("q", ""))
    if q:
        tx = [t for t in tx if q in plain(t["label"] + " " + t.get("note", ""))]
    accs = {x["id"]: x["name"] for x in d["accounts"]}
    return jsonify(tx=[t | {"account_name": accs.get(t["account"], "")} for t in tx[:1000]], total=round(sum(t["amount"] for t in tx), 2), count=len(tx))


@bp.post("/api/budget/import")
def import_file():
    user = g.user["name"]
    f = request.files.get("file")
    if not f:
        raise ValueError("Choisis un fichier de relevé (CSV, OFX ou QIF)")
    rows, acct = parse_file(f.filename or "", f.read(20 * 1024 * 1024))
    if not rows:
        raise ValueError("Aucune opération trouvée dans ce fichier. Exporte ton relevé en CSV, OFX ou QIF depuis l'espace client de ta banque.")
    account = (request.form.get("account") or "").strip()[:60] or (f"Compte …{acct[-4:]}" if acct else "Compte courant")
    return jsonify(import_rows(user, rows, account, f.filename or ""))


@bp.post("/api/budget/tx")
def add_tx():
    user, f = g.user["name"], request.get_json(force=True)
    d0 = parse_date(f.get("date")) or date.today().isoformat()
    a = parse_amount(f.get("amount"))
    if a is None or not str(f.get("label") or "").strip():
        raise ValueError("Indique un libellé et un montant")
    if f.get("kind") == "out":
        a = -abs(a)
    row = {"date": d0, "label": str(f["label"]).strip()[:200], "amount": round(a, 2)}
    r = import_rows(user, [row], str(f.get("account") or "Espèces")[:60])
    if f.get("category") in CAT_NAMES:
        def go(d):
            t = next(t for t in d["tx"] if t["date"] == d0 and t["label"] == row["label"] and t["amount"] == row["amount"])
            t["category"] = f["category"]
        store.update(key(user), EMPTY, go)
    return jsonify(r)


@bp.put("/api/budget/tx/<tid>")
def edit_tx(tid):
    user, f = g.user["name"], request.get_json(force=True)
    out = {"changed": 0}

    def go(d):
        t = next((t for t in d["tx"] if t["id"] == tid), None)
        if not t:
            raise ValueError("Opération introuvable")
        if "note" in f:
            t["note"] = str(f["note"] or "")[:300]
        if f.get("category") in CAT_NAMES:
            t["category"] = f["category"]
            out["changed"] = 1
            if f.get("rule"):  # « toujours ranger … dans … » : règle + opérations semblables
                m = str(f.get("match") or merchant(t["label"])).strip()[:60]
                d["rules"] = [r for r in d["rules"] if plain(r["match"]) != plain(m)] + [{"match": m, "category": f["category"]}]
                for x in d["tx"]:
                    if x is not t and plain(m) in plain(x["label"]) and x["category"] != f["category"]:
                        x["category"] = f["category"]
                        out["changed"] += 1
    store.update(key(user), EMPTY, go)
    return jsonify(out)


@bp.delete("/api/budget/tx/<tid>")
def delete_tx(tid):
    user = g.user["name"]
    store.update(key(user), EMPTY, lambda d: d.__setitem__("tx", [t for t in d["tx"] if t["id"] != tid]))
    return jsonify(ok=True)


@bp.put("/api/budget/budgets")
def set_budgets():
    user, f = g.user["name"], request.get_json(force=True)
    clean = {}
    for k, v in (f or {}).items():
        a = parse_amount(v)
        if k in CAT_NAMES and a:
            clean[k] = round(abs(a), 2)
    store.update(key(user), EMPTY, lambda d: d.__setitem__("budgets", clean))
    return jsonify(clean)


@bp.delete("/api/budget/rules/<int:i>")
def delete_rule(i):
    user = g.user["name"]
    store.update(key(user), EMPTY, lambda d: d["rules"].pop(i) if 0 <= i < len(d["rules"]) else None)
    return jsonify(ok=True)


@bp.post("/api/budget/suggestions/<sid>/dismiss")
def dismiss(sid):
    user = g.user["name"]
    store.update(key(user), EMPTY, lambda d: d["dismissed"].append(sid[:80]) if sid not in d["dismissed"] else None)
    return jsonify(ok=True)


@bp.post("/api/budget/suggestions/reset")
def undismiss():
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("dismissed", []))
    return jsonify(ok=True)


@bp.post("/api/budget/recategorize")
def recategorize():
    """Re-classe toutes les opérations avec les règles (utile après une mise à jour)."""
    user = g.user["name"]
    out = {"n": 0}

    def go(d):
        for t in d["tx"]:
            c = categorize(t["label"], t["amount"], d["rules"])
            if c != t["category"]:
                t["category"] = c
                out["n"] += 1
    store.update(key(user), EMPTY, go)
    return jsonify(out)


@bp.delete("/api/budget/accounts/<aid>")
def delete_account(aid):
    user = g.user["name"]

    def go(d):
        d["accounts"] = [a for a in d["accounts"] if a["id"] != aid]
        d["tx"] = [t for t in d["tx"] if t["account"] != aid]
    store.update(key(user), EMPTY, go)
    return jsonify(ok=True)


def count(user):
    return None
