"""Outil « Santé » : la santé de la famille, privée pour chaque compte.

- Fiches : date de naissance, groupe sanguin, allergies, traitements, médecin traitant.
- Vaccins : date du dernier, date du prochain rappel (rappels diphtérie-tétanos-polio de l'adulte
  calculés d'après l'âge : 25, 45, 65 ans puis tous les 10 ans), avec rappel.
- Rendez-vous médicaux : ceux de l'Agenda (catégorie Santé ou mots comme dentiste, kiné…).
- Ordonnances : celles déposées dans Paperasse, avec leur date de validité.
- Remboursements : dépenses de santé et remboursements (Assurance maladie, mutuelle) repérés
  dans le Budget et Paperasse, et le reste à charge de l'année."""

import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta

from flask import Blueprint, g, jsonify, request

import activity
import store

bp = Blueprint("sante", __name__)
VACCINES = ["Diphtérie-tétanos-polio (DTP)", "Coqueluche", "Rougeole-oreillons-rubéole (ROR)", "Hépatite B", "Méningocoque", "Pneumocoque",
            "Papillomavirus (HPV)", "Grippe", "Covid-19", "Zona", "Bronchiolite (VRS)", "Fièvre jaune", "Hépatite A", "Typhoïde", "Rage", "BCG (tuberculose)"]
BLOOD = ["", "O+", "O−", "A+", "A−", "B+", "B−", "AB+", "AB−"]
RDV = re.compile(r"m[ée]decin|docteur|\bdr\b|dentiste|kin[ée]|ophtalmo|orthoptiste|gyn[ée]co|p[ée]diatre|dermato|orthodont|ost[ée]o|radio|[ée]chographie|irm|scanner|labo|prise de sang|vaccin|h[ôo]pital|clinique|psy|orl|cardio|sage-femme|podologue|pharmacie|mammographie", re.I)
REFUND = re.compile(r"cpam|ameli|assurance maladie|mutuelle|harmonie|mgen|malakoff|alan\b|swiss ?life|ag2r|apicil|mutualia|axa sant|generali sant|april sant|remb", re.I)
EMPTY = {"members": [], "vaccines": []}


def key(user):
    return "sante/" + re.sub(r"[^\w-]", "_", user)


def load(user):
    d = store.load(key(user), EMPTY)
    for k, v in EMPTY.items():
        d.setdefault(k, type(v)())
    if not d["members"]:
        d["members"] = [{"id": uuid.uuid4().hex[:8], "name": "Moi", "birth": "", "blood": "", "allergies": "", "treatments": "", "doctor": "", "notes": ""}]
    return d


def age(birth, on=None):
    if not birth:
        return None
    b, on = date.fromisoformat(birth), on or date.today()
    return on.year - b.year - ((on.month, on.day) < (b.month, b.day))


def dtp_next(m, vacs):
    """Prochain rappel DTP (calendrier vaccinal) : à 6 et 11 ans, puis à 25, 45 et 65 ans, ensuite tous les 10 ans."""
    if not m.get("birth"):
        return None
    b = date.fromisoformat(m["birth"])
    done = sorted([v["date"] for v in vacs if v["member"] == m["id"] and v["name"].startswith("Diphtérie") and v.get("date")])
    a = age(m["birth"])
    if a is None or a < 5:
        return None
    for target in (6, 11, 25, 45, 65, 75, 85, 95):
        when = date(b.year + target, b.month, min(b.day, 28))
        if when >= date.today() - timedelta(days=365 * 2) and not any(abs((date.fromisoformat(x) - when).days) < 365 * 3 for x in done):
            return {"date": when.isoformat(), "age": target}
    return None


def due_list(d, today=None):
    today = today or date.today()
    out = []
    for v in d["vaccines"]:
        if v.get("next"):
            days = (date.fromisoformat(v["next"]) - today).days
            if days <= 60:
                m = next((x for x in d["members"] if x["id"] == v["member"]), {})
                out.append({"member": m.get("name"), "name": v["name"], "date": v["next"], "days": days})
    for m in d["members"]:
        nx = dtp_next(m, d["vaccines"])
        if nx and (date.fromisoformat(nx["date"]) - today).days <= 60 and not any(v["member"] == m["id"] and v["name"].startswith("Diphtérie") and v.get("next") for v in d["vaccines"]):
            out.append({"member": m["name"], "name": f"Rappel DTP des {nx['age']} ans", "date": nx["date"], "days": (date.fromisoformat(nx["date"]) - today).days})
    return sorted(out, key=lambda x: x["date"])


