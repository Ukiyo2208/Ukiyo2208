"""Suggestions d'automatisations, sans IA (instantanées) :

1. tes habitudes : ce que tu fais à la main à peu près à la même heure, plusieurs jours sur les 14 derniers
   (journal de Home Assistant) ;
2. des idées selon tes appareils : volets au coucher du soleil, lumière qui s'éteint sans mouvement, clim coupée
   si la fenêtre est ouverte, tout éteindre quand tout le monde part, volets fermés s'il fait trop chaud…

Chaque suggestion arrive avec son YAML prêt : tu le relis, puis tu la crées (mêmes vérifications que le reste).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from statistics import median
from typing import Any

JOURS_HABITUDE = 5  # au moins 5 jours différents…
FENETRE_MINUTES = 30  # … dans la même demi-heure
DOMAINES_HABITUDES = {"light", "switch", "cover", "climate", "fan", "media_player", "input_boolean"}
INTERDITS = {"garage", "gate", "door"}
_ACTIONS = {
    ("light", "on"): ("light.turn_on", "allumer"), ("light", "off"): ("light.turn_off", "éteindre"),
    ("switch", "on"): ("switch.turn_on", "allumer"), ("switch", "off"): ("switch.turn_off", "éteindre"),
    ("input_boolean", "on"): ("input_boolean.turn_on", "activer"), ("input_boolean", "off"): ("input_boolean.turn_off", "désactiver"),
    ("fan", "on"): ("fan.turn_on", "allumer"), ("fan", "off"): ("fan.turn_off", "éteindre"),
    ("media_player", "off"): ("media_player.turn_off", "éteindre"),
    ("climate", "off"): ("climate.turn_off", "éteindre"),
    ("cover", "open"): ("cover.open_cover", "ouvrir"), ("cover", "closed"): ("cover.close_cover", "fermer"),
}


def _dom(eid: str) -> str:
    return eid.split(".", 1)[0]


def _cible(ids: list[str]) -> dict:
    return {"entity_id": ids[0] if len(ids) == 1 else sorted(ids)}


def _heure(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}:00"


def _lisible(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}"


# ---------------------------------------------------------------- 1. habitudes (journal de Home Assistant)

def habitudes(journal: list[dict], noms: dict[str, str], maintenant: datetime | None = None) -> list[dict]:
    """Repère « tel appareil, tel état, vers telle heure » sur au moins 5 jours différents, en excluant ce que des
    automatisations ou des scripts ont déjà fait. Les heures sont celles du NAS (fuseau TZ)."""
    actions: dict[tuple[str, str], list[datetime]] = defaultdict(list)
    for entree in journal:
        eid, etat = entree.get("entity_id", ""), entree.get("state")
        if _dom(eid) not in DOMAINES_HABITUDES or (_dom(eid), etat) not in _ACTIONS or eid not in noms:
            continue
        if entree.get("context_domain") in ("automation", "script") or entree.get("context_event_type") == "automation_triggered":
            continue  # déjà automatique
        try:
            quand = datetime.fromisoformat(str(entree["when"]).replace("Z", "+00:00")).astimezone()
        except (KeyError, ValueError):
            continue
        actions[(eid, etat)].append(quand)

    resultat = []
    for (eid, etat), moments in actions.items():
        par_minute = sorted((m.hour * 60 + m.minute, m) for m in moments)
        meilleur: list = []
        for i, (debut, _) in enumerate(par_minute):  # la demi-heure qui contient le plus de jours différents
            fenetre = [x for x in par_minute[i:] if x[0] - debut <= FENETRE_MINUTES]
            jours = {m.date(): (mn, m) for mn, m in fenetre}  # un seul par jour
            if len(jours) > len(meilleur):
                meilleur = list(jours.values())
        if len(meilleur) < JOURS_HABITUDE:
            continue
        minute = int(round(median(mn for mn, _ in meilleur) / 5) * 5) % 1440
        semaine = all(m.weekday() < 5 for _, m in meilleur)
        action, verbe = _ACTIONS[(_dom(eid), etat)]
        nom = noms[eid]
        config: dict[str, Any] = {
            "alias": f"{verbe.capitalize()} {nom} à {_lisible(minute)}" + (" en semaine" if semaine else ""),
            "triggers": [{"trigger": "time", "at": _heure(minute)}],
            "actions": [{"action": action, "target": _cible([eid])}],
        }
        if semaine:
            config["conditions"] = [{"condition": "time", "weekday": ["mon", "tue", "wed", "thu", "fri"]}]
        resultat.append({
            "type": "habitude", "titre": config["alias"], "config": config, "score": len(meilleur),
            "pourquoi": f"Tu le fais à la main vers {_lisible(minute)}{' en semaine' if semaine else ''} : "
                        f"{len(meilleur)} jours sur les 14 derniers.",
        })
    return sorted(resultat, key=lambda s: -s["score"])


# ---------------------------------------------------------------- 2. idées selon tes appareils

def idees(appareils: list[dict], personnes: list[dict]) -> list[dict]:
    """appareils : les entités de la page Domotique (id, nom, piece, piece_id, attr)."""
    par_piece: dict[str, list[dict]] = defaultdict(list)
    for a in appareils:
        if a.get("piece_id"):
            par_piece[a["piece_id"]].append(a)
    classe = lambda a: (a.get("attr") or {}).get("device_class")  # noqa: E731
    volets = [a for a in appareils if _dom(a["id"]) == "cover" and classe(a) not in INTERDITS]
    lumieres = [a for a in appareils if _dom(a["id"]) == "light"]
    clims = [a for a in appareils if _dom(a["id"]) == "climate"]
    resultat: list[dict] = []

    def ajouter(titre: str, pourquoi: str, config: dict) -> None:
        resultat.append({"type": "idee", "titre": titre, "pourquoi": pourquoi, "config": {"alias": titre, **config}})

    if volets:
        ids = [a["id"] for a in volets]
        ajouter("Fermer les volets au coucher du soleil", f"{len(ids)} volet(s) ; l'heure suit les saisons toute seule.",
                {"triggers": [{"trigger": "sun", "event": "sunset", "offset": "00:15:00"}],
                 "actions": [{"action": "cover.close_cover", "target": _cible(ids)}]})
        ajouter("Ouvrir les volets au lever du soleil, pas avant 7h30", "Au lever du soleil, mais jamais trop tôt.",
                {"triggers": [{"trigger": "sun", "event": "sunrise"}, {"trigger": "time", "at": "07:30:00"}],
                 "conditions": [{"condition": "time", "after": "07:29:00"}, {"condition": "sun", "after": "sunrise"}],
                 "actions": [{"action": "cover.open_cover", "target": _cible(ids)}]})

    for piece_id, membres in par_piece.items():
        piece = membres[0].get("piece") or piece_id
        mouvement = [a for a in membres if _dom(a["id"]) == "binary_sensor" and classe(a) in ("motion", "occupancy", "presence")]
        ouvertures = [a for a in membres if _dom(a["id"]) == "binary_sensor" and classe(a) in ("window", "door", "opening")]
        temperature = [a for a in membres if _dom(a["id"]) == "sensor" and classe(a) == "temperature"]
        lum = [a["id"] for a in membres if _dom(a["id"]) == "light"]
        vol = [a["id"] for a in membres if a in volets]
        clim = [a["id"] for a in membres if _dom(a["id"]) == "climate"]
        if mouvement and lum:
            ajouter(f"Éteindre la lumière du {piece} sans mouvement depuis 10 min", f"Détecteur de mouvement et lumière dans le {piece}.",
                    {"triggers": [{"trigger": "state", "entity_id": mouvement[0]["id"], "to": "off", "for": "00:10:00"}],
                     "actions": [{"action": "light.turn_off", "target": _cible(lum)}]})
            ajouter(f"Allumer la lumière du {piece} au passage, la nuit", "Seulement entre le coucher et le lever du soleil.",
                    {"triggers": [{"trigger": "state", "entity_id": mouvement[0]["id"], "to": "on"}],
                     "conditions": [{"condition": "or", "conditions": [{"condition": "sun", "after": "sunset"},
                                                                       {"condition": "sun", "before": "sunrise"}]}],
                     "actions": [{"action": "light.turn_on", "target": _cible(lum), "data": {"brightness_pct": 40}}]})
        if ouvertures and clim:
            ajouter(f"Couper la clim du {piece} si une fenêtre reste ouverte", "Pour ne pas chauffer ou refroidir dehors.",
                    {"triggers": [{"trigger": "state", "entity_id": a["id"], "to": "on", "for": "00:02:00"} for a in ouvertures],
                     "actions": [{"action": "climate.turn_off", "target": _cible(clim)}]})
        if temperature and vol:
            ajouter(f"Fermer les volets du {piece} quand il fait plus de 27 °C", "En journée, pour garder la fraîcheur.",
                    {"triggers": [{"trigger": "numeric_state", "entity_id": temperature[0]["id"], "above": 27}],
                     "conditions": [{"condition": "time", "after": "11:00:00", "before": "19:00:00"}],
                     "actions": [{"action": "cover.close_cover", "target": _cible(vol)}]})

    ids_personnes = [p["id"] for p in personnes]
    if ids_personnes and (lumieres or clims):
        actions = []
        if lumieres:
            actions.append({"action": "light.turn_off", "target": _cible([a["id"] for a in lumieres])})
        if clims:
            actions.append({"action": "climate.turn_off", "target": _cible([a["id"] for a in clims])})
        ajouter("Tout éteindre quand tout le monde est parti", "Lumières" + (" et clim" if clims else "") + " quand la maison est vide.",
                {"triggers": [{"trigger": "state", "entity_id": p, "to": "not_home", "for": "00:05:00"} for p in ids_personnes],
                 "conditions": [{"condition": "state", "entity_id": p, "state": "not_home"} for p in ids_personnes],
                 "actions": actions})
    return resultat
