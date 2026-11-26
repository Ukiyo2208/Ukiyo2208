"""Bêta Tool dans Home Assistant :

1. Notifications : ce que Bêta Tool annonce (colis expédié, en livraison, livré ; rappel d'un rendez-vous ;
   tâches du jour ; échéance d'un papier ; résumé du matin ; papiers trouvés sur le NAS…) part aussi sur les
   téléphones de l'appli Home Assistant (HA_NOTIFY : « ha:mobile_app_pixel_8 ha:mobile_app_ipad », comme
   NOTIFICATIONS dans Bêta). Outils transmis : HA_OUTILS (par défaut colis, agenda, tâches, paperasse,
   journée, santé, abonnements).
2. Capteurs (mis à jour toutes les 5 minutes, pour tes tableaux de bord et automatisations) :
   sensor.beta_tool_colis (colis en route), sensor.beta_tool_prochain_rendez_vous (date du prochain),
   sensor.beta_tool_agenda_aujourdhui, sensor.beta_tool_taches, sensor.beta_tool_echeances (papiers à payer),
   sensor.beta_tool_poubelles (à sortir ce soir), sensor.beta_tool_papiers_a_ranger (trouvés sur le NAS).
   Ils sont pour le compte HA_COMPTE (sinon le premier administrateur).

HA_URL et HA_TOKEN : les mêmes que Bêta (rien à faire, l'installateur les donne)."""

import os
import queue
import threading
import time
from datetime import datetime, timedelta

import requests

HA_URL = os.environ.get("HA_URL", "").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")
OUTILS = {o.strip() for o in os.environ.get("HA_OUTILS", "colis,agenda,taches,paperasse,journee,sante,abonnements").split(",") if o.strip()}
_file = queue.Queue(maxsize=200)


def actif():
    return bool(HA_URL and HA_TOKEN)


def telephones():
    """Services notify de Home Assistant, d'après HA_NOTIFY (« ha:mobile_app_xxx », séparés par espaces ou virgules)."""
    brut = os.environ.get("HA_NOTIFY", "").replace(",", " ").split()
    return [d[3:].removeprefix("notify.") for d in brut if d.startswith("ha:")]


def _entetes():
    return {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}


# --- 1. Notifications --------------------------------------------------------------------------------

def transmettre(entry, titre):
    """Appelé par activity.log : met la notification en file (envoi dans un fil à part, jamais bloquant)."""
    if not actif() or entry.get("tool") not in OUTILS or not telephones():
        return
    try:
        _file.put_nowait((titre, entry.get("text") or "", entry.get("link") or "", entry.get("tool")))
    except queue.Full:
        pass


def _envoyeur():
    base = os.environ.get("BETA_TOOL_LIEN", "").rstrip("/")
    while True:
        titre, texte, lien, outil = _file.get()
        donnees = {"tag": f"beta-tool-{outil}", "group": "Bêta Tool"}
        if base:
            url = base + "/" + (lien or "#/")
            donnees.update(url=url, clickAction=url)
        for service in telephones():
            try:
                requests.post(f"{HA_URL}/api/services/notify/{service}", headers=_entetes(), timeout=10,
                              json={"title": titre, "message": texte[:500], "data": donnees})
            except requests.RequestException as e:
                print("homeassistant notify", service, e, flush=True)


# --- 2. Capteurs -------------------------------------------------------------------------------------

def compte():
    import auth
    voulu = os.environ.get("HA_COMPTE", "")
    m = auth.mode()
    if m == "open":
        return "local"
    if m == "password":
        return "admin"
    u = auth.find(voulu) or next((u for u in auth.users() if u.get("role") == "admin"), None)
    return u["name"] if u else None


