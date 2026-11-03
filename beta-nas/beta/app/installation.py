"""Outils de l'installateur (installer.sh), lancés dans le conteneur Bêta.

    python -m app.installation ha --url URL --nom NOM --utilisateur U --mot-de-passe P
        Crée le compte Home Assistant si HA vient d'être installé (sinon se connecte avec ce compte),
        puis affiche un jeton d'accès longue durée pour Bêta.

    python -m app.installation qr --url URL_BETA --jeton JETON [--piece PIECE]
        Affiche le QR code à scanner avec la tablette (adresse du NAS + jeton + pièce).
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
import time
from urllib.parse import urlencode

import httpx
import qrcode
import websockets

# Identifiant « client » au sens de Home Assistant : une adresse locale est acceptée telle quelle
CLIENT_ID = "http://127.0.0.1:8123/"
REDIRECT_URI = "http://127.0.0.1:8123/?auth_callback=1"


class ErreurInstallation(RuntimeError):
    pass


def lien_appairage(url: str, jeton: str, piece: str = "") -> str:
    return "beta://appairage?" + urlencode({"url": url.rstrip("/"), "jeton": jeton, "piece": piece})


def qr_svg(contenu: str) -> str:
    import qrcode.image.svg

    image = qrcode.make(contenu, image_factory=qrcode.image.svg.SvgPathFillImage, box_size=10, border=2)
    sortie = io.BytesIO()
    image.save(sortie)
    return sortie.getvalue().decode()


def afficher_qr(contenu: str) -> None:
    qr = qrcode.QRCode(border=2)
    qr.add_data(contenu)
    qr.print_ascii(out=sys.stdout, invert=True)


# ---------------------------------------------------------------- Home Assistant


async def attendre_ha(client: httpx.AsyncClient, delai: float = 120) -> None:
    fin = time.monotonic() + delai
    while time.monotonic() < fin:
        try:
            if (await client.get("/api/onboarding")).status_code in (200, 401, 404):
                return
        except httpx.HTTPError:
            pass
        await asyncio.sleep(3)
    raise ErreurInstallation(f"Home Assistant ne répond pas à l'adresse {client.base_url}")


async def _jeton_court(client: httpx.AsyncClient, code: str) -> str:
    r = await client.post(
        "/auth/token", data={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID}
    )
    if r.status_code != 200:
        raise ErreurInstallation(f"Échange du code refusé ({r.status_code}) : {r.text}")
    return r.json()["access_token"]


async def _creer_compte(client: httpx.AsyncClient, nom: str, utilisateur: str, mot_de_passe: str) -> str:
    r = await client.post("/api/onboarding/users", json={
        "client_id": CLIENT_ID, "name": nom, "username": utilisateur, "password": mot_de_passe, "language": "fr",
    })
    if r.status_code != 200:
        raise ErreurInstallation(f"Création du compte refusée ({r.status_code}) : {r.text}")
    jeton = await _jeton_court(client, r.json()["auth_code"])
    entetes = {"Authorization": f"Bearer {jeton}"}
    # Termine l'accueil de Home Assistant pour que l'interface s'ouvre directement
    for etape in ("core_config", "analytics"):
        await client.post(f"/api/onboarding/{etape}", headers=entetes, json={})
    await client.post(
        "/api/onboarding/integration", headers=entetes, json={"client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI}
    )
    return jeton


async def _se_connecter(client: httpx.AsyncClient, utilisateur: str, mot_de_passe: str) -> str:
    r = await client.post("/auth/login_flow", json={
        "client_id": CLIENT_ID, "handler": ["homeassistant", None], "redirect_uri": REDIRECT_URI,
    })
    r.raise_for_status()
    flux = r.json()["flow_id"]
    r = await client.post(
        f"/auth/login_flow/{flux}",
        json={"client_id": CLIENT_ID, "username": utilisateur, "password": mot_de_passe},
    )
    resultat = r.json()
    if resultat.get("type") != "create_entry":
        raise ErreurInstallation("Identifiants Home Assistant refusés")
    return await _jeton_court(client, resultat["result"])


async def _jeton_longue_duree(url: str, jeton_court: str) -> str:
    ws_url = url.replace("http", "ws", 1).rstrip("/") + "/api/websocket"
    async with websockets.connect(ws_url) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": jeton_court}))
        if json.loads(await ws.recv()).get("type") != "auth_ok":
            raise ErreurInstallation("Authentification WebSocket refusée")
        await ws.send(json.dumps({
            # Home Assistant refuse deux jetons du même nom : on date chaque jeton
            "id": 1, "type": "auth/long_lived_access_token", "lifespan": 3650,
            "client_name": f"Bêta ({time.strftime('%Y-%m-%d %H:%M:%S')})",
        }))
        reponse = json.loads(await ws.recv())
        if not reponse.get("success"):
            raise ErreurInstallation(f"Création du jeton refusée : {reponse}")
        return reponse["result"]


async def jeton_home_assistant(url: str, nom: str, utilisateur: str, mot_de_passe: str) -> tuple[str, bool]:
    """Retourne (jeton longue durée, compte_cree)."""
    async with httpx.AsyncClient(base_url=url.rstrip("/"), timeout=30) as client:
        await attendre_ha(client)
        r = await client.get("/api/onboarding")
        etapes = r.json() if r.status_code == 200 else []
        compte_a_creer = any(e.get("step") == "user" and not e.get("done") for e in etapes)
        if compte_a_creer:
            jeton = await _creer_compte(client, nom, utilisateur, mot_de_passe)
        else:
            jeton = await _se_connecter(client, utilisateur, mot_de_passe)
    return await _jeton_longue_duree(url, jeton), compte_a_creer


def main(arguments: list[str] | None = None) -> int:
    parseur = argparse.ArgumentParser(prog="python -m app.installation")
    sous = parseur.add_subparsers(dest="commande", required=True)
    ha = sous.add_parser("ha")
    ha.add_argument("--url", required=True)
    ha.add_argument("--nom", required=True)
    ha.add_argument("--utilisateur", required=True)
    ha.add_argument("--mot-de-passe", required=True)
    qr = sous.add_parser("qr")
    qr.add_argument("--url", required=True)
    qr.add_argument("--jeton", required=True)
    qr.add_argument("--piece", default="")
    args = parseur.parse_args(arguments)

    if args.commande == "qr":
        afficher_qr(lien_appairage(args.url, args.jeton, args.piece))
        return 0
    try:
        jeton, cree = asyncio.run(jeton_home_assistant(args.url, args.nom, args.utilisateur, args.mot_de_passe))
    except (ErreurInstallation, httpx.HTTPError, OSError, websockets.WebSocketException) as e:
        print(f"ERREUR : {e}", file=sys.stderr)
        return 1
    print(f"Compte Home Assistant {'créé' if cree else 'existant utilisé'}", file=sys.stderr)
    print(jeton)
    return 0


if __name__ == "__main__":
    sys.exit(main())
