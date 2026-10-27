"""Détection des faux mails (hameçonnage) pour l'outil Mails.

Chaque mail reçoit un score à partir d'indices simples et explicables :
  - l'expéditeur se présente comme une marque (Orange, EDF, Ameli, La Poste…) mais écrit
    depuis un autre domaine, ou depuis un domaine qui l'imite (orangeservicelclient.jp) ;
  - le serveur de réception signale un échec SPF / DKIM / DMARC ;
  - adresse d'expéditeur au hasard, extension de domaine inhabituelle, adresse de réponse différente ;
  - liens trompeurs (le texte affiche un site, le lien en ouvre un autre), liens vers une adresse IP ;
  - formules typiques (compte suspendu, colis bloqué, frais de livraison, vérifiez vos informations…) ;
  - pièces jointes dangereuses (page HTML, programme, double extension).
Score ≥ 8 : faux mail (rangé dans Indésirables) ; 4 à 7 : suspect (badge « attention »).
Les expéditeurs présents dans les contacts ou marqués « fiables » ne sont pas pénalisés."""

import ipaddress
import re
from email.utils import getaddresses, parseaddr
from html import unescape
from urllib.parse import urlparse

PHISHING, SUSPECT = 8, 4

# Marque : (motif dans le nom affiché / l'objet, domaines officiels, mot imité dans les faux domaines)
BRANDS = {
    "Orange": (r"orange|sosh", ["orange.fr", "orange.com", "wanadoo.fr", "sosh.fr", "orange-business.com", "orangebank.fr"], "orange"),
    "SFR": (r"sfr|red by sfr", ["sfr.fr", "sfr.com", "red-by-sfr.fr", "sfrbusiness.fr"], "sfr-"),
    "Free": (r"free ?mobile|freebox|free", ["free.fr", "freebox.fr", "free-mobile.fr", "iliad.fr", "proxad.net"], "freebox"),
    "Bouygues Telecom": (r"bouygues", ["bouyguestelecom.fr", "bouyguestelecom.com", "b-and-you.fr"], "bouygues"),
    "EDF": (r"edf", ["edf.fr", "edf.com", "edfoa.fr"], "edf-"),
    "Engie": (r"engie", ["engie.fr", "engie.com"], "engie"),
    "TotalEnergies": (r"total ?energies", ["totalenergies.fr", "totalenergies.com"], "totalenergie"),
    "Ameli / Assurance Maladie": (r"ameli|assurance maladie|cpam|carte vitale", ["ameli.fr", "assurance-maladie.fr", "cpam.fr"], "ameli"),
    "Impôts (DGFiP)": (r"imp[oô]ts|dgfip|finances publiques|tr[ée]sor public", ["impots.gouv.fr", "dgfip.finances.gouv.fr", "finances.gouv.fr"], "impots"),
    "CAF": (r"\bcaf\b|allocations familiales", ["caf.fr", "msa.fr"], "caf-"),
    "ANTAI (amendes)": (r"antai|amende", ["antai.gouv.fr", "amendes.gouv.fr"], "antai"),
    "France Travail": (r"france travail|p[ôo]le emploi", ["francetravail.fr", "pole-emploi.fr"], "pole-emploi"),
    "La Poste / Colissimo": (r"la ?poste|colissimo", ["laposte.fr", "laposte.net", "colissimo.fr", "lbp.fr"], "laposte"),
    "Chronopost": (r"chronopost", ["chronopost.fr", "chronopost.com"], "chronopost"),
    "DHL": (r"\bdhl\b", ["dhl.com", "dhl.fr", "dhl.de"], "dhl-"),
    "UPS": (r"\bups\b", ["ups.com"], "ups-"),
    "Mondial Relay": (r"mondial ?relay", ["mondialrelay.fr", "mondialrelay.com"], "mondialrelay"),
    "Amazon": (r"amazon", ["amazon.fr", "amazon.com", "amazon.de", "amazon.co.uk", "amazon.es", "amazon.it", "marketplace.amazon.fr"], "amazon"),
    "PayPal": (r"pay ?pal", ["paypal.com", "paypal.fr"], "paypal"),
    "Apple": (r"apple|icloud|itunes", ["apple.com", "icloud.com", "me.com", "email.apple.com"], "apple"),
    "Microsoft": (r"microsoft|outlook|office ?365|onedrive", ["microsoft.com", "outlook.com", "office.com", "live.com", "microsoftonline.com", "hotmail.com"], "microsoft"),
    "Google": (r"google|gmail", ["google.com", "gmail.com", "accounts.google.com", "youtube.com"], "google"),
    "Netflix": (r"netflix", ["netflix.com", "mailer.netflix.com"], "netflix"),
    "Disney+": (r"disney", ["disneyplus.com", "disney.com", "disney.fr"], "disney"),
    "Vinted": (r"vinted", ["vinted.fr", "vinted.com"], "vinted"),
    "Leboncoin": (r"leboncoin|le bon coin", ["leboncoin.fr"], "leboncoin"),
    "Crédit Agricole": (r"cr[ée]dit agricole", ["credit-agricole.fr", "credit-agricole.com", "ca-*.fr"], "creditagricole"),
    "BNP Paribas": (r"bnp", ["bnpparibas", "bnpparibas.com", "bnpparibas.net", "mabanque.bnpparibas", "hellobank.fr"], "bnp"),
    "Société Générale": (r"soci[ée]t[ée] g[ée]n[ée]rale", ["societegenerale.fr", "societegenerale.com", "sg.fr"], "societegenerale"),
    "LCL": (r"\blcl\b", ["lcl.fr", "lcl.com"], "lcl-"),
    "La Banque Postale": (r"banque postale", ["labanquepostale.fr", "labanquepostale.com"], "banquepostale"),
    "Caisse d'Épargne": (r"caisse d.[ée]pargne", ["caisse-epargne.fr", "caisse-epargne.com"], "caisse-epargne"),
    "CIC / Crédit Mutuel": (r"\bcic\b|cr[ée]dit mutuel", ["cic.fr", "creditmutuel.fr", "creditmutuel.com"], "creditmutuel"),
    "Boursorama": (r"boursorama|boursobank", ["boursorama.fr", "boursorama.com", "boursobank.com"], "boursorama"),
    "Crit'Air / ANTS": (r"ants|crit.?air|carte grise|permis de conduire", ["ants.gouv.fr", "certificat-air.gouv.fr"], "ants-"),
}
FREE_MAIL = {"gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr", "yahoo.com", "yahoo.fr",
             "icloud.com", "me.com", "laposte.net", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "gmx.com", "gmx.fr", "aol.com", "proton.me", "protonmail.com"}
