"""Caméras branchées directement sur Bêta, sans Home Assistant : ONVIF ou adresse RTSP.

- ONVIF : adresse IP, identifiant et mot de passe de la caméra. Bêta demande à la caméra son flux vidéo (RTSP)
  et son adresse d'image fixe (snapshot). Presque toutes les caméras IP le font (Reolink, Hikvision, Dahua,
  Tapo, Amcrest, Foscam…) ; sur certaines, il faut activer ONVIF dans leur application.
- RTSP : l'adresse du flux, par exemple rtsp://admin:motdepasse@192.168.68.50:554/h264Preview_01_main

Les navigateurs ne savent pas lire le RTSP : Bêta le transforme avec ffmpeg en images (tuile, rafraîchie toutes
les quelques secondes) ou en vidéo MJPEG (direct, dans le sous-menu). Les mots de passe restent sur le NAS
(data/beta/cameras.json) et ne sont jamais renvoyés au navigateur.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx

log = logging.getLogger("beta.cameras")

DUREE_IMAGE = 2.0  # secondes : une image fixe sert à tous les écrans pendant ce temps
IMAGES_PAR_SECONDE = 5  # direct MJPEG : suffisant pour surveiller, léger pour le NAS
LARGEUR_DIRECT = 1280
DUREE_DIRECT = 900  # secondes : un direct oublié ouvert s'arrête tout seul (la page le relance)


class ErreurCamera(Exception):
    pass


# ---------------------------------------------------------------- ONVIF (SOAP minimal)

_NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tt": "http://www.onvif.org/ver10/schema",
}


def _securite(utilisateur: str, mot_de_passe: str) -> str:
    """En-tête WS-Security « UsernameToken » avec mot de passe chiffré (PasswordDigest), demandé par ONVIF."""
    nonce = secrets.token_bytes(16)
    cree = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    empreinte = base64.b64encode(hashlib.sha1(nonce + cree.encode() + mot_de_passe.encode()).digest()).decode()
    return (
        '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
        f"<UsernameToken><Username>{_xml(utilisateur)}</Username>"
        '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">'
        f"{empreinte}</Password>"
        '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">'
        f"{base64.b64encode(nonce).decode()}</Nonce>"
        f'<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{cree}</Created>'
        "</UsernameToken></Security>"
    )


def _xml(texte: str) -> str:
    return str(texte).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _soap(client: httpx.AsyncClient, adresse: str, corps: str, utilisateur: str, mot_de_passe: str) -> ElementTree.Element:
    enveloppe = (
        f'<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="{_NS["s"]}">'
        f"<s:Header>{_securite(utilisateur, mot_de_passe)}</s:Header><s:Body>{corps}</s:Body></s:Envelope>"
    )
    r = await client.post(adresse, content=enveloppe.encode(), headers={"Content-Type": "application/soap+xml; charset=utf-8"},
                          auth=httpx.DigestAuth(utilisateur, mot_de_passe))
    if r.status_code in (400, 401, 403, 500) and ("NotAuthorized" in r.text or r.status_code in (401, 403)):
        raise ErreurCamera("identifiant ou mot de passe refusé par la caméra (ONVIF)")
    r.raise_for_status()
    try:
        return ElementTree.fromstring(r.content)
    except ElementTree.ParseError as e:
        raise ErreurCamera("réponse ONVIF illisible") from e


def _texte(racine: ElementTree.Element, chemin: str) -> str:
    noeud = racine.find(chemin, _NS)
    return (noeud.text or "").strip() if noeud is not None else ""


def _avec_identifiants(adresse: str, utilisateur: str, mot_de_passe: str) -> str:
    """rtsp://hôte/… -> rtsp://utilisateur:motdepasse@hôte/… (la plupart des caméras l'attendent ainsi)."""
    morceaux = urlsplit(adresse)
    if not utilisateur or "@" in morceaux.netloc:
        return adresse
    hote = morceaux.netloc
    return urlunsplit(morceaux._replace(netloc=f"{quote(utilisateur, safe='')}:{quote(mot_de_passe, safe='')}@{hote}"))


