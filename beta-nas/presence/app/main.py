"""API du service de présence (port 8801, même jeton que Bêta)."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from . import config as cfg
from .presence import Presence
from .visages import Visages

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
etat: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    c = cfg.charger()
    if not c.beta_token:
        raise RuntimeError("BETA_TOKEN est vide : renseigne-le dans le fichier .env")
    visages = Visages(c.dossier_modeles, c.dossier_donnees / "visages.json", c.seuil_visage, c.taille_min_visage)
    presence = Presence(c, visages)
    etat.update(config=c, visages=visages, presence=presence)
    taches = [asyncio.create_task(presence.ecouter()), asyncio.create_task(presence.expirer())]
    yield
    for t in taches:
        t.cancel()
    await presence.fermer()


app = FastAPI(
    title="Bêta · Présence",
    description="Qui est où dans la maison, d'après les visages vus par les caméras.",
    lifespan=lifespan,
)
_bearer = HTTPBearer(auto_error=False)


def verifier_jeton(identifiants: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    recu = identifiants.credentials if identifiants else ""
    if not secrets.compare_digest(recu.encode(), etat["config"].beta_token.encode()):
        raise HTTPException(status_code=401, detail="Jeton invalide")


class Empreintes(BaseModel):
    empreintes: list[list[float]]


class Capture(BaseModel):
    camera: str
    duree: float = 15.0


@app.get("/positions", dependencies=[Depends(verifier_jeton)])
async def positions():
    return etat["presence"].etat()


@app.get("/visages", dependencies=[Depends(verifier_jeton)])
async def lister_visages():
    return etat["visages"].noms()


@app.post("/visages/{nom}", dependencies=[Depends(verifier_jeton)])
async def ajouter_visages(nom: str, donnees: Empreintes):
    """Empreintes calculées ailleurs, par exemple par la tablette (même modèle SFace)."""
    if not donnees.empreintes or any(len(e) != 128 for e in donnees.empreintes):
        raise HTTPException(status_code=400, detail="Il faut des empreintes SFace de 128 valeurs")
    etat["visages"].ajouter(nom.lower(), donnees.empreintes)
    return {"nom": nom.lower(), "empreintes": etat["visages"].noms()[nom.lower()]}


@app.post("/visages/{nom}/capturer", dependencies=[Depends(verifier_jeton)])
async def capturer(nom: str, demande: Capture):
    """Enregistre un visage depuis une caméra : reste seul face à elle pendant la capture."""
    presence: Presence = etat["presence"]
    visages: Visages = etat["visages"]
    empreintes, fin = [], time.monotonic() + demande.duree
    while time.monotonic() < fin and len(empreintes) < 10:
        image = await presence.capture(demande.camera)
        if image is not None:
            trouves = await asyncio.to_thread(visages.empreintes, image)
            if len(trouves) == 1:  # plusieurs visages : impossible de savoir lequel est le bon
                empreintes.append(trouves[0][0])
        await asyncio.sleep(0.7)
    if len(empreintes) < 3:
        raise HTTPException(status_code=422, detail=f"Seulement {len(empreintes)} images utilisables : rapproche-toi")
    visages.ajouter(nom.lower(), empreintes)
    return {"nom": nom.lower(), "ajoutees": len(empreintes)}


@app.delete("/visages/{nom}", dependencies=[Depends(verifier_jeton)])
async def supprimer_visage(nom: str):
    if not etat["visages"].supprimer(nom.lower()):
        raise HTTPException(status_code=404, detail="Personne inconnue")
    return {"supprime": nom.lower()}


@app.get("/sante")
async def sante():
    return {"presence": "ok", "cameras": len(etat["config"].cameras), "personnes": len(etat["visages"].noms())}