RISKY_TLD = {"jp", "cn", "ru", "top", "xyz", "icu", "click", "cyou", "shop", "buzz", "rest", "monster", "sbs", "cfd", "tk", "ml", "ga", "cf", "gq", "pw",
             "zip", "mov", "work", "support", "live", "online", "site", "website", "space", "fun", "info", "biz", "vip", "lol", "quest", "bond", "kim", "country"}
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "cutt.ly", "is.gd", "rebrand.ly", "shorturl.at", "ow.ly", "rb.gy", "tiny.cc", "s.id", "t.ly", "lnkd.in"}
URGENT = [
    (r"compte (a été |est |sera )?(suspendu|bloqu[ée]|d[ée]sactiv[ée]|restreint|verrouill[ée])", "compte suspendu ou bloqué"),
    (r"derni(er|ère) (avis|rappel|relance)|avant (suppression|fermeture|résiliation)", "menace de dernier avis"),
    (r"action (requise|imm[ée]diate|urgente)|intervention requise", "action « urgente » demandée"),
    (r"v[ée]rifi(ez|er|e) (vos|tes|votre|ton) (informations|coordonn[ée]es|identit[ée]|compte|donn[ée]es)|confirm(ez|er|e) (votre|ton) (identit[ée]|compte|paiement)", "demande de vérifier tes informations"),
    (r"mett(re|ez|s) à jour (vos|tes|votre|ton) (informations|coordonn[ée]es|moyen de paiement|carte)", "demande de mettre à jour ton paiement"),
    (r"colis (est )?(en attente|bloqu[ée]|retenu|non livr[ée])|tentative de livraison|(frais|droits) de (livraison|douane|r[ée]exp[ée]dition|port)", "colis bloqué / frais à payer"),
    (r"remboursement (en attente|de \d|disponible)|vous (avez droit|êtes éligible) à un remboursement", "remboursement à réclamer"),
    (r"num[ée]ro de (carte|cb)|carte bancaire|code (de s[ée]curit[ée]|cvv|cryptogramme)", "demande de carte bancaire"),
    (r"mot de passe (expire|a expir[ée]|va expirer)|bo[iî]te (mail|aux lettres) (est )?pleine|quota (de stockage )?(atteint|dépassé)", "mot de passe ou boîte « expirée »"),
    (r"(abonnement|paiement|pr[ée]l[èe]vement) (a [ée]t[ée] |est )?(refus[ée]|[ée]chou[ée]|expir[ée]|suspendu|rejet[ée])", "paiement refusé"),
    (r"(dans les|sous) (24|48|72) ?h(eures)?|imm[ée]diatement", "délai très court imposé"),
    (r"facture impay[ée]e|amende (impay[ée]e|major[ée]e)|avis de contravention", "facture ou amende impayée"),
    (r"(vous avez|tu as) (gagn[ée]|[ée]t[ée] s[ée]lectionn[ée])|f[ée]licitations[ !,]|cadeau (gratuit|offert)", "gain ou cadeau inattendu"),
    (r"bitcoin|crypto(monnaie)?|investissement garanti", "argent facile / crypto"),
]
DANGER_EXT = (".exe", ".scr", ".js", ".vbs", ".bat", ".cmd", ".com", ".pif", ".jar", ".msi", ".iso", ".img", ".html", ".htm", ".shtml", ".hta", ".lnk", ".svg")


