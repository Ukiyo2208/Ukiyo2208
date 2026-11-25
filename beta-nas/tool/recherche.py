"""Sources supplémentaires de la recherche globale (Ctrl K) : tâches, budget, placements, immobilier,
inventaire, entretien, santé, colis, personnes de l'album photo et mails.

Chaque fonction reçoit (q en minuscules, utilisateur) et renvoie au plus quelques résultats
{"type", "title", "sub", "link"}. La recherche des mails interroge les serveurs IMAP : elle est
limitée (boîte de réception, 4 résultats par boîte) et abandonnée si le serveur est lent."""

import unicodedata
from datetime import datetime


def fold(s):
    """Minuscules sans accents, pour que « peage » trouve « Péage »."""
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "").lower()) if unicodedata.category(c) != "Mn")


def hit(q, *fields):
    f = fold(q)
    return any(f in fold(x) for x in fields if x)


def eur(n):
    try:
        return f"{float(n):,.2f} €".replace(",", " ").replace(".", ",")
    except (TypeError, ValueError):
        return ""


def taches(q, user):
    import taches as t
    out = []
    for lst in t.load()["lists"]:
        if not t.visible(lst, user):
            continue
        for i in lst["items"]:
            if not i.get("done") and hit(q, i.get("text"), i.get("title"), i.get("note")):
                out.append({"type": "task", "title": i.get("text") or i.get("title") or "", "sub": lst["name"] + (f" · pour le {i['due']}" if i.get("due") else ""), "link": f"#/taches/{lst['id']}"})
    return out[:6]


def budget(q, user):
    import budget as b
    tx = b.load(user)["tx"]
    found = [x for x in tx if hit(q, x.get("label"), x.get("note"), x.get("category"))]
    found.sort(key=lambda x: x["date"], reverse=True)
    from urllib.parse import quote
    groups = {}  # un résultat par libellé (les prélèvements mensuels ne remplissent pas la liste)
    for x in found:
        groups.setdefault(x["label"], []).append(x)
    out = []
    for label, xs in list(groups.items())[:5]:
        last = xs[0]
        more = f"{len(xs)} opérations · dernière le " if len(xs) > 1 else ""
        out.append({"type": "tx", "title": label, "sub": f"{more}{last['date']} · {eur(last['amount'])} · {last.get('category') or ''}", "link": "#/budget/operations?q=" + quote(label)})
    return out


def patrimoine(q, user):
    import patrimoine as p
    d = p.load(user)
    out = [{"type": "asset", "title": x["name"], "sub": " · ".join(filter(None, [x.get("symbol") or x.get("ticker"), x.get("account"), f"{x.get('qty')} parts"])), "link": "#/patrimoine/placements"}
           for x in d["positions"] if hit(q, x.get("name"), x.get("symbol"), x.get("ticker"), x.get("isin"), x.get("account"))]
    out += [{"type": "asset", "title": x["name"], "sub": "Crédit · " + (x.get("lender") or ""), "link": "#/patrimoine/credits"}
            for x in d["loans"] if hit(q, x.get("name"), x.get("lender"))]
    out += [{"type": "asset", "title": x["name"], "sub": "Bien · " + (x.get("city") or ""), "link": "#/patrimoine/immobilier"}
            for x in d["properties"] if hit(q, x.get("name"), x.get("city"))]
    return out[:6]


def immo(q, user):
    import immo as i
    d = i.load(user)
    out = [{"type": "home", "title": x.get("title") or x.get("url"), "sub": " · ".join(filter(None, [x.get("city"), eur(x.get("price")) if x.get("price") else "", "annonce suivie"])), "link": "#/immo/annonces"}
           for x in d["listings"] if hit(q, x.get("title"), x.get("city"), x.get("url"), x.get("note"))]
    out += [{"type": "home", "title": x["name"], "sub": "Locataire · " + (x.get("address") or ""), "link": "#/immo/location"}
            for x in d["tenants"] if hit(q, x.get("name"), x.get("email"), x.get("address"))]
    return out[:6]


