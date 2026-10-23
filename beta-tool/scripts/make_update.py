"""Fabrique un paquet de mise à jour Bêta Tool (à installer depuis Réglages → Mises à jour).

    python scripts/make_update.py --notes "Nouvel outil X" --notes "Correction Y"
    python scripts/make_update.py --url-base https://github.com/<compte>/<dépôt>/releases/download/v2.1.0/

Produit dist/beta-tool-update-<version>.zip et dist/latest.json (manifeste à publier
à côté, pour le bouton « Vérifier les mises à jour »). La version est lue dans VERSION."""

import argparse
import hashlib
import json
import os
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE_DIRS = ["static", "templates"]
EXCLUDE = {"static/brand", "__pycache__"}


def files():
    for name in sorted(os.listdir(ROOT)):
        if name.endswith(".py") or name in ("VERSION", "requirements.txt"):
            yield name
    for d in INCLUDE_DIRS:
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, d)):
            rel_dir = os.path.relpath(dirpath, ROOT).replace(os.sep, "/")
            dirnames[:] = [x for x in dirnames if f"{rel_dir}/{x}" not in EXCLUDE and x not in EXCLUDE]
            for f in sorted(filenames):
                yield f"{rel_dir}/{f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", action="append", default=[], help="une ligne du journal des changements (répétable)")
    ap.add_argument("--pip", action="append", default=[], help="dépendance Python à installer (répétable)")
    ap.add_argument("--rebuild", action="store_true", help="la mise à jour demande de reconstruire l'image Docker")
    ap.add_argument("--min-builtin", default="2.0.0", help="version minimale de l'image Docker")
    ap.add_argument("--url-base", default="", help="adresse où le .zip sera publié (pour latest.json)")
    args = ap.parse_args()

    version = open(os.path.join(ROOT, "VERSION")).read().strip()
    manifest = {"name": "beta-tool", "version": version, "date": time.strftime("%Y-%m-%d"), "notes": args.notes,
                "pip": args.pip, "rebuild": args.rebuild, "min_builtin": args.min_builtin}
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    name = f"beta-tool-update-{version}.zip"
    out = os.path.join(ROOT, "dist", name)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for rel in files():
            z.write(os.path.join(ROOT, rel), "app/" + rel)
    sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
    latest = {"version": version, "url": args.url_base + name if args.url_base else name, "sha256": sha,
              "notes": args.notes, "date": manifest["date"], "rebuild": args.rebuild}
    with open(os.path.join(ROOT, "dist", "latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f, ensure_ascii=False, indent=1)
    print(f"{out} ({os.path.getsize(out) // 1024} Ko)\nsha256 {sha}")


if __name__ == "__main__":
    main()