def domain_of(addr):
    return (addr or "").rsplit("@", 1)[-1].lower().strip(">. ")


def _match(domain, legit):
    for d in legit:
        if "*" in d:
            if re.fullmatch(re.escape(d).replace(r"\*", r"[a-z0-9-]+"), domain) or domain.endswith("." + d.split("*", 1)[1].lstrip("-")):
                return True
        elif domain == d or domain.endswith("." + d):
            return True
    return False


def _random_local(local):
    l = re.sub(r"[._+-]", "", local.lower())
    if len(l) < 9 or not l.isalnum():
        return False
    vowels = sum(c in "aeiouy" for c in l)
    run = max((len(m) for m in re.findall(r"[bcdfghjklmnpqrstvwxz]+", l)), default=0)
    digits = sum(c.isdigit() for c in l)
    words = re.findall(r"(contact|info|service|client|noreply|reply|support|news|bonjour|hello|team|facture|compte)", l)
    return not words and (run >= 5 or vowels / len(l) < 0.2 or (digits >= 3 and len(l) - digits >= 5 and run >= 4)
                          or (len(l) >= 12 and len(set(l)) >= 9 and re.search(r"(.)\1", l) and vowels / len(l) > 0.45))


def _host(url):
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def links(html):
    """[(texte affiché, adresse du lien)] d'un mail HTML."""
    out = []
    for m in re.finditer(r"<a\b[^>]*href\s*=\s*([\"'])(.*?)\1[^>]*>(.*?)</a>", html or "", re.I | re.S):
        text = unescape(re.sub(r"<[^>]+>", "", m[3])).strip()
        out.append((text, unescape(m[2]).strip()))
    return out