async def decouvrir_onvif(ip: str, port: int, utilisateur: str, mot_de_passe: str, timeout: float = 8) -> dict:
    """Demande à la caméra son flux RTSP principal et son adresse d'image fixe."""
    if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", ip or ""):
        raise ErreurCamera("adresse IP invalide")
    adresse = f"http://{ip}:{int(port)}/onvif/device_service"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            capacites = await _soap(client, adresse, '<GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl">'
                                    "<Category>Media</Category></GetCapabilities>", utilisateur, mot_de_passe)
            media = _texte(capacites, ".//tt:Media/tt:XAddr") or adresse
            profils = await _soap(client, media, '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>', utilisateur, mot_de_passe)
            jetons = [p.get("token") for p in profils.findall(".//trt:Profiles", _NS) if p.get("token")]
            if not jetons:
                raise ErreurCamera("la caméra ne donne aucun profil vidéo")
            jeton = jetons[0]  # le premier profil est le flux principal (le meilleur)
            flux = await _soap(client, media, '<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">'
                               '<StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>'
                               '<Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>RTSP</Protocol></Transport></StreamSetup>'
                               f"<ProfileToken>{_xml(jeton)}</ProfileToken></GetStreamUri>", utilisateur, mot_de_passe)
            rtsp = _texte(flux, ".//tt:Uri")
            image = ""
            try:
                fixe = await _soap(client, media, '<GetSnapshotUri xmlns="http://www.onvif.org/ver10/media/wsdl">'
                                   f"<ProfileToken>{_xml(jeton)}</ProfileToken></GetSnapshotUri>", utilisateur, mot_de_passe)
                image = _texte(fixe, ".//tt:Uri")
            except (httpx.HTTPError, ErreurCamera):
                pass  # pas d'image fixe : ffmpeg en tirera une du flux
    except httpx.ConnectError as e:
        raise ErreurCamera(f"caméra injoignable sur {ip}:{port} (ONVIF activé ? bon port ? souvent 80, 8000 ou 2020)") from e
    except httpx.TimeoutException as e:
        raise ErreurCamera(f"la caméra {ip} ne répond pas") from e
    except httpx.HTTPError as e:
        raise ErreurCamera(f"ONVIF refusé par la caméra ({e})") from e
    if not rtsp:
        raise ErreurCamera("la caméra ne donne pas de flux RTSP")
    return {"rtsp": _avec_identifiants(rtsp, utilisateur, mot_de_passe), "image": image}


# ---------------------------------------------------------------- Liste des caméras

