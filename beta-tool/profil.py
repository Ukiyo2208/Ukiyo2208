"""Profil et connexions : tout ce qui est relié à Bêta Tool au même endroit (boîtes mail, agendas,
Parcel, La Poste, météo, téléphones, clés d'accès…), la photo et le nom affichés, et les réglages
d'apparence de chaque compte (couleur, densité, taille du texte, arrondis, fond…), gardés sur le NAS
pour suivre la personne sur tous ses appareils."""

import os
import re
import time

from flask import Blueprint, g, jsonify, request, send_file

import auth
import settings
import store

bp = Blueprint("profil", __name__)
AVATARS = store.path("avatars")
ACCENTS = {"bleu", "violet", "rose", "rouge", "orange", "ambre", "vert", "turquoise", "ardoise"}
DESIGN = {  # réglage : valeurs permises (la première est celle par défaut)
    "density": ["confort", "compact"],
    "font": ["normal", "petit", "grand", "tres-grand"],
    "radius": ["arrondi", "doux", "carre"],
    "background": ["grille", "uni", "aurore", "points"],
    "sidebar": ["complet", "icones"],
    "motion": ["normal", "reduit"],
    "glass": ["verre", "opaque"],
}
STARTS = {"home", "journee", "mails", "agenda", "taches", "fichiers", "budget", "colis", "recettes"}


def _safe(name):
    return re.sub(r"[^\w.@-]", "_", name)


def clean(d, p):
    """Applique les réglages de profil et d'apparence reçus (d) aux préférences du compte (p)."""
    if "display_name" in d:
        p["display_name"] = re.sub(r"\s+", " ", str(d["display_name"] or "")).strip()[:40]
    if "avatar_emoji" in d:
        e = str(d["avatar_emoji"] or "").strip()
        p["avatar_emoji"] = e[:8] if e and len(e) <= 8 else ""
    if "avatar_color" in d:
        c = str(d["avatar_color"] or "")
        p["avatar_color"] = c if re.fullmatch(r"#[0-9a-fA-F]{6}", c) else ""
    if d.get("start") in STARTS:
        p["start"] = d["start"]
    if d.get("theme") in ("auto", "light", "dark"):
        p["theme"] = d["theme"]
    if isinstance(d.get("design"), dict):
        des = dict(p.get("design") or {})
        for k, v in d["design"].items():
            if k == "accent":
                if v in ACCENTS or re.fullmatch(r"#[0-9a-fA-F]{6}", str(v)):
                    des["accent"] = v
            elif k in DESIGN and v in DESIGN[k]:
                des[k] = v
        p["design"] = des
    if d.get("reset_design"):
        p["design"] = {}


# --- Photo de profil --------------------------------------------------------------------------------------

@bp.post("/api/me/avatar")
def set_avatar():
    from PIL import Image, ImageOps
    f = request.files.get("photo")
    if not f:
        raise ValueError("Choisis une photo")
    try:
        im = ImageOps.exif_transpose(Image.open(f.stream)).convert("RGB")
    except Exception:  # noqa: BLE001
        raise ValueError("Cette image n'est pas lisible") from None
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2)).resize((256, 256))
    os.makedirs(AVATARS, exist_ok=True)
    im.save(os.path.join(AVATARS, _safe(g.user["name"]) + ".jpg"), "JPEG", quality=88)
    stamp = int(time.time())
    store.update("prefs", {}, lambda d: d.setdefault(g.user["name"], {}).__setitem__("avatar", stamp))
    return jsonify(avatar=stamp)


@bp.delete("/api/me/avatar")
def del_avatar():
    p = os.path.join(AVATARS, _safe(g.user["name"]) + ".jpg")
    if os.path.exists(p):
        os.remove(p)
    store.update("prefs", {}, lambda d: d.setdefault(g.user["name"], {}).pop("avatar", None))
    return jsonify(ok=True)


@bp.get("/api/avatar/<name>")
def avatar(name):
    p = os.path.join(AVATARS, _safe(name) + ".jpg")
    if not os.path.exists(p):
        return jsonify(error="Pas de photo"), 404
    return send_file(p, mimetype="image/jpeg", max_age=86400)


# --- Toutes les connexions -------------------------------------------------------------------------------

def _item(group, cid, name, icon, tile, status, detail, action=None, href=None, admin=False):
    return {"group": group, "id": cid, "name": name, "icon": icon, "tile": tile, "status": status, "detail": detail,
            "action": action, "href": href, "admin": admin}


