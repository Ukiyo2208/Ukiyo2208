import pytest

from app.localisation import Localisation, prenom_dans
from app.settings import Personne, Settings


def reglages():
    return Settings(
        personnes={
            "bastien": Personne("bastien", "admin", companion="person.bastien", surnoms=["bast"]),
            "lea": Personne("lea", "adulte", companion="person.lea"),
            "invite": Personne("invite", "adulte"),
        },
        zones={"salon": "rdc", "sejour": "rdc", "couloir": "etage"},
        validite_minutes=15,
    )


class FauxHA:
    def __init__(self, etats):
        self.etats = etats

    async def etat(self, entite):
        return self.etats.get(entite)


def localisation(positions, etats):
    loc = Localisation(reglages(), FauxHA(etats))

    async def faux_positions():
        return positions

    loc.positions = faux_positions
    return loc


def vue(zone, il_y_a=60):
    return {"piece": "?", "zone": zone, "vu_il_y_a_s": il_y_a, "score": 0.7}


A_LA_MAISON = {"person.bastien": "home", "person.lea": "home"}


@pytest.mark.asyncio
async def test_seul_a_l_etage():
    loc = localisation({"personnes": {"bastien": vue("rdc"), "lea": vue("etage")}, "inconnus": {}}, A_LA_MAISON)
    assert await loc.candidat("salon") == "bastien"
    assert await loc.candidat("couloir") == "lea"


@pytest.mark.asyncio
async def test_deux_personnes_au_meme_etage():
    loc = localisation({"personnes": {"bastien": vue("rdc"), "lea": vue("rdc")}, "inconnus": {}}, A_LA_MAISON)
    assert await loc.candidat("salon") is None


@pytest.mark.asyncio
async def test_inconnu_vu_a_l_etage():
    loc = localisation({"personnes": {"bastien": vue("rdc")}, "inconnus": {"rdc": {"vu_il_y_a_s": 30}}},
                       {"person.bastien": "home", "person.lea": "not_home"})
    assert await loc.candidat("salon") is None


@pytest.mark.asyncio
async def test_quelqu_un_a_la_maison_mais_vu_nulle_part():
    loc = localisation({"personnes": {"bastien": vue("rdc")}, "inconnus": {}}, A_LA_MAISON)
    assert await loc.candidat("salon") is None  # Léa est peut-être au salon


@pytest.mark.asyncio
async def test_vue_trop_ancienne_ou_parti():
    loc = localisation({"personnes": {"bastien": vue("rdc", il_y_a=3600)}, "inconnus": {}}, {})
    assert await loc.candidat("salon") is None
    loc = localisation({"personnes": {"bastien": vue("rdc")}, "inconnus": {}}, {"person.bastien": "not_home"})
    assert await loc.candidat("salon") is None


@pytest.mark.asyncio
async def test_sans_service_de_presence():
    loc = localisation(None, A_LA_MAISON)
    assert await loc.candidat("salon") is None


def test_prenom_dans_la_reponse():
    s = reglages()
    assert prenom_dans("C'est pour Bastien", s) == "bastien"
    assert prenom_dans("pour Léa", s) == "lea"
    assert prenom_dans("c'est bast", s) == "bastien"
    assert prenom_dans("pour moi", s) is None
    assert prenom_dans("Bastien et Léa", s) is None
