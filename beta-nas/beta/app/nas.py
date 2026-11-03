"""État du NAS, des IA et de l'API, pour un site ou un tableau de bord externe.

Ne contient aucune donnée personnelle : ni phrases, ni prénoms, ni jetons. Uniquement des chiffres,
des noms de modèles et l'état des services.
"""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import stats as st

RACINE_PROC = Path(os.environ.get("BETA_PROC", "/proc"))
RACINE_SYS = Path(os.environ.get("BETA_SYS", "/sys"))


# ---------------------------------------------------------------- Système (le conteneur voit le NAS)


def _temps_cpu() -> tuple[int, int]:
    """(temps actif, temps total) de tous les cœurs depuis le démarrage, d'après /proc/stat."""
    valeurs = [int(v) for v in (RACINE_PROC / "stat").read_text().splitlines()[0].split()[1:]]
    inactif = valeurs[3] + (valeurs[4] if len(valeurs) > 4 else 0)  # idle + iowait
    return sum(valeurs) - inactif, sum(valeurs)


async def processeur() -> dict:
    actif1, total1 = _temps_cpu()
    await asyncio.sleep(0.5)
    actif2, total2 = _temps_cpu()
    charge = (RACINE_PROC / "loadavg").read_text().split()
    return {
        "coeurs": os.cpu_count(),
        "utilisation_pct": round(100 * (actif2 - actif1) / max(total2 - total1, 1), 1),
        "charge_1_5_15": [float(c) for c in charge[:3]],
    }


def memoire() -> dict:
    infos = {}
    for ligne in (RACINE_PROC / "meminfo").read_text().splitlines():
        cle, valeur = ligne.split(":", 1)
        infos[cle] = int(valeur.split()[0]) * 1024
    total, dispo = infos["MemTotal"], infos.get("MemAvailable", infos["MemFree"])
    return {"total_go": _go(total), "utilisee_go": _go(total - dispo), "utilisation_pct": round(100 * (total - dispo) / total, 1)}


def disques(chemins: list[str]) -> list[dict]:
    resultat = []
    for nom, chemin in [c.split("=", 1) if "=" in c else (c, c) for c in chemins]:
        try:
            u = shutil.disk_usage(chemin)
        except OSError:
            continue
        resultat.append({
            "nom": nom, "total_go": _go(u.total), "libre_go": _go(u.free),
            "utilisation_pct": round(100 * u.used / u.total, 1),
        })
    return resultat


def temperature() -> float | None:
    """La plus haute température des capteurs (°C), si le NAS les expose."""
    mesures = []
    for capteur in RACINE_SYS.glob("class/thermal/thermal_zone*/temp"):
        try:
            mesures.append(int(capteur.read_text().strip()) / 1000)
        except (OSError, ValueError):
            continue
    return round(max(mesures), 1) if mesures else None


def en_ligne_depuis() -> int:
    return int(float((RACINE_PROC / "uptime").read_text().split()[0]))


def _go(octets: float) -> float:
    return round(octets / 1024**3, 1)


# ---------------------------------------------------------------- IA


async def ollama(url: str) -> dict:
    """Modèles installés et modèles chargés en mémoire."""
    async with httpx.AsyncClient(base_url=url, timeout=3) as client:
        try:
            tags, ps = await asyncio.gather(client.get("/api/tags"), client.get("/api/ps"))
            tags.raise_for_status()
            ps.raise_for_status()
        except httpx.HTTPError:
            return {"en_ligne": False, "installes": [], "charges": []}
    return {
        "en_ligne": True,
        "installes": [
            {
                "nom": m["name"],
                "taille_go": _go(m.get("size", 0)),
                "parametres": m.get("details", {}).get("parameter_size", ""),
                "quantification": m.get("details", {}).get("quantization_level", ""),
            }
            for m in tags.json().get("models", [])
        ],
        "charges": [
            {"nom": m["name"], "memoire_go": _go(m.get("size", 0)), "expire": m.get("expires_at", "")}
            for m in ps.json().get("models", [])
        ],
    }


def ia_publique(settings) -> dict:
    """Quelle IA fait quoi (sans adresse ni clé)."""
    if not settings.ia:
        return {"taches": {}, "modeles": {}}
    return {
        "taches": {t: [m.nom for m in settings.ia.candidats(t)] for t in settings.ia.resume()},
        "modeles": {
            m.nom: {"type": m.type, "modele": m.modele, "configure": m.configure, "local": m.local}
            for m in settings.ia.modeles.values()
        },
    }


# ---------------------------------------------------------------- Ensemble


def api_publique(instantane: dict) -> dict:
    points = instantane["points"]
    appels = sum(p["appels"] for p in points.values())
    commande = points.get("POST /v1/commande", {})
    return {
        "depuis": instantane["depuis"],
        "appels": appels,
        "erreurs": sum(p["erreurs"] for p in points.values()),
        "commandes_vocales": commande.get("appels", 0),
        "duree_moyenne_commande_ms": commande.get("moyenne_ms", 0),
        "par_point": {nom: {k: p[k] for k in ("appels", "erreurs", "moyenne_ms")} for nom, p in points.items()},
        "traite_par": instantane["routes"],  # home_assistant, conversation:cloud…
    }


async def etat_complet(settings, statistiques: st.Statistiques, services: dict) -> dict:
    cpu, modeles = await asyncio.gather(processeur(), ollama(settings.ollama_url))
    return {
        "nas": {
            "nom": settings.nas_nom,
            "systeme": f"{platform.system()} {platform.release()}",
            "en_ligne_depuis_s": en_ligne_depuis(),
            "processeur": cpu,
            "memoire": memoire(),
            "disques": disques(settings.nas_disques),
            "temperature_c": temperature(),
        },
        "ia": {**ia_publique(settings), "ollama": modeles},
        "services": {nom: {"ok": s["ok"]} for nom, s in services.items()},
        "api": api_publique(statistiques.instantane()),
        "mis_a_jour": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "horodatage": int(time.time()),
    }