def appointments(user, days=120):
    try:
        import agenda
        start = datetime.combine(date.today(), datetime.min.time())
        evs = agenda.all_events(user, start, start + timedelta(days=days))
    except Exception:  # noqa: BLE001
        return []
    return [{"title": e["title"], "start": e["start"], "allday": e["allday"], "location": e.get("location"), "uid": e.get("uid")}
            for e in evs if (e.get("category") or "").lower() == "santé" or RDV.search(e.get("title") or "")][:30]


def papers():
    try:
        import paperasse
        docs = list(paperasse.load()["docs"].values())
    except Exception:  # noqa: BLE001
        return [], []
    pres = [{"id": x["id"], "title": x.get("title") or x.get("name"), "issuer": x.get("issuer"), "date": x.get("date"),
             "until": (date.fromisoformat(x["date"]) + timedelta(days=92)).isoformat() if x.get("date") else None}
            for x in docs if x.get("type") == "Ordonnance"]
    refunds = [{"id": x["id"], "title": x.get("title") or x.get("name"), "issuer": x.get("issuer"), "date": x.get("date"), "amount": x.get("amount")}
               for x in docs if x.get("type") == "Remboursement santé"]
    return sorted(pres, key=lambda x: x["date"] or "", reverse=True)[:40], sorted(refunds, key=lambda x: x["date"] or "", reverse=True)[:40]


def money(user, year):
    """Dépenses de santé et remboursements de l'année, d'après les relevés du Budget."""
    try:
        import budget
        tx = [t for t in budget.load(user)["tx"] if t["date"].startswith(str(year))]
    except Exception:  # noqa: BLE001
        return None
    spent = -sum(t["amount"] for t in tx if t["category"] == "Santé" and t["amount"] < 0)
    back = [t for t in tx if t["amount"] > 0 and REFUND.search(t["label"])]
    refunded = sum(t["amount"] for t in back)
    by_month = {}
    for t in tx:
        if t["category"] == "Santé" and t["amount"] < 0:
            by_month.setdefault(t["date"][:7], [0, 0])[0] -= t["amount"]
    for t in back:
        by_month.setdefault(t["date"][:7], [0, 0])[1] += t["amount"]
    return {"spent": round(spent, 2), "refunded": round(refunded, 2), "rest": round(spent - refunded, 2),
            "months": {k: [round(a, 2), round(b, 2)] for k, (a, b) in sorted(by_month.items())},
            "refunds": [{"date": t["date"], "label": t["label"], "amount": t["amount"]} for t in sorted(back, key=lambda t: t["date"], reverse=True)[:20]]}


def brief(user, today):
    d = load(user)
    return [{"text": f"{x['name']} · {x['member']}", "sub": "en retard" if x["days"] < 0 else f"dans {x['days']} j", "late": x["days"] < 0, "link": "#/sante"}
            for x in due_list(d, today) if x["days"] <= 30][:5]


def loop():
    import os
    last = None
    while True:
        time.sleep(1800)
        now = datetime.now()
        if now.hour < 9 or last == now.date():
            continue
        last = now.date()
        try:
            for name in os.listdir(store.path("sante")):
                if not name.endswith(".json"):
                    continue
                user = name[:-5]
                for x in due_list(load(user)):
                    if x["days"] in (30, 7, 0):
                        when = "aujourd'hui" if x["days"] == 0 else "dans %d jours" % x["days"]
                        activity.log(user, "sante", f"Vaccin à faire : {x['name']} ({x['member']}) {when}", "#/sante", title="💉 Vaccin")
        except Exception as e:  # noqa: BLE001
            print("santé", e, flush=True)


def start():
    import os
    os.makedirs(store.path("sante"), exist_ok=True)
    import journee
    journee.SOURCES["health"] = ("sante", brief)
    threading.Thread(target=loop, daemon=True).start()


# --- Routes ---------------------------------------------------------------------------------------------------------

