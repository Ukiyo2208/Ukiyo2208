"""Utilisation de l'API en temps réel : compteurs, temps de réponse, dernières requêtes, état des services."""

from __future__ import annotations

import asyncio
import time
from collections import Counter, deque
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime

import httpx

# Rempli par l'endpoint pendant la requête (route choisie, phrase comprise), lu par le middleware
demande_en_cours: ContextVar[dict | None] = ContextVar("demande_en_cours", default=None)


@dataclass
class _Compteur:
    appels: int = 0
    erreurs: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0


@dataclass
class Statistiques:
    debut: float = field(default_factory=time.time)
    par_point: dict[str, _Compteur] = field(default_factory=dict)
    routes: Counter = field(default_factory=Counter)  # qui a traité les demandes (home_assistant, llm_local…)
    dernieres: deque = field(default_factory=lambda: deque(maxlen=50))

    def requete(self, methode: str, chemin: str, statut: int, ms: float, client: str, infos: dict) -> None:
        c = self.par_point.setdefault(f"{methode} {chemin}", _Compteur())
        c.appels += 1
        c.erreurs += statut >= 400
        c.total_ms += ms
        c.max_ms = max(c.max_ms, ms)
        self.dernieres.appendleft({
            "heure": datetime.now().strftime("%H:%M:%S"),
            "methode": methode,
            "chemin": chemin,
            "statut": statut,
            "ms": round(ms),
            "client": client,
            "route": infos.get("route", ""),
            "texte": infos.get("texte", "")[:80],
        })
        if infos.get("route"):
            self.routes[infos["route"]] += 1

    def instantane(self) -> dict:
        return {
            "depuis": datetime.fromtimestamp(self.debut).isoformat(timespec="seconds"),
            "en_ligne_depuis_s": round(time.time() - self.debut),
            "points": {
                nom: {
                    "appels": c.appels,
                    "erreurs": c.erreurs,
                    "moyenne_ms": round(c.total_ms / c.appels) if c.appels else 0,
                    "max_ms": round(c.max_ms),
                }
                for nom, c in sorted(self.par_point.items(), key=lambda x: -x[1].appels)
            },
            "routes": dict(self.routes.most_common()),
            "dernieres": list(self.dernieres),
        }


async def _port_ouvert(hote: str, port: int) -> bool:
    try:
        _, ecriture = await asyncio.wait_for(asyncio.open_connection(hote, port), 2)
        ecriture.close()
        return True
    except (OSError, asyncio.TimeoutError):
        return False


async def _http(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response | None:
    try:
        return await client.get(url, timeout=3, **kwargs)
    except httpx.HTTPError:
        return None


async def etat_services(settings) -> dict:
    """Chaque service joint par Bêta : en ligne ou non, et le modèle chargé dans Ollama."""
    async with httpx.AsyncClient() as client:
        ha, ollama_ps, presence, whisper, piper = await asyncio.gather(
            _http(client, f"{settings.ha_url}/api/", headers={"Authorization": f"Bearer {settings.ha_token}"}),
            _http(client, f"{settings.ollama_url}/api/ps"),
            _http(client, f"{settings.presence_url}/sante"),
            _port_ouvert(settings.whisper_host, settings.whisper_port),
            _port_ouvert(settings.piper_host, settings.piper_port),
        )
    modeles = []
    if ollama_ps is not None and ollama_ps.status_code == 200:
        modeles = [m.get("name", "?") for m in ollama_ps.json().get("models", [])]
    return {
        "home_assistant": {"ok": ha is not None and ha.status_code == 200,
                           "detail": "jeton refusé" if ha is not None and ha.status_code == 401 else ""},
        "ollama": {"ok": ollama_ps is not None and ollama_ps.status_code == 200,
                   "detail": "modèle chargé : " + ", ".join(modeles) if modeles else "aucun modèle chargé"},
        "whisper": {"ok": whisper, "detail": ""},
        "piper": {"ok": piper, "detail": ""},
        "presence": {"ok": presence is not None and presence.status_code == 200,
                     "detail": (f"{presence.json().get('cameras', 0)} caméras, "
                                f"{presence.json().get('personnes', 0)} personnes")
                     if presence is not None and presence.status_code == 200 else ""},
        "ia_web": {"ok": bool(settings.anthropic_api_key), "detail": settings.claude_model if settings.anthropic_api_key else "désactivée"},
    }


def en_texte(instantane: dict, services: dict) -> str:
    """Version lisible dans un terminal (pour fiche-api.sh suivre)."""
    lignes = [f"Bêta · en ligne depuis {instantane['en_ligne_depuis_s'] // 60} min", "", "SERVICES"]
    for nom, s in services.items():
        lignes.append(f"  {'✅' if s['ok'] else '❌'} {nom:<15} {s['detail']}")
    lignes += ["", f"{'APPELS':<34}{'nb':>6}{'err':>6}{'moy ms':>9}{'max ms':>9}"]
    for nom, p in instantane["points"].items():
        lignes.append(f"  {nom:<32}{p['appels']:>6}{p['erreurs']:>6}{p['moyenne_ms']:>9}{p['max_ms']:>9}")
    if instantane["routes"]:
        lignes += ["", "TRAITÉ PAR  " + "  ·  ".join(f"{r} {n}" for r, n in instantane["routes"].items())]
    lignes += ["", "DERNIÈRES REQUÊTES"]
    for d in instantane["dernieres"][:12]:
        detail = f"{d['route']} « {d['texte']} »" if d["texte"] else ""
        lignes.append(f"  {d['heure']} {d['client']:<15} {d['methode']:<5}{d['chemin']:<22}{d['statut']:>4}{d['ms']:>7} ms  {detail}")
    return "\n".join(lignes) + "\n"
