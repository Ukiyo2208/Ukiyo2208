"""Configuration de Bêta : variables d'environnement (.env) + config.yaml."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

# Capacités possibles d'un rôle
DOMOTIQUE = "domotique"
MAILS = "mails"
QUESTIONS = "questions"
AUTOMATISATIONS = "automatisations"

# Comment on sait qui parle, du plus sûr au moins sûr
VISAGE = "visage"  # caméra de la tablette
PRESENCE = "presence"  # seule personne connue vue récemment à cet étage par les caméras
DECLARATION = "declaration"  # réponse à « C'est pour qui ? »
# Ce qui exige d'avoir vu le visage : une présence ou une déclaration ne suffisent pas
CAPACITES_VISAGE_OBLIGATOIRE = {AUTOMATISATIONS}

ROLES_PAR_DEFAUT = {
    "admin": [DOMOTIQUE, MAILS, QUESTIONS, AUTOMATISATIONS],
    "adulte": [DOMOTIQUE, MAILS, QUESTIONS],
    "enfant": [DOMOTIQUE, QUESTIONS],
    # Sans visage : tout ce qui ne dépend pas de la personne (maison, questions générales)
    "inconnu": [DOMOTIQUE, QUESTIONS],
}


@dataclass
class CompteMail:
    serveur: str
    utilisateur: str
    mot_de_passe: str
    port: int = 993


@dataclass
class Personne:
    nom: str
    role: str
    mail: CompteMail | None = None
    companion: str | None = None  # entité person.xxx de l'app Home Assistant Companion
    surnoms: list[str] = field(default_factory=list)  # autres façons de dire son prénom


@dataclass
class Settings:
    # Sécurité de l'API (la tablette doit envoyer ce jeton)
    beta_token: str = ""

    # Home Assistant
    ha_url: str = "http://host.docker.internal:8123"
    ha_token: str = ""
    ha_agent_id: str = "conversation.home_assistant"

    # Services vocaux (protocole Wyoming)
    whisper_host: str = "whisper"
    whisper_port: int = 10300
    piper_host: str = "piper"
    piper_port: int = 10200
    piper_voix: str = "fr_FR-siwis-medium"

    # LLM local
    ollama_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:3b"
    ollama_timeout: float = 30.0

    # IA web (optionnelle)
    anthropic_api_key: str = ""
    claude_model: str = "claude-opus-5-5"

    langue: str = "fr"

    # Issu de config.yaml
    seuil_confiance: float = 0.4
    personnes: dict[str, Personne] = field(default_factory=dict)
    roles: dict[str, list[str]] = field(default_factory=lambda: dict(ROLES_PAR_DEFAUT))
    domaines_exposes: list[str] = field(
        default_factory=lambda: [
            "light", "switch", "cover", "climate", "fan", "media_player",
            "lock", "scene", "sensor", "binary_sensor", "input_boolean", "vacuum",
        ]
    )
    envoyer_noms_appareils: bool = True

    # Présence (service beta-presence + caméras)
    presence_url: str = "http://presence:8801"
    zones: dict[str, str] = field(default_factory=dict)  # pièce -> zone (étage)
    validite_minutes: float = 15

    def identifie(self, personne: str | None, confiance: float) -> bool:
        return bool(personne) and personne in self.personnes and confiance >= self.seuil_confiance

    def capacites(self, personne: str | None, niveau: str | None) -> set[str]:
        """Ce que la personne peut faire selon la façon dont on l'a reconnue."""
        inconnu = set(self.roles.get("inconnu", []))
        if not personne or not niveau or personne not in self.personnes:
            return inconnu
        capacites = set(self.roles.get(self.personnes[personne].role, [])) | inconnu
        if niveau != VISAGE:
            capacites -= CAPACITES_VISAGE_OBLIGATOIRE
        return capacites

    def zone_de(self, piece: str | None) -> str | None:
        return self.zones.get(piece, piece) if piece else None


def _env(nom: str, defaut: str = "") -> str:
    return os.environ.get(nom, defaut).strip()


def charger(chemin_config: str | None = None) -> Settings:
    s = Settings(
        beta_token=_env("BETA_TOKEN"),
        ha_url=_env("HA_URL", Settings.ha_url).rstrip("/"),
        ha_token=_env("HA_TOKEN"),
        ha_agent_id=_env("HA_AGENT_ID", Settings.ha_agent_id),
        whisper_host=_env("WHISPER_HOST", Settings.whisper_host),
        whisper_port=int(_env("WHISPER_PORT", str(Settings.whisper_port))),
        piper_host=_env("PIPER_HOST", Settings.piper_host),
        piper_port=int(_env("PIPER_PORT", str(Settings.piper_port))),
        piper_voix=_env("PIPER_VOICE", Settings.piper_voix),
        ollama_url=_env("OLLAMA_URL", Settings.ollama_url).rstrip("/"),
        ollama_model=_env("OLLAMA_MODEL", Settings.ollama_model),
        anthropic_api_key=_env("ANTHROPIC_API_KEY"),
        claude_model=_env("CLAUDE_MODEL", Settings.claude_model),
        presence_url=_env("PRESENCE_URL", Settings.presence_url).rstrip("/"),
    )

    chemin = Path(chemin_config or _env("BETA_CONFIG", "/config/config.yaml"))
    if not chemin.exists():
        return s

    brut = yaml.safe_load(chemin.read_text(encoding="utf-8")) or {}
    s.seuil_confiance = float(brut.get("seuil_confiance", s.seuil_confiance))
    s.envoyer_noms_appareils = bool(brut.get("envoyer_noms_appareils", s.envoyer_noms_appareils))
    if brut.get("domaines_exposes"):
        s.domaines_exposes = list(brut["domaines_exposes"])
    for role, capacites in (brut.get("roles") or {}).items():
        s.roles[role] = list(capacites or [])

    maison = brut.get("maison") or {}
    s.validite_minutes = float(maison.get("validite_minutes", s.validite_minutes))
    for zone, pieces in (maison.get("zones") or {}).items():
        for piece in pieces or []:
            s.zones[str(piece)] = str(zone)

    for nom, infos in (brut.get("personnes") or {}).items():
        infos = infos or {}
        mail = None
        if infos.get("mail"):
            m = infos["mail"]
            mail = CompteMail(
                serveur=m["serveur"],
                utilisateur=m["utilisateur"],
                # Le mot de passe reste dans .env, jamais dans config.yaml
                mot_de_passe=_env(m.get("mot_de_passe_env", "")),
                port=int(m.get("port", 993)),
            )
        s.personnes[nom] = Personne(
            nom=nom,
            role=infos.get("role", "adulte"),
            mail=mail,
            companion=infos.get("companion"),
            surnoms=[str(x) for x in infos.get("surnoms") or []],
        )
    return s