@bp.get("/api/sante")
def overview():
    user = g.user["name"]
    d = load(user)
    pres, refunds = papers()
    year = int(request.args.get("year") or date.today().year)
    members = [m | {"age": age(m.get("birth")), "dtp": dtp_next(m, d["vaccines"]), "vaccines": sorted([v for v in d["vaccines"] if v["member"] == m["id"]], key=lambda v: v.get("date") or "", reverse=True)}
               for m in d["members"]]
    return jsonify(members=members, due=due_list(d), appointments=appointments(user), prescriptions=pres, refund_docs=refunds,
                   money=money(user, year), year=year, vaccine_names=VACCINES, blood=BLOOD)


@bp.post("/api/sante/members")
def add_member():
    user, f = g.user["name"], request.get_json(force=True)
    m = _clean_member(f, {"id": uuid.uuid4().hex[:8]})
    def go(d):
        _ensure(d, user)
        d["members"].append(m)
    store.update(key(user), EMPTY, go)
    return jsonify(m)


def _ensure(d, user):
    if not d.get("members"):
        d["members"] = load(user)["members"]
    return True


def _clean_member(f, old):
    m = dict(old)
    for k, n in (("name", 60), ("allergies", 300), ("treatments", 500), ("doctor", 120), ("notes", 1000), ("blood", 3), ("social", 30), ("mutuelle", 80)):
        if k in f:
            m[k] = str(f[k] or "").strip()[:n]
    if "birth" in f:
        v = str(f["birth"] or "")[:10]
        if v:
            date.fromisoformat(v)
        m["birth"] = v
    if not m.get("name"):
        raise ValueError("Donne un prénom")
    return m


@bp.put("/api/sante/members/<mid>")
def edit_member(mid):
    user, f = g.user["name"], request.get_json(force=True)

    def go(d):
        _ensure(d, user)
        m = next((x for x in d["members"] if x["id"] == mid), None)
        if not m:
            raise ValueError("Personne introuvable")
        m.update(_clean_member(f, m))
    store.update(key(user), EMPTY, go)
    return jsonify(ok=True)


@bp.delete("/api/sante/members/<mid>")
def del_member(mid):
    user = g.user["name"]
    store.update(key(user), EMPTY, lambda d: d.update(members=[x for x in d.get("members", []) if x["id"] != mid], vaccines=[v for v in d.get("vaccines", []) if v["member"] != mid]))
    return jsonify(ok=True)


@bp.post("/api/sante/vaccines")
def add_vaccine():
    user, f = g.user["name"], request.get_json(force=True)
    v = {"id": uuid.uuid4().hex[:8], "member": str(f.get("member") or ""), "name": str(f.get("name") or "").strip()[:80], "note": str(f.get("note") or "")[:200]}
    for k in ("date", "next"):
        x = str(f.get(k) or "")[:10]
        if x:
            date.fromisoformat(x)
        v[k] = x
    if not v["name"] or not v["member"]:
        raise ValueError("Indique le vaccin et la personne")

    def go(d):
        _ensure(d, user)
        d["vaccines"].append(v)
    store.update(key(user), EMPTY, go)
    return jsonify(v)


@bp.delete("/api/sante/vaccines/<vid>")
def del_vaccine(vid):
    store.update(key(g.user["name"]), EMPTY, lambda d: d.__setitem__("vaccines", [v for v in d.get("vaccines", []) if v["id"] != vid]))
    return jsonify(ok=True)


@bp.post("/api/sante/appointments")
def add_appointment():
    """Rendez-vous médical ajouté à l'Agenda (catégorie Santé, rappel la veille et 2 h avant)."""
    import agenda
    f = request.get_json(force=True)
    start = str(f.get("start") or "")[:16]
    if not f.get("title") or not start:
        raise ValueError("Indique le praticien et la date")
    end = (datetime.fromisoformat(start) + timedelta(minutes=int(f.get("minutes") or 30))).strftime("%Y-%m-%dT%H:%M")
    r = agenda.write_event(g.user["name"], "personnel", {"title": str(f["title"])[:120], "start": start, "end": end, "allday": False, "location": str(f.get("location") or "")[:120],
                                                        "reminder": "120", "category": "Santé", "notes": str(f.get("notes") or "")[:500]})
    return jsonify(r)
