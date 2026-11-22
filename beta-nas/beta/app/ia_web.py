"""Automatisations : écrites par l'IA de la tâche « automatisations » (le cloud par défaut).

Ce qui part sur Internet : la phrase + la liste des appareils (type, pièce, et le nom si
`envoyer_noms_appareils` est activé). Les vrais identifiants sont remplacés par des alias,
aucun jeton ni accès à Home Assistant n'est transmis. L'IA ne fait que PROPOSER un YAML,
qui est vérifié ici puis confirmé à voix haute avant d'être créé.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

import yaml

from .homeassistant import Appareil
from .ia import AUTOMATISATIONS, IA, IndisponibleError

_CONSIGNE = (
    "Tu écris des automatisations Home Assistant (format YAML moderne : triggers / conditions / actions). "
    "N'utilise QUE les appareils fournis, avec leurs identifiants exacts. "
    "N'utilise pas de templates Jinja, de scripts, de shell_command ni de rest_command. "
    "Si la demande est impossible avec ces appareils, mets possible=false et explique pourquoi dans 'resume'. "
    "Sinon, 'resume' est une phrase courte en français qui sera lue à voix haute pour demander confirmation, "
    "par exemple : « Tous les jours à 6h, j'ouvre les volets de la chambre. »\n\n"
    # Des exemples : indispensables pour un modèle local de taille moyenne
    "Exemples de YAML valides :\n"
    "alias: Volets au lever du soleil\ntriggers:\n  - trigger: sun\n    event: sunrise\n    offset: \"00:15:00\"\n"
    "actions:\n  - action: cover.open_cover\n    target:\n      entity_id: cover.appareil_1\n\n"
    "alias: Lumière du soir en semaine\ntriggers:\n  - trigger: time\n    at: \"19:30:00\"\n"
    "conditions:\n  - condition: time\n    weekday: [mon, tue, wed, thu, fri]\n"
    "actions:\n  - action: light.turn_on\n    target:\n      entity_id: light.appareil_2\n    data:\n      brightness_pct: 60\n\n"
    "alias: Éteindre si plus de mouvement\ntriggers:\n  - trigger: state\n    entity_id: binary_sensor.appareil_1\n"
    "    to: \"off\"\n    for: \"00:10:00\"\nactions:\n  - action: light.turn_off\n    target:\n      entity_id: light.appareil_1"
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "possible": {"type": "boolean"},
        "resume": {"type": "string"},
        "yaml": {"type": "string"},
    },
    "required": ["possible", "resume", "yaml"],
    "additionalProperties": False,
}

# Actions autorisées en plus des domaines exposés
_ACTIONS_AUTORISEES_EN_PLUS = {"notify", "persistent_notification", "tts"}
# Jamais dans une automatisation créée par Bêta : ouvrir une serrure, désarmer une alarme
_ACTIONS_INTERDITES = {"lock.unlock", "lock.open", "alarm_control_panel.alarm_disarm"}
_FORME_ENTITE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


class ErreurAutomatisation(ValueError):
    pass


@dataclass
class Proposition:
    possible: bool
    resume: str
    config: dict[str, Any] = field(default_factory=dict)
    modele: str = ""  # l'IA qui a écrit la proposition


def anonymiser(appareils: list[Appareil], envoyer_noms: bool) -> tuple[list[dict], dict[str, str]]:
    """Retourne la liste envoyée à l'IA et la table alias -> vrai entity_id."""
    liste, table = [], {}
    compteurs: dict[str, int] = {}
    for a in appareils:
        compteurs[a.domaine] = compteurs.get(a.domaine, 0) + 1
        alias = f"{a.domaine}.appareil_{compteurs[a.domaine]}"
        table[alias] = a.entity_id
        entree = {"id": alias, "type": a.domaine, "piece": a.piece or "inconnue"}
        if envoyer_noms:
            entree["nom"] = a.nom
        liste.append(entree)
    return liste, table


def _remplacer(valeur: Any, table: dict[str, str]) -> Any:
    if isinstance(valeur, str):
        return table.get(valeur, valeur)
    if isinstance(valeur, list):
        return [_remplacer(v, table) for v in valeur]
    if isinstance(valeur, dict):
        return {k: _remplacer(v, table) for k, v in valeur.items()}
    return valeur


