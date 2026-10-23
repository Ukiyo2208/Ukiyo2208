"""API de Bêta : la tablette envoie l'audio + qui parle, Bêta répond en texte et en voix."""

from __future__ import annotations

import asyncio
import base64
import logging
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import settings as cfg
from .homeassistant import HomeAssistant
from .ia_web import IAWeb
from .llm_local import LLMLocal
from .localisation import Localisation, prenom_dans
from .routeur import APRES_CAMERA, IDENTIFICATION_REQUISE, INITIALE, QUI_REQUIS, Routeur
from .voix import ErreurAudio, synthetiser, transcrire

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("beta")

etat: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = cfg.charger()
    if not s.beta_token:
        raise RuntimeError("BETA_TOKEN est vide : renseigne-le dans le fichier .env")
    if not s.ha_token:
        log.warning("HA_TOKEN est vide : Home Assistant refusera les commandes")

    ha = HomeAssistant(s.ha_url, s.ha_token, s.ha_agent_id, s.langue)
    llm = LLMLocal(s.ollama_url, s.ollama_model, s.ollama_timeout)
    ia_web = IAWeb(s.anthropic_api_key, s.claude_model) if s.anthropic_api_key else None
    localisation = Localisation(s, ha)
    etat.update(settings=s, routeur=Routeur(s, ha, llm, ia_web, localisation))
    prechauffage = asyncio.create_task(llm.prechauffer())
    log.info("Bêta démarré (IA web %s)", "activée" if ia_web else "désactivée")
    yield
    prechauffage.cancel()
    await ha.fermer()
    await llm.fermer()
    await localisation.fermer()
    if ia_web:
        await ia_web.fermer()


STATIQUE = Path(__file__).parent / "static"

app = FastAPI(
    title="Bêta",
    description=(
        '<img src="/static/logo.png" width="120" alt="Logo de Bêta">\n\n'
        "L'assistant vocal de la maison. Clique sur **Authorize** et colle ton `BETA_TOKEN`, "
        "puis essaie `/v1/texte` avec par exemple `allume la lumière du salon`."
    ),
    lifespan=lifespan,
    docs_url=None,  # remplacée ci-dessous pour afficher le logo dans l'onglet
)
app.mount("/static", StaticFiles(directory=STATIQUE), name="static")


@app.get("/docs", include_in_schema=False)
async def docs():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url, title="Bêta", swagger_favicon_url="/static/favicon.png"
    )


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIQUE / "favicon.png")


_bearer = HTTPBearer(auto_error=False)


def verifier_jeton(identifiants: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    recu = identifiants.credentials if identifiants else ""
    if not secrets.compare_digest(recu.encode(), etat["settings"].beta_token.encode()):
        raise HTTPException(status_code=401, detail="Jeton invalide")


class Reponse(BaseModel):
    texte_reconnu: str
    reponse: str
    route: str
    duree_ms: int
    audio_wav_base64: str | None = None
    # Rempli quand route vaut identification_requise (-> /v1/identite) ou qui_requis (-> /v1/qui)
    demande_id: str | None = None


class Identite(BaseModel):
    demande_id: str
    personne: str = ""
    confiance: float = 0.0
    sans_voix: bool = False


class Empreintes(BaseModel):
    empreintes: list[list[float]]


@dataclass
class _Demande:
    texte: str
    piece: str | None
    expire: float


DUREE_DEMANDE = 60  # secondes pour regarder ou répondre à « C'est pour qui ? »
_demandes: dict[str, _Demande] = {}


class DemandeTexte(BaseModel):
    texte: str
    personne: str | None = None
    confiance: float = 1.0
    piece: str | None = None
    voix: bool = False


def _reprendre(demande_id: str) -> _Demande:
    demande = _demandes.pop(demande_id, None)
    if not demande or demande.expire < time.monotonic():
        raise HTTPException(status_code=404, detail="Demande inconnue ou expirée")
    return demande


async def _repondre(texte: str, voix: bool, debut: float, piece: str | None, **identite) -> Reponse:
    resultat = await etat["routeur"].traiter(texte, piece=piece, **identite)

    demande_id = None
    if resultat.route in (IDENTIFICATION_REQUISE, QUI_REQUIS):
        maintenant = time.monotonic()
        for ancien in [k for k, d in _demandes.items() if d.expire < maintenant]:
            del _demandes[ancien]
        demande_id = secrets.token_urlsafe(12)
        _demandes[demande_id] = _Demande(texte, piece, maintenant + DUREE_DEMANDE)
    log.info("[%s %s] « %s » -> %s : %s", piece, identite, texte, resultat.route, resultat.texte)

    return Reponse(
        texte_reconnu=texte,
        reponse=resultat.texte,
        route=resultat.route,
        duree_ms=int((time.monotonic() - debut) * 1000),
        audio_wav_base64=await _voix(resultat.texte) if voix else None,
        demande_id=demande_id,
    )


async def _voix(texte: str) -> str | None:
    """La réponse lue par Piper, en WAV base64 (None si Piper ne répond pas)."""
    s: cfg.Settings = etat["settings"]
    try:
        return base64.b64encode(await synthetiser(s.piper_host, s.piper_port, texte, s.piper_voix)).decode()
    except OSError:
        log.exception("Piper injoignable, réponse sans voix")
        return None


async def _transcrire(audio: UploadFile) -> str:
    s: cfg.Settings = etat["settings"]
    try:
        return await transcrire(s.whisper_host, s.whisper_port, await audio.read(), s.langue)
    except ErreurAudio as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=503, detail="Whisper injoignable") from e