@bp.get("/api/connections")
def connections():
    user, admin = g.user["name"], g.user.get("role") == "admin"
    on = settings.enabled
    out = []
    G1, G2, G3, G4 = "Mails et agendas", "Téléphones et sécurité", "Services reliés", "Accès au NAS"

    # Boîtes mail et agendas
    import accounts
    try:
        import extcal
        cal_errors = {c["account"]: c["error"] for c in extcal.calendars(user) if c.get("error")}
    except Exception:  # noqa: BLE001
        cal_errors = {}
    for a in accounts.of(user):
        what = [w for w, ok in (("mails", a.get("mail")), ("agenda", a.get("cal"))) if ok]
        err = cal_errors.get(a["id"])
        out.append(_item(G1, "acc-" + a["id"], a.get("label") or a.get("email") or "Compte", "mail" if a.get("mail") else "calendar",
                         "bleu-vert", "warn" if err else "ok",
                         f"{accounts.LABELS.get(a['provider'], a['provider'])} · {' et '.join(what) or 'rien d’activé'}" + (f" · {err}" if err else ""),
                         href="#/reglages/enligne"))
    if on("mails") or on("agenda"):
        out.append(_item(G1, "acc-new", "Ajouter une boîte mail ou un agenda", "plus", "", "add",
                         "iCloud, Gmail, Outlook, Orange, Free, Nextcloud, lien .ics…", href="#/reglages/enligne"))
    if admin:
        cfg = accounts.oauth_config()
        out.append(_item(G1, "oauth", "Connexion Microsoft et Google", "key", "violet",
                         "ok" if cfg["ms_client_id"] or cfg["google_client_id"] else "off",
                         " · ".join(x for x, ok in (("Microsoft activé", cfg["ms_client_id"]), ("Google activé", cfg["google_client_id"] and cfg["google_client_secret"])) if ok)
                         or "Nécessaire pour Outlook / Hotmail et l'écriture dans Google Agenda", href="#/reglages/enligne", admin=True))

    # Téléphones et sécurité
    if on("agenda") or on("contacts"):
        out.append(_item(G2, "dav", "Agenda et contacts sur le téléphone", "phone", "", "info",
                         "Synchronisation CalDAV / CardDAV avec l'iPhone ou Android (DAVx⁵)", href="#/agenda?sync=1"))
    if on("sauvegarde-tel"):
        import telephones
        devs = telephones.scan(user) if auth.mode() == "accounts" else []
        out.append(_item(G2, "webdav", "Sauvegarde des téléphones", "save", "bleu-vert", "ok" if devs else "off",
                         f"{len(devs)} appareil{'s' if len(devs) > 1 else ''} sauvegardé{'s' if len(devs) > 1 else ''}" if devs else "Photos, documents et SMS envoyés sur le NAS (WebDAV)",
                         href="#/sauvegarde-tel"))
    out.append(_item(G2, "push", "Notifications sur ce téléphone ou ordinateur", "bell", "ambre", "client", "", href="#/reglages/notifications"))
    u = auth.find(user) or {}
    if auth.mode() == "accounts":
        n = len(u.get("passkeys", []))
        out.append(_item(G2, "passkeys", "Clés d'accès", "key", "vert", "ok" if n else "off",
                         f"{n} appareil{'s' if n > 1 else ''} : connexion par empreinte ou visage" if n else "Connexion par empreinte ou visage, sans mot de passe", href="#/reglages/profil"))
        out.append(_item(G2, "2fa", "Double authentification", "shield", "vert", "ok" if u.get("totp") else "off",
                         "Activée" if u.get("totp") else "Un code du téléphone en plus du mot de passe", href="#/reglages/profil"))

    # Services reliés
    if on("colis"):
        import colis
        import parcelapp
        pc = parcelapp.config(user)
        out.append(_item(G3, "parcel", "Appli Parcel", "send", "ambre", "warn" if pc.get("error") else "ok" if pc.get("key") else "off",
                         pc.get("error") or (f"Reliée · {pc.get('count', 0)} colis suivis" if pc.get("key") else "Synchro des colis avec l'appli Parcel (iPhone, Mac, Premium)"),
                         action="parcel"))
        out.append(_item(G3, "laposte", "Suivi La Poste en direct", "send", "ambre", "ok" if colis.laposte_key() else "off",
                         "Clé configurée : Colissimo et Chronopost suivis en direct" if colis.laposte_key() else "Clé gratuite de developer.laposte.fr",
                         action="laposte" if admin else None, admin=True))
    if on("journee"):
        import journee
        p = journee.prefs(user)
        out.append(_item(G3, "meteo", "Météo", "sun", "ambre", "ok" if p.get("city") else "off",
                         p.get("city") or "Ta ville pour la météo de Ma journée (Open-Meteo, sans compte)", action="meteo"))
    if on("budget"):
        out.append(_item(G3, "banque", "Banque", "landmark", "vert", "soon",
                         "Relevés importés en CSV / OFX / QIF ; synchro automatique (Enable Banking) bientôt", href="#/budget"))
    import api
    toks = [t for t in api.tokens() if t["user"] == user]
    out.append(_item(G3, "api", "Siri, widgets, Home Assistant", "code", "violet", "ok" if toks else "off",
                     f"{len(toks)} jeton{'s' if len(toks) > 1 else ''} d'API" if toks else "Jetons pour les Raccourcis, le widget, Home Assistant…", href="#/reglages/api"))

    # Accès au NAS (administrateur)
    if admin:
        proto = request.headers.get("X-Forwarded-Proto", request.scheme)
        host = request.headers.get("X-Forwarded-Host", request.host)
        out.append(_item(G4, "https", "Accès sécurisé (HTTPS)", "lock", "vert", "ok" if proto == "https" else "warn",
                         f"Connexion chiffrée{' via Tailscale' if host.split(':')[0].endswith('.ts.net') else ''}" if proto == "https" else "Connexion en clair : passe en https sans rien ouvrir sur Internet",
                         href="#/reglages/acces", admin=True))
        if on("vpn"):
            import vpn
            out.append(_item(G4, "vpn", "VPN WireGuard", "globe", "bleu-vert", "ok" if vpn.PASSWORD else "off",
                             "Configuré" if vpn.PASSWORD else "VPN_PASSWORD manquant dans .env", href="#/vpn", admin=True))
        if on("work"):
            out.append(_item(G4, "onlyoffice", "Bêta Work (ONLYOFFICE)", "briefcase", "violet",
                             "ok" if os.environ.get("ONLYOFFICE_JWT_SECRET") else "off", "Éditeur de documents", href="#/work", admin=True))
        if on("coffre"):
            out.append(_item(G4, "vault", "Coffre (Vaultwarden)", "shield", "", "ok" if os.environ.get("VAULT_URL") else "off",
                             os.environ.get("VAULT_URL") or "VAULT_URL manquant dans .env", href="#/coffre", admin=True))
    return jsonify(items=out)
