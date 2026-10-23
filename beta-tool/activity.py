"""Historique et notifications : chaque outil y note ce qui s'est terminé
(téléchargement, conversion, réponse à un questionnaire…). La page interroge
/api/activity pour afficher la cloche et les notifications du navigateur."""

import threading
import time

import store

_lock = threading.Lock()
MAX = 4000


def log(user, tool, text, link=None, kind="ok"):
    """user : nom du compte concerné, ou "*" pour tout le monde."""
    entry = {"id": time.time_ns(), "ts": time.time(), "user": user or "*", "tool": tool, "text": text,
             "link": link, "kind": kind}
    with _lock:
        store.append("activity", entry)
        log.count = getattr(log, "count", 0) + 1
        if log.count % 200 == 0:  # on garde les MAX dernières lignes
            lines = store.read_lines("activity")
            if len(lines) > MAX:
                store.rewrite_lines("activity", lines[-MAX // 2:])
    return entry


def recent(user, since=0, limit=60):
    out = [e for e in store.read_lines("activity") if e["id"] > since and e["user"] in ("*", user)]
    return out[-limit:][::-1]
