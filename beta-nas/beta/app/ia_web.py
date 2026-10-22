"""IA web (Claude) pour les demandes trop complexes pour le NAS, comme créer une automatisation.

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

import anthropic
import yaml

from .homeassistant import Appareil

_CONSIGNE = (
    "Tu écris des automatisations Home Assistant (format YAML moderne : triggers / conditions / actions). "
    "N'utilise QUE les appareils fournis, avec leurs identifiants exacts. "
    "N'utilise pas de templates Jinja, de scripts, de shell_command ni de rest_command. "
    "Si la demande est impossible avec ces appareils, mets possible=false et explique pourquoi dans 'resume'. "
    "Sinon, 'resume' est une phrase courte en français qui sera lue à voix haute pour demander confirmation, "
    "par exemple : « Tous les jours à 6h, j'ouvre les volets de la chambre. »"
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
_FORME_ENTITE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


class ErreurAutomatisation(ValueError):
    pass


@dataclass
class Proposition:
    possible: bool
    resume: str
    config: dict[str, Any] = field(default_factory=dict)


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
            if domaine not in domaines_actions:
                raise ErreurAutomatisation(f"Action non autorisée : {noeud}")
        elif domaine in domaines_exposes and noeud not in vrais_ids:
            raise ErreurAutomatisation(f"Appareil inconnu : {noeud}")

    config.setdefault("alias", alias)
    config["description"] = "Créée par Bêta (assistant vocal)"
    config.setdefault("mode", "single")
    return config


class IAWeb:
    def __init__(self, api_key: str, modele: str):
        self.modele = modele
        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=120.0)

    async def fermer(self) -> None:
        await self._client.close()

    async def proposer_automatisation(
        self,
        demande: str,
        appareils: list[Appareil],
        domaines_exposes: list[str],
        envoyer_noms: bool,
    ) -> Proposition:
        liste, table = anonymiser(appareils, envoyer_noms)
        message = (
            f"Demande : {demande}\n\n"
            f"Appareils disponibles :\n{json.dumps(liste, ensure_ascii=False, indent=1)}"
        )

        reponse = await self._client.beta.messages.create(
            model=self.modele,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _SCHEMA}},
            system=_CONSIGNE,
            messages=[{"role": "user", "content": message}],
        )
        if reponse.stop_reason == "refusal":
            return Proposition(False, "L'IA web a refusé cette demande.")
        if reponse.stop_reason == "max_tokens":
            raise ErreurAutomatisation("Réponse de l'IA web tronquée")

        texte = next(b.text for b in reponse.content if b.type == "text")
        donnees = json.loads(texte)
        if not donnees["possible"]:
            return Proposition(False, donnees["resume"])
        config = verifier(donnees["yaml"], table, domaines_exposes, alias=donnees["resume"][:100])
        return Proposition(True, donnees["resume"], config)
