"""Crée le jeton qui relie Bêta à Bêta Tool (résumé du matin, courses, agenda, colis à la voix).

Lancé par l'installateur de Bêta : docker exec beta-tool python scripts/jeton_beta.py [prénom]
Le jeton (droits « Commandes vocales et widget » et « Extension » : fichiers et vidéos envoyés par le bot Discord) est écrit sur la sortie ; seule son empreinte est
gardée dans Bêta Tool. Il appartient au compte dont le nom est le prénom donné (sinon le premier administrateur).
Un ancien jeton « Bêta (installateur) » du même compte est révoqué. Visible et révocable dans Réglages → API.
"""

import os
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api  # noqa: E402
import auth  # noqa: E402
import store  # noqa: E402

NOM = "Bêta (installateur)"


def proprietaire(prenom: str) -> str:
    m = auth.mode()
    if m == "open":
        return "local"
    if m == "password":
        return "admin"
    u = auth.find(prenom) or next((u for u in auth.users() if u.get("role") == "admin"), None) or auth.users()[0]
    return u["name"]


def main() -> int:
    user = proprietaire(sys.argv[1] if len(sys.argv) > 1 else "")
    jeton = "bt_" + secrets.token_urlsafe(32)
    entree = {"id": secrets.token_hex(6), "user": user, "name": NOM, "scopes": ["assistant:use", "extension:use"], "hash": api._hash(jeton),
              "prefix": jeton[:7] + "…", "created": time.time(), "expires": None, "used": 0}

    def remplacer(d):
        d["tokens"] = [t for t in d["tokens"] if not (t.get("name") == NOM and t.get("user") == user)] + [entree]

    store.update("api/jetons", {"tokens": []}, remplacer)
    print(f"Jeton Bêta Tool créé pour le compte « {user} »", file=sys.stderr)
    print(jeton)
    return 0


if __name__ == "__main__":
    sys.exit(main())
