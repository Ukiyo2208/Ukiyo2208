"""Petit stockage JSON dans DATA_DIR (réglages, comptes, partages, notes…).

Chaque « table » est un fichier JSON écrit de façon atomique ; les journaux
(historique, réponses aux questionnaires) sont en JSON Lines."""

import json
import os
import threading

DATA_DIR = os.environ.get("DATA_DIR", "/data")
_lock = threading.RLock()


def path(*parts):
    return os.path.join(DATA_DIR, *parts)


def load(name, default):
    with _lock:
        try:
            with open(path(name + ".json"), encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return default


def save(name, data):
    with _lock:
        target = path(name + ".json")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, target)


def update(name, default, fn):
    """Lit, modifie avec fn(data) et réécrit, sous verrou. Renvoie ce que fn renvoie."""
    with _lock:
        data = load(name, default)
        result = fn(data)
        save(name, data)
        return result


def append(name, entry):
    with _lock:
        target = path(name + ".jsonl")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_lines(name):
    with _lock:
        try:
            with open(path(name + ".jsonl"), encoding="utf-8") as f:
                return [json.loads(l) for l in f if l.strip()]
        except FileNotFoundError:
            return []


def rewrite_lines(name, entries):
    with _lock:
        target = path(name + ".jsonl")
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(e, ensure_ascii=False) + "\n" for e in entries)
        os.replace(tmp, target)


def start():
    os.makedirs(DATA_DIR, exist_ok=True)
