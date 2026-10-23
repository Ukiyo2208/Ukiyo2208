"""Reconnaissance des visages (YuNet + SFace), avec les mêmes modèles et le même format que la tablette."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

LARGEUR_MAX = 1920  # au-delà, on réduit l'image : plus rapide, et les visages restent assez grands


@dataclass
class Visage:
    nom: str | None  # None : visage inconnu
    score: float
    taille: int  # largeur du visage en pixels


class Visages:
    def __init__(self, dossier_modeles: Path, fichier: Path, seuil: float, taille_min: int):
        self.seuil = seuil
        self.taille_min = taille_min
        self._fichier = fichier
        self._verrou = threading.Lock()
        self._detecteur = cv2.FaceDetectorYN.create(
            str(dossier_modeles / "face_detection_yunet_2023mar.onnx"), "", (320, 320), 0.8, 0.3, 5000
        )
        self._reconnaisseur = cv2.FaceRecognizerSF.create(
            str(dossier_modeles / "face_recognition_sface_2021dec.onnx"), ""
        )
        self._personnes: dict[str, list[np.ndarray]] = {}
        if fichier.exists():
            for nom, empreintes in json.loads(fichier.read_text()).items():
                self._personnes[nom] = [np.asarray(e, dtype=np.float32) for e in empreintes]

    # ------------------------------------------------------------ Base de visages

    def noms(self) -> dict[str, int]:
        with self._verrou:
            return {nom: len(e) for nom, e in sorted(self._personnes.items())}

    def ajouter(self, nom: str, empreintes: list[list[float]] | list[np.ndarray]) -> None:
        with self._verrou:
            liste = self._personnes.setdefault(nom, [])
            liste.extend(np.asarray(e, dtype=np.float32) for e in empreintes)
            self._sauvegarder()

    def supprimer(self, nom: str) -> bool:
        with self._verrou:
            present = self._personnes.pop(nom, None) is not None
            self._sauvegarder()
            return present

    def _sauvegarder(self) -> None:
        self._fichier.parent.mkdir(parents=True, exist_ok=True)
        donnees = {nom: [e.tolist() for e in liste] for nom, liste in self._personnes.items()}
        self._fichier.write_text(json.dumps(donnees))

    # ------------------------------------------------------------ Analyse d'images

    def empreintes(self, image: np.ndarray) -> list[tuple[np.ndarray, int]]:
        """Empreinte et taille de chaque visage assez grand de l'image (BGR)."""
        if image.shape[1] > LARGEUR_MAX:
            echelle = LARGEUR_MAX / image.shape[1]
            image = cv2.resize(image, None, fx=echelle, fy=echelle, interpolation=cv2.INTER_AREA)
        with self._verrou:
            self._detecteur.setInputSize((image.shape[1], image.shape[0]))
            _, visages = self._detecteur.detect(image)
            resultat = []
            for v in visages if visages is not None else []:
                taille = int(v[2])
                if taille < self.taille_min:
                    continue
                aligne = self._reconnaisseur.alignCrop(image, v)
                resultat.append((self._reconnaisseur.feature(aligne).reshape(-1).copy(), taille))
            return resultat

    def identifier(self, empreinte: np.ndarray) -> tuple[str | None, float]:
        meilleur, score_max = None, 0.0
        with self._verrou:
            for nom, liste in self._personnes.items():
                for e in liste:
                    score = float(empreinte @ e / (np.linalg.norm(empreinte) * np.linalg.norm(e) + 1e-9))
                    if score > score_max:
                        meilleur, score_max = nom, score
        return (meilleur if score_max >= self.seuil else None), score_max

    def analyser(self, image: np.ndarray) -> list[Visage]:
        resultat = []
        for empreinte, taille in self.empreintes(image):
            nom, score = self.identifier(empreinte)
            resultat.append(Visage(nom, score, taille))
        return resultat