def capteurs(user, maintenant=None):
    """{entity_id: (état, attributs)} à publier."""
    import journee
    import settings
    maintenant = maintenant or datetime.now()
    b = journee.build(user)
    out = {}
    if settings.enabled("colis"):
        import colis
        en_route = [p for p in colis.load(user) if not p.get("archived") and p.get("status") != "livre"]
        out["sensor.beta_tool_colis"] = (len(en_route), {
            "friendly_name": "Colis en route", "icon": "mdi:package-variant-closed", "unit_of_measurement": "colis",
            "colis": [{"nom": p.get("label"), "statut": colis.LABEL.get(p.get("status"), p.get("status")),
                       "transporteur": colis.CARRIERS.get(p.get("carrier"), ("",))[0], "prevu": p.get("expected"),
                       "suivi": colis.tracking_url(p)} for p in en_route[:15]],
            "livres_aujourdhui": sum(1 for p in colis.load(user) if p.get("status") == "livre"
                                     and time.time() - p.get("delivered", p.get("updated", 0)) < 86400)})
    if settings.enabled("agenda"):
        import agenda
        debut = maintenant.replace(second=0, microsecond=0)
        a_venir = [e for e in agenda.all_events(user, debut - timedelta(hours=12), debut + timedelta(days=14))
                   if e.get("cal") not in ("_anniversaires", "_fetes", "_paperasse")
                   and (e["start"] >= debut.isoformat()[:16] if not e.get("allday") else e["start"][:10] >= debut.date().isoformat())]
        prochain = next((e for e in a_venir if not e.get("allday")), None) or (a_venir[0] if a_venir else None)
        out["sensor.beta_tool_prochain_rendez_vous"] = (
            datetime.fromisoformat(prochain["start"]).astimezone().isoformat() if prochain else "unknown", {
                "friendly_name": "Prochain rendez-vous", "icon": "mdi:calendar-clock", "device_class": "timestamp",
                "titre": prochain.get("title") if prochain else None, "lieu": prochain.get("location") if prochain else None,
                "toute_la_journee": bool(prochain and prochain.get("allday")),
                "suivants": [{"titre": e.get("title"), "debut": e["start"]} for e in a_venir[1:6]]})
        evts = b.get("events") or []
        out["sensor.beta_tool_agenda_aujourdhui"] = (len(evts), {
            "friendly_name": "Rendez-vous aujourd'hui", "icon": "mdi:calendar-today", "unit_of_measurement": "rendez-vous",
            "rendez_vous": [{"heure": e.get("time") or "journée", "titre": e.get("text"), "detail": e.get("sub")} for e in evts]})
        out["sensor.beta_tool_poubelles"] = (", ".join(b.get("bins") or []) or "Rien", {
            "friendly_name": "Poubelles à sortir ce soir", "icon": "mdi:trash-can-outline", "a_sortir": bool(b.get("bins"))})
    taches = b.get("tasks") or []
    out["sensor.beta_tool_taches"] = (len(taches), {
        "friendly_name": "Tâches du jour", "icon": "mdi:checkbox-marked-circle-outline", "unit_of_measurement": "tâches",
        "taches": [t.get("text") for t in taches[:20]]})
    papiers = b.get("papers") or []
    out["sensor.beta_tool_echeances"] = (len(papiers), {
        "friendly_name": "Papiers à payer", "icon": "mdi:file-document-alert-outline", "unit_of_measurement": "papiers",
        "en_retard": sum(1 for p in papiers if p.get("late")), "papiers": [f"{p.get('text')} · {p.get('sub')}" for p in papiers[:10]]})
    try:
        import explorateur
        out["sensor.beta_tool_papiers_a_ranger"] = (explorateur.resume()["propositions"], {
            "friendly_name": "Papiers trouvés sur le NAS", "icon": "mdi:file-search-outline", "unit_of_measurement": "papiers"})
    except Exception:  # noqa: BLE001
        pass
    return out


def publier():
    user = compte()
    if not user:
        return 0
    n = 0
    for entite, (etat, attributs) in capteurs(user).items():
        try:
            requests.post(f"{HA_URL}/api/states/{entite}", headers=_entetes(), timeout=10,
                          json={"state": etat, "attributes": attributs}).raise_for_status()
            n += 1
        except requests.RequestException as e:
            print("homeassistant capteur", entite, e, flush=True)
            break
    return n


def _capteurs_en_boucle():
    time.sleep(20)
    while True:
        try:
            publier()
        except Exception as e:  # noqa: BLE001
            print("homeassistant", e, flush=True)
        time.sleep(300)


def start():
    if not actif():
        return
    threading.Thread(target=_envoyeur, daemon=True).start()
    threading.Thread(target=_capteurs_en_boucle, daemon=True).start()
