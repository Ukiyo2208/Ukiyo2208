"""Droits de Radicale (Agenda) : chacun lit et écrit ses agendas (dont le lien vers
l'agenda « Famille » partagé, rangé dans son propre dossier)."""

from radicale import pathutils
from radicale.rights import BaseRights


class Rights(BaseRights):
    def authorization(self, user, path):
        if not user:
            return ""
        sane = pathutils.strip_path(path)
        if not sane:
            return "R"
        owner = sane.split("/", 1)[0]
        if owner != user or owner.startswith("_"):
            return ""
        return "RW" if "/" not in sane else "rw" if sane.count("/") == 1 else ""