def inventaire(q, user):
    import inventaire as inv
    return [{"type": "item", "title": x["name"], "sub": " · ".join(filter(None, [x.get("brand"), x.get("model"), x.get("room"), x.get("place")])), "link": f"#/inventaire/{x['id']}"}
            for x in inv.load()["items"] if hit(q, x.get("name"), x.get("brand"), x.get("model"), x.get("serial"), x.get("room"), x.get("place"), x.get("notes"), x.get("shop"))][:6]


def entretien(q, user):
    import entretien as e
    out = []
    for it in e.load()["items"]:
        if hit(q, it.get("name"), it.get("details")):
            out.append({"type": "upkeep", "title": it["name"], "sub": it.get("details") or "Équipement", "link": "#/entretien"})
        for t in it.get("tasks", []):
            if hit(q, t.get("name"), t.get("note")) or any(hit(q, h.get("by"), h.get("note")) for h in t.get("history", [])):
                out.append({"type": "upkeep", "title": f"{t['name']} · {it['name']}", "sub": "Entretien", "link": "#/entretien"})
    return out[:6]


def sante(q, user):
    import sante as s
    d = s.load(user)
    names = {m["id"]: m["name"] for m in d["members"]}
    out = [{"type": "health", "title": m["name"], "sub": " · ".join(filter(None, ["Fiche santé", m.get("doctor"), m.get("allergies") and "allergies : " + m["allergies"]])), "link": "#/sante"}
           for m in d["members"] if hit(q, m.get("name"), m.get("doctor"), m.get("allergies"), m.get("treatments"), m.get("notes"))]
    out += [{"type": "health", "title": v["name"], "sub": f"Vaccin · {names.get(v['member'], '')}" + (f" · {v['date']}" if v.get("date") else ""), "link": "#/sante"}
            for v in d["vaccines"] if hit(q, v.get("name"), v.get("note"))]
    return out[:6]


def colis(q, user):
    import colis as c
    return [{"type": "parcel", "title": p.get("label") or p["number"], "sub": f"{c.LABEL.get(p.get('status'), '')} · {p.get('carrier', '')} {p['number']}", "link": "#/colis"}
            for p in c.load(user) if not p.get("archived") and hit(q, p.get("label"), p.get("number"), p.get("carrier"))][:5]


def personnes(q, user):
    import visages as v
    d = v.load()
    out = []
    for p in d["people"]:
        if hit(q, p["name"]):
            x = v._person_public(p, d["faces"])
            out.append({"type": "person", "title": x["name"], "sub": f"{x['count']} photo{'s' if x['count'] > 1 else ''}", "link": f"#/photos/personnes/{x['id']}"})
    return out[:5]


def mails(q, user):
    """Recherche dans la boîte de réception de chaque compte (côté serveur IMAP)."""
    import accounts
    import mail as m
    out = []
    for acc in [a for a in accounts.of(user) if a.get("mail")][:4]:
        try:
            with m.session(acc) as c:
                if not m.select(c, "INBOX"):
                    continue
                uids = [u.decode() for u in m.search_uids(c, q)[:4]]
                for s in m.summaries(c, uids, acc):
                    who = (s["from"][0].get("name") or s["from"][0].get("email")) if s["from"] else ""
                    when = datetime.fromtimestamp(s["date"]).strftime("%d/%m/%Y") if s["date"] else ""
                    out.append({"type": "mail", "title": s["subject"], "sub": " · ".join(filter(None, [who, when, acc.get("name") or acc.get("email")])), "link": f"#/mails/{acc['id']}?uid={s['uid']}"})
        except Exception as e:  # noqa: BLE001  (serveur injoignable : on passe)
            print("recherche mails", e, flush=True)
    return out[:8]


SOURCES = {"taches": taches, "budget": budget, "patrimoine": patrimoine, "immo": immo, "inventaire": inventaire,
           "entretien": entretien, "sante": sante, "colis": colis, "photos": personnes, "mails": mails}