def _parcourir(valeur: Any, cle: str | None = None):
    """Produit (clé parente, valeur) pour chaque nœud de l'arbre."""
    yield cle, valeur
    if isinstance(valeur, dict):
        for k, v in valeur.items():
            yield from _parcourir(v, k)
    elif isinstance(valeur, list):
        for v in valeur:
            yield from _parcourir(v, cle)


def verifier(
    texte_yaml: str, table: dict[str, str], domaines_exposes: list[str], alias: str = "Automatisation Bêta"
) -> dict[str, Any]:
    """Parse le YAML proposé, remet les vrais identifiants et refuse tout ce qui sort du cadre."""
    try:
        config = yaml.safe_load(texte_yaml)
    except yaml.YAMLError as e:
        raise ErreurAutomatisation(f"YAML invalide : {e}") from e
    if isinstance(config, list) and len(config) == 1:
        config = config[0]
    if not isinstance(config, dict):
        raise ErreurAutomatisation("L'automatisation doit être un objet YAML")

    if not (config.get("triggers") or config.get("trigger")):
        raise ErreurAutomatisation("Aucun déclencheur")
    if not (config.get("actions") or config.get("action")):
        raise ErreurAutomatisation("Aucune action")

    texte_brut = json.dumps(config)
    if "{{" in texte_brut or "{%" in texte_brut:
        raise ErreurAutomatisation("Les templates ne sont pas autorisés")

    config = _remplacer(config, table)
    vrais_ids = set(table.values())
    domaines_actions = set(domaines_exposes) | _ACTIONS_AUTORISEES_EN_PLUS

    for cle, noeud in _parcourir(config):
        if not isinstance(noeud, str) or not _FORME_ENTITE.match(noeud):
            continue
        domaine = noeud.split(".", 1)[0]
        if cle in ("action", "service"):
            if noeud in _ACTIONS_INTERDITES:
                raise ErreurAutomatisation(f"Action interdite pour ta sécurité : {noeud}")
            if domaine not in domaines_actions:
                raise ErreurAutomatisation(f"Action non autorisée : {noeud}")
        elif domaine in domaines_exposes and noeud not in vrais_ids:
            raise ErreurAutomatisation(f"Appareil inconnu : {noeud}")

    config.setdefault("alias", alias)
    config.setdefault("description", "Créée par Bêta")
    config.setdefault("mode", "single")
    return config


def en_yaml(config: dict[str, Any]) -> str:
    """Le YAML à montrer (et à télécharger), dans l'ordre où Home Assistant l'affiche."""
    ordre = ["alias", "description", "mode", "triggers", "trigger", "conditions", "condition", "actions", "action"]
    trie = {k: config[k] for k in ordre if k in config} | {k: v for k, v in config.items() if k not in ordre and k != "id"}
    return yaml.safe_dump(trie, allow_unicode=True, sort_keys=False, width=120)


async def proposer_automatisation(
    ia: IA,
    demande: str,
    appareils: list[Appareil],
    domaines_exposes: list[str],
    envoyer_noms: bool,
) -> Proposition:
    """Confiée à l'IA de la tâche « automatisations » (le cloud par défaut, sinon le modèle puissant)."""
    liste, table = anonymiser(appareils, envoyer_noms)
    message = f"Demande : {demande}\n\nAppareils disponibles :\n{json.dumps(liste, ensure_ascii=False, indent=1)}"
    try:
        donnees, modele = await ia.demander_json(AUTOMATISATIONS, _CONSIGNE, message, _SCHEMA, max_tokens=16000)
    except IndisponibleError as e:
        raise ErreurAutomatisation(f"Aucune IA disponible pour les automatisations : {e}") from e
    if not donnees.get("possible"):
        return Proposition(False, str(donnees.get("resume", "Ce n'est pas possible avec tes appareils.")))
    config = verifier(str(donnees.get("yaml", "")), table, domaines_exposes, alias=str(donnees.get("resume", ""))[:100])
    return Proposition(True, str(donnees["resume"]), config, modele)
