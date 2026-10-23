"""API de Bêta : la tablette envoie l'audio + qui parle, Bêta répond en texte et en voix."""

from __future__ import annotations

import asyncio
import base64
import logging
import secrets
import time
from pathlib import Path
from contextlib import asynccontextmanager

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
from .routeur import Routeur
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
    etat.update(settings=s, routeur=Routeur(s, ha, llm, ia_web))
    prechauffage = asyncio.create_task(llm.prechauffer())
    log.info("Bêta démarré (IA web %s)", "activée" if ia_web else "désactivée")
    yield
    prechauffage.cancel()
    await ha.fermer()
    await llm.fermer()
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


class DemandeTexte(BaseModel):
    texte: str
    personne: str | None = None
    confiance: float = 1.0
    voix: bool = False


async def _repondre(texte: str, personne: str | None, confiance: float, voix: bool, debut: float) -> Reponse:
    s: cfg.Settings = etat["settings"]
    resultat = await etat["routeur"].traiter(texte, personne, confiance)
    log.info("[%s %.2f] « %s » -> %s : %s", personne, confiance, texte, resultat.route, resultat.texte)

    audio = None
    if voix:
        try:
            wav = await synthetiser(s.piper_host, s.piper_port, resultat.texte, s.piper_voix)
            audio = base64.b64encode(wav).decode()
        except OSError:
            log.exception("Piper injoignable, réponse sans voix")

    return Reponse(
        texte_reconnu=texte,
        reponse=resultat.texte,
        route=resultat.route,
        duree_ms=int((time.monotonic() - debut) * 1000),
        audio_wav_base64=audio,
    )


@app.post("/v1/commande", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def commande(
    audio: UploadFile = File(..., description="WAV 16 kHz mono 16 bits"),
    personne: str = Form(""),
    confiance: float = Form(0.0),
    # Un booléen absent d'un formulaire vaut False (comme une case décochée), d'où le « sans_ »
    sans_voix: bool = Form(False),
):
    """Appelé par la tablette après « Hey Bêta » + reconnaissance du visage."""
    debut = time.monotonic()
    s: cfg.Settings = etat["settings"]
    try:
        texte = await transcrire(s.whisper_host, s.whisper_port, await audio.read(), s.langue)
    except ErreurAudio as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OSError as e:
        raise HTTPException(status_code=503, detail="Whisper injoignable") from e
    return await _repondre(texte, personne or None, confiance, not sans_voix, debut)


@app.post("/v1/texte", response_model=Reponse, dependencies=[Depends(verifier_jeton)])
async def texte(demande: DemandeTexte):
    """Même chose sans audio : pratique pour tester depuis un navigateur ou un terminal."""
    return await _repondre(demande.texte, demande.personne, demande.confiance, demande.voix, time.monotonic())


@app.get("/sante")
async def sante():
    routeur: Routeur = etat["routeur"]
    return {"beta": "ok", "home_assistant": await routeur.ha.en_ligne(), "ia_web": routeur.ia_web is not None}
