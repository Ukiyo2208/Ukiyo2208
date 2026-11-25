"""Énergie : consommation par appareil et coût en euros (aujourd'hui, hier, ce mois-ci, 30 derniers jours),
d'après les capteurs d'énergie (kWh) et de puissance (W) de Home Assistant et ses statistiques longues.

Le compteur général (Linky, compteur, total…) est montré à part pour ne pas compter deux fois la maison et
ses prises. Prix du kWh : PRIX_KWH dans .env. Et l'historique des capteurs pour les graphiques des fiches.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

_GENERAL = re.compile(r"linky|compteur|general|général|total|maison|grid|reseau|réseau|edf|enedis|teleinfo|téléinfo|"
                      r"house|home_energy|consommation_totale", re.I)
_FACTEURS = {"wh": 0.001, "kwh": 1.0, "mwh": 1000.0}
_FACTEURS_W = {"w": 1.0, "kw": 1000.0}


def _nombre(valeur):
    try:
        n = float(valeur)
        return n if n == n else None  # NaN
    except (TypeError, ValueError):
        return None


def capteurs(appareils: list[dict]) -> tuple[list[dict], list[dict]]:
    """(capteurs d'énergie en kWh, capteurs de puissance en W) utilisables."""
    energie, puissance = [], []
    for a in appareils:
        if not a["id"].startswith("sensor.") or a.get("etat") in ("unavailable", "unknown"):
            continue
        at = a.get("attr") or {}
        unite = str(at.get("unit_of_measurement") or "").lower()
        if at.get("device_class") == "energy" and unite in _FACTEURS:
            energie.append({**a, "facteur": _FACTEURS[unite], "general": bool(_GENERAL.search(f"{a['id']} {a['nom']}"))})
        elif at.get("device_class") == "power" and unite in _FACTEURS_W:
            puissance.append({**a, "facteur": _FACTEURS_W[unite], "general": bool(_GENERAL.search(f"{a['id']} {a['nom']}"))})
    return energie, puissance


def _jour(debut) -> str:
    """Date locale (AAAA-MM-JJ) du début d'une période de statistiques (millisecondes ou ISO)."""
    if isinstance(debut, (int, float)):
        return datetime.fromtimestamp(debut / 1000).astimezone().date().isoformat()
    return datetime.fromisoformat(str(debut).replace("Z", "+00:00")).astimezone().date().isoformat()


def bilan(appareils: list[dict], stats: dict[str, list[dict]], prix_kwh: float, aujourdhui: str | None = None) -> dict:
    """Ce qu'affiche la page Énergie. `stats` : statistiques journalières de Home Assistant ({id: [{start, change}]})."""
    aujourdhui = aujourdhui or datetime.now().astimezone().date().isoformat()
    hier = (datetime.fromisoformat(aujourdhui) - timedelta(days=1)).date().isoformat()
    mois = aujourdhui[:7]
    energie, puissance = capteurs(appareils)

    lignes, jours_total, jours_general = [], {}, {}
    for c in energie:
        par_jour: dict[str, float] = {}
        for point in stats.get(c["id"], []):
            change = _nombre(point.get("change"))
            if change is None or change < 0:
                continue
            j = _jour(point.get("start"))
            par_jour[j] = par_jour.get(j, 0) + change * c["facteur"]
        cible = jours_general if c["general"] else jours_total
        for j, v in par_jour.items():
            cible[j] = cible.get(j, 0) + v
        lignes.append({
            "id": c["id"], "nom": c["nom"], "piece": c.get("piece", ""), "appareil": c.get("appareil"), "general": c["general"],
            "aujourdhui": round(par_jour.get(aujourdhui, 0), 3), "hier": round(par_jour.get(hier, 0), 3),
            "mois": round(sum(v for j, v in par_jour.items() if j.startswith(mois)), 3),
            "total": _nombre(c.get("etat")) * c["facteur"] if _nombre(c.get("etat")) is not None else None,
        })
    lignes.sort(key=lambda l: (not l["general"], -l["mois"], -l["aujourdhui"]))
    jours = jours_general or jours_total  # le compteur général s'il existe, sinon la somme des appareils
    serie = []
    debut = datetime.fromisoformat(aujourdhui) - timedelta(days=29)
    for i in range(30):
        j = (debut + timedelta(days=i)).date().isoformat()
        serie.append({"jour": j, "kwh": round(jours.get(j, 0), 3), "euros": round(jours.get(j, 0) * prix_kwh, 2)})

    puissances = [{"id": p["id"], "nom": p["nom"], "piece": p.get("piece", ""), "general": p["general"],
                   "watts": round(_nombre(p["etat"]) * p["facteur"])} for p in puissance if _nombre(p["etat"]) is not None]
    puissances.sort(key=lambda p: (not p["general"], -p["watts"]))
    generale = next((p["watts"] for p in puissances if p["general"]), None)

    def somme(cle):
        if jours_general:
            return sum(l[cle] for l in lignes if l["general"])
        return sum(l[cle] for l in lignes if not l["general"])

    resume = {cle: {"kwh": round(somme(cle), 2), "euros": round(somme(cle) * prix_kwh, 2)} for cle in ("aujourdhui", "hier", "mois")}
    return {"prix_kwh": prix_kwh, "resume": resume, "jours": serie, "appareils": lignes,
            "puissance": {"maintenant": generale if generale is not None else sum(p["watts"] for p in puissances if not p["general"]),
                          "source": "compteur général" if generale is not None else "somme des appareils", "detail": puissances[:30]},
            "compteur_general": bool(jours_general) or generale is not None}


def points_historique(historique: list[dict], maximum: int = 240) -> list[list]:
    """[[instant ISO, valeur], …] numériques, réduits à `maximum` points (moyenne par paquet)."""
    points = []
    for p in historique:
        v = _nombre(p.get("s", p.get("state")))
        t = p.get("lu", p.get("last_updated", p.get("last_changed")))
        if v is not None and t:
            points.append([t, v])
    if len(points) <= maximum:
        return points
    taille = len(points) / maximum
    reduits = []
    for i in range(maximum):
        paquet = points[int(i * taille):int((i + 1) * taille)] or [points[-1]]
        reduits.append([paquet[-1][0], round(sum(v for _, v in paquet) / len(paquet), 3)])
    return reduits
