"""Authentification de Radicale (Agenda) : identifiant + mot de passe de synchronisation
générés dans Bêta Tool (Agenda → Synchroniser), distincts du mot de passe du site."""

from radicale.auth import BaseAuth

import agenda


class Auth(BaseAuth):
    def _login(self, login, password):
        return agenda.check_sync(login, password)