class Cameras:
    def __init__(self, fichier: Path, ffmpeg: str = "ffmpeg"):
        self.fichier = fichier
        self.ffmpeg = ffmpeg
        self._images: dict[str, tuple[float, bytes]] = {}
        self._verrous: dict[str, asyncio.Lock] = {}
        try:
            self.liste: list[dict] = json.loads(fichier.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.liste = []

    def _sauver(self) -> None:
        self.fichier.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.liste, ensure_ascii=False, indent=1), encoding="utf-8")
        os.chmod(tmp, 0o600)  # mots de passe des caméras : lisibles par Bêta seulement
        os.replace(tmp, self.fichier)

    @staticmethod
    def publique(c: dict) -> dict:
        """Ce que la page peut voir : jamais le mot de passe ni l'adresse complète du flux."""
        hote = urlsplit(c.get("rtsp", "")).hostname or ""
        return {"id": c["id"], "nom": c["nom"], "piece": c.get("piece", ""), "source": c.get("source", "rtsp"), "hote": hote}

    def publiques(self) -> list[dict]:
        return [self.publique(c) for c in self.liste]

    def trouver(self, ident: str) -> dict:
        c = next((c for c in self.liste if c["id"] == ident), None)
        if not c:
            raise ErreurCamera("caméra inconnue")
        return c

    async def ajouter(self, nom: str, piece: str = "", rtsp: str = "", ip: str = "", port: int = 80,
                      utilisateur: str = "", mot_de_passe: str = "") -> dict:
        nom = (nom or "").strip()[:60] or "Caméra"
        if rtsp:
            if not re.match(r"^rtsps?://", rtsp.strip()):
                raise ErreurCamera("l'adresse doit commencer par rtsp://")
            infos = {"rtsp": _avec_identifiants(rtsp.strip(), utilisateur, mot_de_passe), "image": "", "source": "rtsp"}
        else:
            infos = await decouvrir_onvif(ip.strip(), port, utilisateur, mot_de_passe) | {"source": "onvif"}
        camera = {"id": uuid.uuid4().hex[:10], "nom": nom, "piece": (piece or "").strip()[:60], **infos,
                  "utilisateur": utilisateur, "mot_de_passe": mot_de_passe}
        await self.image(camera)  # vérifie qu'on obtient bien une image avant d'enregistrer
        self.liste.append(camera)
        self._sauver()
        return self.publique(camera)

    def supprimer(self, ident: str) -> None:
        self.trouver(ident)
        self.liste = [c for c in self.liste if c["id"] != ident]
        self._images.pop(ident, None)
        self._sauver()

    # ---------------------------------------------------------------- images

    async def image(self, camera: dict) -> bytes:
        """Une image JPEG : l'adresse d'image fixe de la caméra si elle en a une (rapide), sinon tirée du flux."""
        cle = camera.get("id", "")
        deja = self._images.get(cle)
        if deja and time.monotonic() - deja[0] < DUREE_IMAGE:
            return deja[1]
        verrou = self._verrous.setdefault(cle, asyncio.Lock())
        async with verrou:  # plusieurs écrans en même temps : une seule demande à la caméra
            deja = self._images.get(cle)
            if deja and time.monotonic() - deja[0] < DUREE_IMAGE:
                return deja[1]
            contenu = None
            if camera.get("image"):
                try:
                    contenu = await self._image_fixe(camera)
                except (httpx.HTTPError, ErreurCamera) as e:
                    log.info("%s : image fixe indisponible (%s), image tirée du flux", camera.get("nom"), e)
            if contenu is None:
                contenu = await self._image_du_flux(camera["rtsp"])
            if cle:
                self._images[cle] = (time.monotonic(), contenu)
            return contenu

    async def _image_fixe(self, camera: dict) -> bytes:
        auth = httpx.DigestAuth(camera.get("utilisateur", ""), camera.get("mot_de_passe", "")) if camera.get("utilisateur") else None
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(camera["image"], auth=auth)
            if r.status_code == 401 and camera.get("utilisateur"):  # caméras en authentification simple
                r = await client.get(camera["image"], auth=(camera["utilisateur"], camera.get("mot_de_passe", "")))
            r.raise_for_status()
        if not r.content.startswith(b"\xff\xd8"):
            raise ErreurCamera("ce n'est pas une image JPEG")
        return r.content

    def _entree(self, rtsp: str) -> list[str]:
        options = ["-rtsp_transport", "tcp"] if rtsp.startswith("rtsp") else []
        return [self.ffmpeg, "-hide_banner", "-loglevel", "error", *options, "-i", rtsp]

    async def _image_du_flux(self, rtsp: str, timeout: float = 12) -> bytes:
        proc = await asyncio.create_subprocess_exec(
            *self._entree(rtsp), "-frames:v", "1", "-vf", f"scale='min({LARGEUR_DIRECT},iw)':-2", "-f", "image2", "-c:v", "mjpeg",
            "-q:v", "5", "pipe:1", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            sortie, erreurs = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError as e:
            proc.kill()
            raise ErreurCamera("la caméra ne répond pas (flux RTSP)") from e
        if proc.returncode != 0 or not sortie.startswith(b"\xff\xd8"):
            message = erreurs.decode(errors="replace").strip().splitlines()[-1:] or ["flux illisible"]
            if "401" in message[0] or "Unauthorized" in message[0]:
                raise ErreurCamera("identifiant ou mot de passe refusé par la caméra (RTSP)")
            raise ErreurCamera(f"flux vidéo illisible : {message[0][:160]}")
        return sortie

    async def direct(self, camera: dict):
        """Vidéo en direct pour le navigateur (MJPEG : une suite d'images, lue par une simple balise <img>).
        ffmpeg s'arrête dès que la page est fermée."""
        proc = await asyncio.create_subprocess_exec(
            *self._entree(camera["rtsp"]), "-t", str(DUREE_DIRECT), "-an", "-vf", f"fps={IMAGES_PAR_SECONDE},scale='min({LARGEUR_DIRECT},iw)':-2",
            "-c:v", "mjpeg", "-q:v", "6", "-f", "mpjpeg", "pipe:1",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            while True:
                bloc = await proc.stdout.read(65536)
                if not bloc:
                    break
                yield bloc
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