@app.post("/v1/commande", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def commande(
    audio: UploadFile = File(..., description="WAV 16 kHz mono 16 bits"),
    personne: str = Form(""),
    confiance: float = Form(0.0),
    piece: str = Form("", description="Pièce de la tablette, pour savoir qui est à cet étage"),
    # Un booléen absent d'un formulaire vaut False (comme une case décochée), d'où le « sans_ »
    sans_voix: bool = Form(False),
):
    """Appelé par la tablette après « Hey Bêta », sans caméra. Si la demande est personnelle et que
    personne d'autre n'est à l'étage, Bêta sait déjà qui parle ; sinon la réponse vaut
    `identification_requise`."""
    debut = time.monotonic()
    texte = await _transcrire(audio)
    return await _repondre(
        texte, not sans_voix, debut, piece or None, personne=personne or None, confiance=confiance, etape=INITIALE
    )


@app.post("/v1/identite", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def identite(demande: Identite):
    """La tablette a regardé qui parle : on reprend la demande mise de côté, sans la redemander."""
    d = _reprendre(demande.demande_id)
    return await _repondre(
        d.texte, not demande.sans_voix, time.monotonic(), d.piece,
        personne=demande.personne or None, confiance=demande.confiance, etape=APRES_CAMERA,
    )


@app.post("/v1/qui", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def qui(
    audio: UploadFile = File(..., description="La réponse à « C'est pour qui ? »"),
    demande_id: str = Form(...),
    sans_voix: bool = Form(False),
):
    """Réponse à « C'est pour qui ? » : on cherche un prénom connu dans la phrase."""
    debut = time.monotonic()
    d = _reprendre(demande_id)
    nom = prenom_dans(await _transcrire(audio), etat["settings"])
    if not nom:
        message = "Je ne connais pas ce prénom."
        return Reponse(
            texte_reconnu=d.texte,
            reponse=message,
            route="refus",
            duree_ms=int((time.monotonic() - debut) * 1000),
            audio_wav_base64=None if sans_voix else await _voix(message),
        )
    return await _repondre(d.texte, not sans_voix, debut, d.piece, personne=nom, niveau=cfg.DECLARATION)


@app.post("/v1/visages/{nom}", dependencies=[Depends(verifier_jeton)])
async def envoyer_visages(nom: str, donnees: Empreintes):
    """La tablette partage les visages enregistrés avec le service de présence (caméras)."""
    s: cfg.Settings = etat["settings"]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{s.presence_url}/visages/{nom}",
                headers={"Authorization": f"Bearer {s.beta_token}"},
                json=donnees.model_dump(),
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Service de présence injoignable") from e
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@app.post("/v1/texte", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def texte(demande: DemandeTexte):
    """Même chose sans audio : pratique pour tester depuis un navigateur ou un terminal."""
    return await _repondre(
        demande.texte, demande.voix, time.monotonic(), demande.piece,
        personne=demande.personne, confiance=demande.confiance,
    )


@app.get("/sante")
async def sante():
    routeur: Routeur = etat["routeur"]
    return {"beta": "ok", "home_assistant": await routeur.ha.en_ligne(), "ia_web": routeur.ia_web is not None}
