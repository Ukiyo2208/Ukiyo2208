"""API de Bêta : la tablette envoie l'audio + qui parle, Bêta répond en texte et en voix."""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import logging
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import settings as cfg
from . import nas
from . import stats as st
from .homeassistant import HomeAssistant
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
    llm = LLMLocal(s.ia, s.ollama_url, s.ollama_model)
    localisation = Localisation(s, ha)
    etat.update(settings=s, routeur=Routeur(s, ha, llm, s.ia, localisation))
    prechauffage = asyncio.create_task(llm.prechauffer())
    publication = asyncio.create_task(_publier_en_boucle()) if s.publication_url else None
    for tache, modeles in s.ia.resume().items():
        log.info("IA pour « %s » : %s", tache, " → ".join(modeles) or "aucune")
    yield
    prechauffage.cancel()
    if publication:
        publication.cancel()
    await ha.fermer()
    await llm.fermer()
    await localisation.fermer()
    await s.ia.fermer()


STATIQUE = Path(__file__).parent / "static"

app = FastAPI(
    title="Bêta",
    description=(
        '<img src="/static/logo.png" width="120" alt="Logo de Bêta">\n\n'
        "L'assistant vocal de la maison. Depuis le réseau de la maison, pas besoin de jeton ; ailleurs, "
        "clique sur **Authorize** et colle ton `BETA_TOKEN`. Essaie `/v1/texte` avec par exemple "
        "`allume la lumière du salon`."
    ),
    lifespan=lifespan,
    docs_url=None,  # remplacée ci-dessous pour afficher le logo dans l'onglet
)
app.mount("/static", StaticFiles(directory=STATIQUE), name="static")


# Un site peut lire /v1/nas depuis le navigateur s'il figure dans BETA_CORS
_reglages_demarrage = cfg.charger()
if _reglages_demarrage.cors_origines:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_reglages_demarrage.cors_origines,
        allow_methods=["GET"],
        allow_headers=["Authorization"],
    )

statistiques = st.Statistiques()
_PAS_SUIVIS = (
    "/static", "/favicon.ico", "/v1/stats", "/v1/nas", "/v1/appairage", "/v1/tri/etat", "/v1/maison/appareils",
    "/tableau", "/tri", "/home", "/api/", "/docs", "/openapi.json",
)


@app.middleware("http")
async def suivre_utilisation(request: Request, appel_suivant):
    """Compte chaque appel de l'API : temps de réponse, statut, client, et ce que Bêta a fait."""
    if request.url.path == "/" or request.url.path.startswith(_PAS_SUIVIS):
        return await appel_suivant(request)
    infos: dict = {}
    st.demande_en_cours.set(infos)
    debut = time.monotonic()
    statut = 500
    try:
        reponse = await appel_suivant(request)
        statut = reponse.status_code
        return reponse
    finally:
        route = request.scope.get("route")
        statistiques.requete(
            request.method,
            getattr(route, "path", request.url.path),
            statut,
            (time.monotonic() - debut) * 1000,
            request.client.host if request.client else "?",
            infos,
        )


@app.get("/docs", include_in_schema=False)
async def docs():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url, title="Bêta", swagger_favicon_url="/static/favicon.png"
    )


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIQUE / "favicon.png")


_bearer = HTTPBearer(auto_error=False)


_ENTETES_PROXY = ("x-forwarded-for", "forwarded", "x-real-ip")


def depuis_la_maison(request: Request) -> bool:
    """Vrai pour un appareil du réseau local (192.168.x.x, 10.x.x.x…) qui se connecte directement.
    Une requête relayée par un proxy (accès à distance) n'en fait jamais partie."""
    s: cfg.Settings = etat["settings"]
    if not s.acces_local_libre or not request.client or any(h in request.headers for h in _ENTETES_PROXY):
        return False
    try:
        ip = ipaddress.ip_address(request.client.host)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_private or ip.is_loopback


def verifier_jeton(request: Request, identifiants: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    """Pas de jeton à la maison ; hors du réseau local, le BETA_TOKEN est obligatoire."""
    recu = identifiants.credentials if identifiants else ""
    if recu:
        if not secrets.compare_digest(recu.encode(), etat["settings"].beta_token.encode()):
            raise HTTPException(status_code=401, detail="Jeton invalide")
        return
    if not depuis_la_maison(request):
        raise HTTPException(status_code=401, detail="Jeton requis hors du réseau de la maison")


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
    mode: str | None = None  # page web : « discussion » ou « maison »


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
    infos = st.demande_en_cours.get()
    if infos is not None:
        infos.update(route=resultat.route, texte=texte)

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
        personne=demande.personne, confiance=demande.confiance, mode=demande.mode,
    )


