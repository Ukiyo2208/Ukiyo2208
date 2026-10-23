"""Lanceur de Bêta Tool (point d'entrée du conteneur).

Choisit la version à exécuter : celle de l'image Docker, ou une mise à jour
installée depuis les Réglages (DATA_DIR/versions/<version>/app). Relance le site
quand il le demande (code de sortie 3, après une mise à jour) et revient à la
version de l'image si une mise à jour plante au démarrage."""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("DATA_DIR", "/data")
VERSIONS = os.path.join(DATA, "versions")
RESTART = 3

child = None


def vtuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0")[:3])


def read(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip() if path.endswith("VERSION") else json.load(f)
    except (OSError, ValueError):
        return default


def choose():
    builtin = read(os.path.join(BASE, "VERSION"), "0")
    wanted = (read(os.path.join(VERSIONS, "current.json"), {}) or {}).get("version")
    bad = read(os.path.join(VERSIONS, "bad.json"), []) or []
    folder = os.path.join(VERSIONS, wanted or "-", "app")
    # Une image Docker plus récente que la mise à jour installée reprend la main
    if wanted and wanted not in bad and os.path.isfile(os.path.join(folder, "app.py")) and vtuple(wanted) >= vtuple(builtin):
        return folder, wanted
    return BASE, builtin


def write(name, data):
    os.makedirs(VERSIONS, exist_ok=True)
    with open(os.path.join(VERSIONS, name), "w") as f:
        json.dump(data, f)


def mark_bad(version):
    """Écarte une version qui plante et revient à la dernière qui a tourné correctement."""
    bad = read(os.path.join(VERSIONS, "bad.json"), []) or []
    if version not in bad:
        bad.append(version)
    write("bad.json", bad)
    good = (read(os.path.join(VERSIONS, "last_good.json"), {}) or {}).get("version")
    write("current.json", {"version": good if good and good not in bad else None})


def mark_good_later(proc, version, folder):
    """Une version qui tient 30 secondes est considérée comme bonne."""
    def check():
        time.sleep(30)
        if proc.poll() is None:
            write("last_good.json", {"version": version if folder != BASE else None})
    threading.Thread(target=check, daemon=True).start()


def forward(sig, _frame):
    if child and child.poll() is None:
        child.send_signal(sig)
    else:
        sys.exit(0)


def main():
    global child
    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    pylibs = os.path.join(DATA, "pylibs")
    while True:
        folder, version = choose()
        env = {**os.environ, "BETA_BASE_DIR": BASE, "BETA_LAUNCHER": "1",
               "PYTHONPATH": os.pathsep.join(p for p in (pylibs, os.environ.get("PYTHONPATH")) if p)}
        print(f"[lanceur] Bêta Tool {version} ({'mise à jour' if folder != BASE else 'image'})", flush=True)
        started = time.time()
        child = subprocess.Popen([sys.executable, "app.py"], cwd=folder, env=env)
        mark_good_later(child, version, folder)
        code = child.wait()
        if code == RESTART:
            continue
        if folder != BASE and time.time() - started < 30 and code not in (0, -signal.SIGTERM, -signal.SIGINT):
            print(f"[lanceur] La version {version} ne démarre pas : retour à la version précédente", flush=True)
            mark_bad(version)
            continue
        sys.exit(0 if code < 0 else code)


if __name__ == "__main__":
    main()
