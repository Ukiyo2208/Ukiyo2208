"""Configuration du service de présence : .env + sections `maison` et `cameras` de config.yaml."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class Camera:
    camera: str  # entité caméra de Home Assistant (ex : camera.salon_clair)
    detection: str  # capteur de détection de personne (ex : binary_sensor.salon_personne)
    piece: str
    zone: str


@dataclass
class Config:
    ha_url: str = "http://host.docker.internal:8123"
    ha_token: str = ""
    beta_token: str = ""
    dossier_donnees: Path = Path("/data")
    dossier_modeles: Path = Path("/modeles")

    seuil_visage: float = 0.4
    validite_minutes: float = 15
    nb_captures: int = 5
    intervalle_captures: float = 0.5
    # Un visage plus petit est ignoré : trop peu de pixels pour le reconnaître
    taille_min_visage: int = 50
    cameras: list[Camera] = field(default_factory=list)

    def camera(self, entite: str) -> Camera | None:
        return next((c for c in self.cameras if c.camera == entite or c.detection == entite), None)


def zones(brut: dict) -> dict[str, str]:
    """Pièce -> zone, d'après `maison.zones` (zone -> liste de pièces)."""
    resultat = {}
    for zone, pieces in ((brut.get("maison") or {}).get("zones") or {}).items():
        for piece in pieces or []:
            resultat[str(piece)] = str(zone)
    return resultat


def charger(chemin: str | None = None) -> Config:
    c = Config(
        ha_url=os.environ.get("HA_URL", Config.ha_url).rstrip("/"),
        ha_token=os.environ.get("HA_TOKEN", ""),
        beta_token=os.environ.get("BETA_TOKEN", ""),
        dossier_donnees=Path(os.environ.get("PRESENCE_DONNEES", "/data")),
        dossier_modeles=Path(os.environ.get("PRESENCE_MODELES", "/modeles")),
    )
    fichier = Path(chemin or os.environ.get("BETA_CONFIG", "/config/config.yaml"))
    if not fichier.exists():
        return c

    brut = yaml.safe_load(fichier.read_text(encoding="utf-8")) or {}
    maison = brut.get("maison") or {}
    c.seuil_visage = float(brut.get("seuil_confiance", c.seuil_visage))
    c.validite_minutes = float(maison.get("validite_minutes", c.validite_minutes))
    pieces = zones(brut)
    for cam in brut.get("cameras") or []:
        piece = str(cam["piece"])
        c.cameras.append(
            Camera(camera=cam["camera"], detection=cam["detection"], piece=piece, zone=pieces.get(piece, piece))
        )
    return c