_services_cache: dict = {"instant": 0.0, "valeur": {}}


async def _services() -> dict:
    # Au plus un tour de vérification toutes les 5 secondes, même avec plusieurs écrans ouverts
    if time.monotonic() - _services_cache["instant"] > 5:
        _services_cache["valeur"] = await st.etat_services(etat["settings"])
        _services_cache["instant"] = time.monotonic()
    return _services_cache["valeur"]


@app.get("/v1/stats", dependencies=[Depends(verifier_jeton)])
async def stats(format: str = "json"):
    """Utilisation de l'API en temps réel. `?format=texte` pour un affichage dans le terminal."""
    instantane, services = statistiques.instantane(), await _services()
    if format == "texte":
        return PlainTextResponse(st.en_texte(instantane, services))
    return {"services": services, **instantane}


@app.get("/v1/appairage", dependencies=[Depends(verifier_jeton)])
async def appairage(request: Request, piece: str = ""):
    """QR code à scanner avec la tablette : adresse de Bêta telle que vue par ce navigateur + jeton."""
    from .installation import lien_appairage, qr_svg  # chargé seulement à l'usage

    lien = lien_appairage(str(request.base_url), etat["settings"].beta_token, piece)
    return Response(qr_svg(lien), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


def verifier_lecture(request: Request, identifiants: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    """Accepte le jeton principal ou le jeton de lecture seule (BETA_LECTURE_TOKEN), ou la maison."""
    recu = (identifiants.credentials if identifiants else "").encode()
    s: cfg.Settings = etat["settings"]
    if not recu and depuis_la_maison(request):
        return
    autorises = [t for t in (s.beta_token, s.lecture_token) if t]
    if not any(secrets.compare_digest(recu, t.encode()) for t in autorises):
        raise HTTPException(status_code=401, detail="Jeton invalide")


_nas_cache: dict = {"instant": 0.0, "valeur": None}


async def _etat_nas() -> dict:
    if _nas_cache["valeur"] is None or time.monotonic() - _nas_cache["instant"] > 5:
        _nas_cache["valeur"] = await nas.etat_complet(etat["settings"], statistiques, await _services())
        _nas_cache["instant"] = time.monotonic()
    return _nas_cache["valeur"]


@app.get("/v1/nas", dependencies=[Depends(verifier_lecture)])
async def infos_nas():
    """Tout l'état du NAS pour un site : système, IA, services, utilisation de l'API.
    Aucune donnée personnelle. Accessible avec le jeton de lecture seule."""
    return await _etat_nas()


async def _publier_en_boucle() -> None:
    """Envoie l'état du NAS au site (PUBLICATION_URL) : le NAS n'a rien à ouvrir sur Internet."""
    s: cfg.Settings = etat["settings"]
    entetes = {"Authorization": f"Bearer {s.publication_jeton}"} if s.publication_jeton else {}
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                r = await client.post(s.publication_url, json=await _etat_nas(), headers=entetes)
                if r.status_code >= 400:
                    log.warning("Le site refuse les infos du NAS (%s)", r.status_code)
            except httpx.HTTPError as e:
                log.warning("Envoi des infos du NAS impossible : %s", e)
            await asyncio.sleep(s.publication_intervalle)


@app.get("/tableau", include_in_schema=False)
async def tableau():
    """Tableau de bord détaillé : interroge /v1/stats toutes les 2 secondes."""
    return HTMLResponse((STATIQUE / "tableau.html").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- Page d'accueil (http://IP_DU_NAS:8800)

APPAREILS_PILOTABLES = ["light", "switch", "cover", "fan", "media_player", "scene", "input_boolean"]


class Bascule(BaseModel):
    entite: str


@app.get("/", include_in_schema=False)
async def accueil():
    return HTMLResponse((STATIQUE / "accueil.html").read_text(encoding="utf-8"))


@app.get("/v1/maison/appareils", dependencies=[Depends(verifier_jeton)])
async def appareils_maison():
    """Lumières, prises, volets… avec leur état et leur pièce (les serrures n'y sont jamais)."""
    try:
        return await etat["routeur"].ha.etats(APPAREILS_PILOTABLES)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Home Assistant injoignable") from e


@app.post("/v1/maison/basculer", dependencies=[Depends(verifier_jeton)])
async def basculer(demande: Bascule):
    if demande.entite.split(".", 1)[0] not in APPAREILS_PILOTABLES:
        raise HTTPException(status_code=400, detail="Appareil non pilotable depuis la page")
    try:
        await etat["routeur"].ha.basculer(demande.entite)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Home Assistant a refusé") from e
    return {"ok": True}


async def _tri(methode: str, chemin: str, **kwargs) -> httpx.Response:
    """Le trieur n'est joignable que par Bêta (réseau Docker interne) : c'est Bêta qui contrôle l'accès."""
    s: cfg.Settings = etat["settings"]
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            return await client.request(methode, f"{s.tri_url}{chemin}", **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Tri des documents injoignable") from e


async def _tri_json(methode: str, chemin: str, **kwargs) -> dict:
    r = await _tri(methode, chemin, **kwargs)
    if r.status_code >= 400:
        raise HTTPException(status_code=503, detail="Tri des documents injoignable")
    return r.json()


@app.get("/v1/tri/etat", dependencies=[Depends(verifier_jeton)])
async def etat_tri():
    """État du tri des documents."""
    return await _tri_json("GET", "/api/etat")


class LancementTri(BaseModel):
    nombre: int = 5
    tout: bool = False  # tous les documents à la suite, jusqu'à l'arrêt


@app.post("/v1/tri/lancer", dependencies=[Depends(verifier_jeton)])
async def lancer_tri(demande: LancementTri | None = None):
    """Prépare `nombre` propositions tout de suite, ou toutes (`tout`) jusqu'à /v1/tri/arreter."""
    return await _tri_json("POST", "/api/lancer", json=(demande or LancementTri()).model_dump())


@app.post("/v1/tri/arreter", dependencies=[Depends(verifier_jeton)])
async def arreter_tri():
    """Arrête le traitement en cours après le document en cours d'analyse."""
    return await _tri_json("POST", "/api/arreter", json={})


@app.get("/tri", include_in_schema=False)
async def page_tri_sans_barre():
    return RedirectResponse("/tri/")


@app.get("/tri/", include_in_schema=False)
async def page_tri():
    """Page du tri (validation des propositions, dossiers à trier). Elle appelle /tri/api/…"""
    r = await _tri("GET", "/")
    return HTMLResponse(r.text, status_code=r.status_code)


@app.api_route("/tri/api/{chemin:path}", methods=["GET", "POST"], include_in_schema=False,
               dependencies=[Depends(verifier_jeton)])
async def api_tri(chemin: str, request: Request):
    r = await _tri(request.method, f"/api/{chemin}", params=request.query_params, content=await request.body(),
                   headers={"Content-Type": "application/json"})
    return Response(r.content, status_code=r.status_code, media_type="application/json",
                    headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- Bêta home (http://IP_DU_NAS:8800/home/)
# L'application Bêta home est servie sous /home/ et son serveur répond sur /api/… (Bêta n'utilise que /v1/).
# Bêta home garde sa propre sécurité (clé BETA_HOME_KEY, écrans associés par QR code).

_ENTETES_VERS_HOME = {"content-type", "accept", "accept-language", "if-none-match", "if-modified-since",
                      "x-beta-key", "x-beta-device", "x-beta-session"}
_ENTETES_DE_HOME = {"content-type", "cache-control", "etag", "last-modified", "content-disposition", "location"}
# Petit script ajouté à la page : ce que l'assistant de Bêta home ne comprend pas part à Bêta IA
_PONT_HOME = '<script src="/static/pont-beta-home.js" defer></script>'


async def _home(request: Request, chemin: str) -> Response:
    s: cfg.Settings = etat["settings"]
    entetes = {k: v for k, v in request.headers.items() if k.lower() in _ENTETES_VERS_HOME}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.request(request.method, f"{s.home_url}{chemin}", params=request.query_params,
                                     content=await request.body(), headers=entetes)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail="Bêta home injoignable") from e
    retour = {k: v for k, v in r.headers.items() if k.lower() in _ENTETES_DE_HOME}
    if retour.get("location", "").startswith("/") and not chemin.startswith("/api/"):
        retour["location"] = "/home" + retour["location"]
    contenu = r.content
    if r.headers.get("content-type", "").startswith("text/html"):
        contenu = contenu.replace(b"</body>", _PONT_HOME.encode() + b"</body>", 1)
        retour.pop("etag", None)  # la page modifiée n'a plus la même empreinte
    return Response(contenu, status_code=r.status_code, headers=retour)


@app.get("/home", include_in_schema=False)
async def page_home_sans_barre():
    return RedirectResponse("/home/")


@app.api_route("/home/{chemin:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def page_home(chemin: str, request: Request):
    return await _home(request, "/" + chemin)


@app.api_route("/api/{chemin:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
async def api_home(chemin: str, request: Request):
    return await _home(request, "/api/" + chemin)


@app.get("/sante")
async def sante():
    routeur: Routeur = etat["routeur"]
    return {
        "beta": "ok",
        "home_assistant": await routeur.ha.en_ligne(),
        "ia_web": routeur.ia is not None and routeur.ia.disponible("automatisations"),
        "ia": routeur.ia.resume() if routeur.ia else {},
    }
