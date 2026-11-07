"""Plex pour la page Bêta home : ce qui est en cours, à reprendre, ajouté récemment.

Réglages dans .env : PLEX_URL (ex : http://192.168.68.91:32400) et PLEX_TOKEN (le « X-Plex-Token » de ton
compte). Le jeton reste sur le NAS : les affiches passent par Bêta (/v1/plex/image), jamais avec le jeton.
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

TAILLE_LISTE = 16


class PlexIndisponible(Exception):
    pass


class Plex:
    def __init__(self, url: str, jeton: str, timeout: float = 8.0):
        self.url = url.rstrip("/")
        self.jeton = jeton
        self.timeout = timeout
        self._serveur: dict | None = None

    @property
    def configure(self) -> bool:
        return bool(self.url and self.jeton)

    async def _get(self, client: httpx.AsyncClient, chemin: str, **params) -> dict:
        r = await client.get(f"{self.url}{chemin}", params=params,
                             headers={"Accept": "application/json", "X-Plex-Token": self.jeton})
        if r.status_code == 401:
            raise PlexIndisponible("jeton Plex refusé (PLEX_TOKEN)")
        r.raise_for_status()
        return r.json().get("MediaContainer", {})

    async def apercu(self) -> dict:
        if not self.configure:
            return {"configure": False}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if self._serveur is None:
                    racine = await self._get(client, "/")
                    self._serveur = {"nom": racine.get("friendlyName", "Plex"), "id": racine.get("machineIdentifier", "")}
                sessions = await self._get(client, "/status/sessions")
                reprendre = await self._get(client, "/library/onDeck", **{"X-Plex-Container-Size": TAILLE_LISTE})
                ajouts = await self._get(client, "/library/recentlyAdded", **{"X-Plex-Container-Size": TAILLE_LISTE})
        except PlexIndisponible as e:
            return {"configure": True, "erreur": str(e)}
        except (httpx.HTTPError, ValueError) as e:
            return {"configure": True, "erreur": f"Plex injoignable ({type(e).__name__})"}
        return {
            "configure": True,
            "serveur": self._serveur["nom"],
            "en_cours": [self._media(m, session=True) for m in sessions.get("Metadata", [])],
            "reprendre": [self._media(m) for m in reprendre.get("Metadata", [])],
            "ajouts": [self._media(m) for m in ajouts.get("Metadata", [])],
        }

    def _media(self, m: dict, session: bool = False) -> dict:
        type_ = m.get("type", "")
        if type_ == "episode":
            titre = m.get("grandparentTitle") or m.get("title", "")
            sous_titre = f"S{m.get('parentIndex', '?')} · É{m.get('index', '?')} · {m.get('title', '')}"
            image = m.get("grandparentThumb") or m.get("thumb")
        elif type_ == "season":
            titre, sous_titre, image = m.get("parentTitle") or m.get("title", ""), m.get("title", ""), m.get("thumb")
        else:
            titre, sous_titre, image = m.get("title", ""), str(m.get("year", "")), m.get("thumb")
        duree, position = m.get("duration") or 0, m.get("viewOffset") or 0
        resultat = {
            "titre": titre, "sous_titre": sous_titre, "type": {"movie": "Film", "episode": "Série", "season": "Série",
                                                               "show": "Série", "track": "Musique"}.get(type_, type_),
            "image": image or "", "progression": round(100 * position / duree) if duree else 0,
            "lien": self.lien(m.get("ratingKey")),
        }
        if session:
            resultat |= {"qui": (m.get("User") or {}).get("title", ""), "lecteur": (m.get("Player") or {}).get("title", ""),
                         "etat": (m.get("Player") or {}).get("state", "")}
        return resultat

    def lien(self, cle) -> str:
        """Ouvre la fiche dans Plex (application web), d'où « Reprendre » relance la lecture."""
        if not cle or not self._serveur or not self._serveur.get("id"):
            return "https://app.plex.tv/desktop"
        return (f"https://app.plex.tv/desktop/#!/server/{self._serveur['id']}/details?key="
                + quote(f"/library/metadata/{cle}", safe=""))

    async def image(self, chemin: str) -> tuple[bytes, str]:
        """Affiche réduite par Plex (rapide sur une tablette). Seuls les chemins de la bibliothèque sont acceptés."""
        if not self.configure or not chemin.startswith("/library/") or ".." in chemin:
            raise PlexIndisponible("image refusée")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.url}/photo/:/transcode",
                                 params={"width": 320, "height": 480, "minSize": 1, "upscale": 1, "url": chemin},
                                 headers={"X-Plex-Token": self.jeton})
            r.raise_for_status()
            return r.content, r.headers.get("content-type", "image/jpeg")
