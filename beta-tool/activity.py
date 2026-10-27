"""Historique et notifications : chaque outil y note ce qui s'est terminé
(téléchargement, conversion, réponse à un questionnaire…). La page interroge
/api/activity pour afficher la cloche et les notifications du navigateur."""

import threading
import time

import store

_lock = threading.Lock()
MAX = 4000
# Titre des notifications push, par outil
TITLES = {"telecharger": "Téléchargeur", "convertir": "Convertisseur", "video": "Compresseur vidéo", "transcription": "Transcription",
          "image": "Studio Image", "drop": "Bêta Drop", "questionnaires": "Questionnaires", "sauvegardes": "Sauvegardes",
          "abonnements": "Abonnements", "mails": "Mails", "surveillance": "Surveillance", "agenda": "Agenda", "paperasse": "Paperasse",
          "presse-papier": "Presse-papier", "recettes": "Recettes", "reglages": "Bêta Tool", "traduction": "Traduction",
          "scanner": "Scanner", "stockage": "Stockage"}


def log(user, tool, text, link=None, kind="ok", push=True, title=None, image=None, icon=None, skip=None):
    """user : nom du compte concerné, ou "*" pour tout le monde. Envoie aussi une notification push
    aux appareils abonnés (sauf push=False)."""
    entry = {"id": time.time_ns(), "ts": time.time(), "user": user or "*", "tool": tool, "text": text,
             "link": link, "kind": kind}
    with _lock:
        store.append("activity", entry)
        log.count = getattr(log, "count", 0) + 1
        if log.count % 200 == 0:  # on garde les MAX dernières lignes
            lines = store.read_lines("activity")
            if len(lines) > MAX:
                store.rewrite_lines("activity", lines[-MAX // 2:])
    if push:
        import push as push_
        push_.notify(entry["user"], title or TITLES.get(tool, "Bêta Tool"), text, "/" + (link or "#/"), tool, tag=str(entry["id"]),
                      image=image, icon=icon, skip=skip)
    return entry


def recent(user, since=0, limit=60):
    out = [e for e in store.read_lines("activity") if e["id"] > since and e["user"] in ("*", user)]
    return out[-limit:][::-1]
