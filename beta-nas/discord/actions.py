"""Ce que fait le bot Discord de Bêta, sans Discord : appels à Bêta (maison, IA, alertes, énergie, caméras) et à
Bêta Tool (colis, agenda, tâches, courses, rappels, vidéos, fichiers, papiers). Chaque fonction renvoie une
Reponse (titre, texte, champs, image éventuelle) que bot.py met en forme. Testable sans réseau (httpx mocké)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import httpx

BETA_URL = os.environ.get("BETA_URL", "http://beta:8800").rstrip("/")
BETA_TOKEN = os.environ.get("BETA_TOKEN", "")
TOOL_URL = os.environ.get("BETA_TOOL_URL", "http://beta-tool:8080").rstrip("/")
TOOL_JETON = os.environ.get("BETA_TOOL_JETON", "")
TOOL_LIEN = os.environ.get("BETA_TOOL_LIEN", "").rstrip("/")
METEO = {"sunny": "☀️", "clear-night": "🌙", "cloudy": "☁️", "partlycloudy": "⛅", "rainy": "🌧️", "pouring": "🌧️",
         "snowy": "🌨️", "fog": "🌫️", "windy": "💨", "lightning": "🌩️", "lightning-rainy": "⛈️"}


@dataclass
class Reponse:
    texte: str
    titre: str = ""
    champs: list[tuple[str, str]] = field(default_factory=list)
    image: bytes | None = None
    nom_image: str = "image.jpg"
    couleur: int = 0x2F86FF
    lien: str = ""


class Erreur(Exception):
    pass


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10))


async def _beta(methode: str, chemin: str, **kw):
    async with _client() as c:
        r = await c.request(methode, BETA_URL + chemin, headers={"Authorization": f"Bearer {BETA_TOKEN}"}, **kw)
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = None
        raise Erreur(detail or f"Bêta a répondu {r.status_code}")
    return r


async def _tool(methode: str, chemin: str, **kw):
    if not TOOL_JETON:
        raise Erreur("Bêta Tool n'est pas relié (BETA_TOOL_JETON) : relance l'installateur de Bêta.")
    async with _client() as c:
        r = await c.request(methode, TOOL_URL + chemin, headers={"Authorization": f"Bearer {TOOL_JETON}"}, **kw)
    if r.status_code >= 400:
        try:
            detail = r.json().get("error")
        except ValueError:
            detail = None
        raise Erreur(detail or f"Bêta Tool a répondu {r.status_code}")
    return r


# --- Bêta : discussion, maison --------------------------------------------------------------------------

async def parler(texte: str, personne: str | None) -> Reponse:
    """Une phrase pour Bêta, comme à la tablette : « allume le salon », « ferme les volets », une question…
    La personne est reconnue (compte Discord autorisé) : elle a les droits de son rôle."""
    r = (await _beta("POST", "/v1/texte", json={"texte": texte, "personne": personne, "confiance": 1.0})).json()
    return Reponse(r.get("reponse") or "…", couleur=0x7B5BFF)


async def maison() -> Reponse:
    d = (await _beta("GET", "/v1/maison/etat")).json()
    par_id = {a["id"]: a for a in d.get("appareils", [])}
    pieces: dict[str, list[str]] = {}
    for g in d.get("groupes", []):
        p = par_id.get(g.get("principal"))
        if not p:
            continue
        dom = p["id"].split(".", 1)[0]
        etat = p.get("etat")
        if dom == "light" and etat == "on":
            pieces.setdefault(g.get("piece") or "Sans pièce", []).append(f"💡 {g['nom']}")
        elif dom == "cover" and etat in ("open", "opening"):
            pieces.setdefault(g.get("piece") or "Sans pièce", []).append(f"🪟 {g['nom']} ouvert")
        elif dom == "climate" and etat not in ("off", "unavailable"):
            pieces.setdefault(g.get("piece") or "Sans pièce", []).append(f"❄️ {g['nom']} ({etat})")
        elif dom == "media_player" and etat == "playing":
            pieces.setdefault(g.get("piece") or "Sans pièce", []).append(f"🎵 {g['nom']}")
    for a in d.get("appareils", []):
        classe = (a.get("attr") or {}).get("device_class")
        if a["id"].startswith("binary_sensor.") and a.get("etat") == "on" and classe in ("door", "window", "garage_door", "opening"):
            pieces.setdefault(a.get("piece") or "Sans pièce", []).append(f"🚪 {a['nom']} ouvert")
        if a["id"].startswith("binary_sensor.") and a.get("etat") == "on" and classe in ("moisture", "smoke", "gas"):
            pieces.setdefault(a.get("piece") or "Sans pièce", []).insert(0, f"🚨 {a['nom']}")
    m = d.get("meteo") or {}
    texte = f"{METEO.get(m.get('etat'), '🌡️')} Dehors : {m.get('temperature')}°" if m.get("temperature") is not None else ""
    gens = [f"{p['nom']} : {'🏠 à la maison' if p.get('etat') == 'home' else '🚶 ' + str(p.get('etat'))}" for p in d.get("personnes", [])]
    if gens:
        texte += ("\n" if texte else "") + " · ".join(gens)
    champs = [(piece, "\n".join(lignes[:8])) for piece, lignes in sorted(pieces.items())][:20]
    if not champs:
        texte += ("\n\n" if texte else "") + "Tout est éteint et fermé."
    return Reponse(texte or "La maison", titre="🏠 La maison", champs=champs)


async def resume() -> Reponse:
    return Reponse((await _beta("GET", "/v1/resume")).json()["texte"], titre="☀️ Résumé", couleur=0xFFC43D)


async def energie() -> Reponse:
    d = (await _beta("GET", "/v1/energie")).json()
    r = d["resume"]
    eur = lambda x: f"{x['euros']:.2f} €".replace(".", ",") + f" · {x['kwh']:.1f} kWh".replace(".", ",")  # noqa: E731
    champs = [("Aujourd'hui", eur(r["aujourdhui"])), ("Hier", eur(r["hier"])), ("Ce mois-ci", eur(r["mois"])),
              ("En ce moment", f"{d['puissance']['maintenant']} W")]
    top = [l for l in d.get("appareils", []) if not l.get("general")][:5]
    if top:
        champs.append(("Plus gros consommateurs ce mois-ci", "\n".join(f"{l['nom']} : {l['mois']:.1f} kWh".replace(".", ",") for l in top)))
    return Reponse(d.get("avertissement") or "", titre="⚡ Énergie", champs=champs, couleur=0xFF9F3D)


async def alertes() -> Reponse:
    d = (await _beta("GET", "/v1/alertes")).json()
    from datetime import datetime
    lignes = [f"`{datetime.fromtimestamp(a['quand']).strftime('%d/%m %H:%M')}` {a['titre']} : {a['message']}" for a in d["alertes"][:10]]
    texte = "\n".join(lignes) or "Aucune alerte depuis le démarrage de Bêta."
    return Reponse(texte + f"\n\nDestinations : {', '.join(d['destinations']) or 'aucune'}", titre="🔔 Alertes", couleur=0xFF5D68)


async def services() -> Reponse:
    d = (await _beta("GET", "/v1/stats")).json()
    lignes = [f"{'🟢' if s['ok'] else '🔴'} **{n}** {s.get('detail') or ''}" for n, s in d["services"].items()]
    sv = (await _beta("GET", "/v1/sauvegarde")).json()
    if sv.get("existe"):
        from datetime import datetime
        quand = datetime.fromtimestamp(sv["derniere_reussie"]).strftime("%d/%m %H:%M") if sv.get("derniere_reussie") else "jamais"
        lignes.append(f"{'🟢' if not sv.get('erreur') else '🔴'} **sauvegarde** dernière réussie : {quand}")
    return Reponse("\n".join(lignes), titre="🛠️ Services")


async def cameras() -> list[tuple[str, str]]:
    """[(nom, identifiant)] : caméras ONVIF/RTSP de Bêta (« cam:id ») et de Home Assistant (« ha:camera.x »)."""
    out = []
    try:
        for c in (await _beta("GET", "/v1/cameras")).json():
            out.append((c["nom"], "cam:" + c["id"]))
    except Erreur:
        pass
    try:
        for a in (await _beta("GET", "/v1/maison/etat")).json().get("appareils", []):
            if a["id"].startswith("camera."):
                out.append((a["nom"], "ha:" + a["id"]))
    except Erreur:
        pass
    return out


async def camera(identifiant: str) -> Reponse:
    liste = await cameras()
    if not identifiant:
        if not liste:
            raise Erreur("Aucune caméra.")
        identifiant = liste[0][1]
    nom = next((n for n, i in liste if i == identifiant or n.lower() == identifiant.lower()), None)
    if nom and not identifiant.startswith(("cam:", "ha:")):
        identifiant = next(i for n, i in liste if n.lower() == identifiant.lower())
    if identifiant.startswith("cam:"):
        r = await _beta("GET", f"/v1/cameras/{identifiant[4:]}/image")
    elif identifiant.startswith("ha:"):
        r = await _beta("GET", f"/v1/maison/camera/{identifiant[3:]}")
    else:
        raise Erreur("Caméra inconnue. Choisis-la dans la liste.")
    return Reponse(nom or identifiant, titre="📷 " + (nom or "Caméra"), image=r.content, nom_image="camera.jpg")


# --- Bêta Tool ------------------------------------------------------------------------------------------

async def commande_tool(phrase: str, titre: str = "") -> Reponse:
    """Une phrase pour Bêta Tool : courses, rappels, rendez-vous, agenda, colis, dépenses."""
    d = (await _tool("POST", "/api/v1/command", json={"text": phrase})).json()
    return Reponse(d.get("speech") or "C'est fait.", titre=titre, couleur=0x2FD0C0,
                   lien=f"{TOOL_LIEN}/{d['link']}" if TOOL_LIEN and d.get("link") else "")


async def journee() -> Reponse:
    w = (await _tool("GET", "/api/v1/widget")).json()
    champs = []
    if w.get("events"):
        champs.append(("📅 Rendez-vous", "\n".join(f"{e.get('time') or 'journée'} · {e['title']}" for e in w["events"])))
    if w.get("tasks"):
        champs.append((f"✅ Tâches ({w.get('tasks_count', len(w['tasks']))})", "\n".join(w["tasks"])))
    if w.get("bins"):
        champs.append(("🗑️ Ce soir", ", ".join(w["bins"])))
    if w.get("parcels"):
        champs.append(("📦 Colis", f"{w['parcels']} en route"))
    if w.get("unread"):
        champs.append(("✉️ Mails", f"{w['unread']} non lus"))
    return Reponse(w.get("summary") or "", titre="☀️ Ma journée", champs=champs, couleur=0xFFC43D,
                   lien=f"{TOOL_LIEN}/#/journee" if TOOL_LIEN else "")


async def papiers() -> Reponse:
    d = (await _tool("GET", "/api/v1/paperasse")).json()
    champs = [("Trouvés sur le NAS", str(d["propositions"])), ("À valider", str(d["a_valider"])), ("À payer sous 15 jours", str(d["echeances"]))]
    return Reponse("Paperasse range factures, impôts, santé, banque…", titre="📄 Papiers", champs=champs,
                   lien=f"{TOOL_LIEN}/#/paperasse/nas" if TOOL_LIEN else "")


async def telecharger(url: str, audio: bool = False) -> Reponse:
    if not url.startswith(("http://", "https://")):
        raise Erreur("Donne un lien (YouTube ou un des ~1800 sites pris en charge).")
    await _tool("POST", "/api/v1/ext/video", json={"url": url, "mode": "audio" if audio else "video"})
    return Reponse(f"Téléchargement lancé : {'la musique' if audio else 'la vidéo'} arrive dans Téléchargements sur le NAS.",
                   titre="⬇️ Téléchargeur", lien=f"{TOOL_LIEN}/#/telecharger" if TOOL_LIEN else "")


async def envoyer_fichier(nom: str, contenu: bytes, destination: str = "auto") -> Reponse:
    """Un fichier envoyé au bot : rangé tout seul (facture → Paperasse, relevé → Budget, photo → Album…)."""
    r = (await _tool("POST", "/api/v1/ext/upload", files={"file": (nom, contenu)},
                     data={"dest": destination, "source": "discord"})).json()
    return Reponse(f"**{nom}** → {r.get('label') or 'NAS'}" + (f" · {r['detail']}" if r.get("detail") else ""),
                   titre="📁 Sur le NAS", lien=f"{TOOL_LIEN}/{r['link']}" if TOOL_LIEN and r.get("link") else "")