def analyze(sender, subject="", text="", html="", reply_to="", auth="", attachments=(), trusted=(), blocked=()):
    """sender : en-tête From brut. Renvoie {level, score, reasons, brand}."""
    name, addr = parseaddr(sender or "")
    addr = addr.lower()
    domain = domain_of(addr)
    local = addr.split("@")[0] if "@" in addr else ""
    reasons, score = [], 0

    def add(points, why):
        nonlocal score
        score += points
        if why not in reasons:
            reasons.append(why)

    trusted = {t.lower() for t in trusted}
    if addr in trusted or ("@" + domain) in trusted:
        return {"level": "ok", "score": 0, "reasons": [], "brand": None, "trusted": True}
    if addr in blocked or ("@" + domain) in blocked:
        add(PHISHING, "tu as signalé cet expéditeur comme faux")

    head = f"{subject}\n{(text or '')[:600]}".lower()
    claimed = None
    official = domain not in FREE_MAIL and any(_match(domain, legit) for _, legit, _ in BRANDS.values())
    for brand, (pat, legit, token) in BRANDS.items():
        if _match(domain, legit):
            continue
        tok = token.strip("-")
        in_name = re.search(rf"\b({pat})\b", (name or "").lower())
        imitates = bool(domain) and ((len(tok) >= 5 and tok in domain) or
                                     (token.endswith("-") and re.search(rf"(^|[.-]){re.escape(tok)}[-.]", domain) is not None))
        if (in_name and not official) or imitates:
            claimed = brand
            if in_name and not official:
                rest = re.sub(rf"\b({pat})\b|\b(service|services|client|clients|clientèle|support|team|équipe|france|fr|info|infos|notification|"
                              r"alerte|sécurité|securite|compte|espace|livraison|colis|facturation|no-?reply)\b|[^\w]", "", (name or "").lower())
                pts = (7 if domain in FREE_MAIL else 5) if not rest else 3  # une entreprise n'écrit jamais depuis une boîte Gmail ou Hotmail
                add(pts, f"se présente comme {brand} mais écrit depuis « {domain or '?'} », qui n'est pas une adresse de {brand}")
            if imitates:
                add(5, f"l'adresse « {domain} » imite {brand}")
            break
        if not official and domain not in FREE_MAIL and re.search(rf"\b({pat})\b", head):
            claimed = brand
            add(2, f"parle de {brand} sans venir de {brand}")
            break

    a = (auth or "").lower()
    if re.search(r"dmarc=fail", a):
        add(5, "l'adresse de l'expéditeur est usurpée (DMARC échoué)")
    if re.search(r"spf=fail", a):
        add(3, "le serveur d'envoi n'est pas autorisé par le domaine (SPF échoué)")
    elif re.search(r"spf=softfail", a):
        add(1, "serveur d'envoi douteux (SPF)")
    if re.search(r"dkim=fail", a):
        add(2, "signature du mail invalide (DKIM échoué)")

    if local and _random_local(local):
        add(2, f"adresse d'expéditeur au hasard (« {local} »)")
    tld = domain.rsplit(".", 1)[-1] if "." in domain else ""
    if tld in RISKY_TLD:
        add(3 if claimed else 1, f"extension de domaine inhabituelle (.{tld})")
    if domain.startswith("xn--") or ".xn--" in domain:
        add(3, "nom de domaine avec des caractères trompeurs")
    shown = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", name or "")
    if shown and shown[0].lower() != addr:
        add(4, f"le nom affiché contient une autre adresse ({shown[0]})")
    rt = [x[1].lower() for x in getaddresses([reply_to or ""]) if x[1]]
    if rt and domain and all(domain_of(r) != domain and not domain_of(r).endswith("." + domain) for r in rt):
        rd = domain_of(rt[0])
        add(3 if rd in FREE_MAIL or claimed else 1, f"les réponses partiraient vers une autre adresse ({rt[0]})")

    other_sites, deceptive = set(), 0
    for shown_text, href in links(html):
        h = _host(href)
        if not h or href.startswith(("mailto:", "tel:", "#")):
            continue
        t = re.search(r"(?:https?://)?((?:[\w-]+\.)+[a-z]{2,})(?:/|\s|$)", shown_text.lower())
        if t and not (h == t[1] or h.endswith("." + t[1]) or t[1].endswith("." + h)) and "." in t[1] and not t[1].endswith((".png", ".jpg")):
            deceptive += 1
        try:
            ipaddress.ip_address(h)
            add(3, "lien vers une adresse IP au lieu d'un site")
        except ValueError:
            pass
        if h in SHORTENERS:
            add(1, "lien raccourci qui cache sa destination")
        other_sites.add(h)
    if deceptive:
        add(4, "lien trompeur : le texte affiche un site mais le lien en ouvre un autre")
    if claimed and other_sites:
        legit = BRANDS[claimed][1]
        if not any(_match(h, legit) for h in other_sites):
            add(2, f"aucun lien ne mène vers un site de {claimed}")

    body = f"{subject}\n{text or ''}\n{re.sub(r'<[^>]+>', ' ', html or '')}".lower()
    hits = 0
    for pat, why in URGENT:
        if re.search(pat, body) and hits < 4:
            hits += 1
            add(1, why)

    for att in attachments or ():
        n = (att or "").lower()
        if re.search(r"\.(pdf|docx?|xlsx?|jpe?g|png|txt)\.(exe|scr|js|vbs|bat|cmd|com|html?|lnk|zip)$", n):
            add(8, f"pièce jointe déguisée (« {att} »)")
        elif n.endswith(DANGER_EXT):
            add(4, f"pièce jointe à risque (« {att} »)")

    level = "phishing" if score >= PHISHING else "suspect" if score >= SUSPECT else "ok"
    return {"level": level, "score": score, "reasons": reasons[:6], "brand": claimed}
