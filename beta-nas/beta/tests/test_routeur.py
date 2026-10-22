import time

import pytest

from app import llm_local
from app.homeassistant import ReponseHA
from app.ia_web import Proposition
from app.routeur import Routeur
from app.settings import Personne, Settings


class FauxHA:
    def __init__(self, compris=()):
        self.compris = set(compris)
        self.commandes, self.creees = [], []

    async def commande(self, texte):
        self.commandes.append(texte)
        if texte in self.compris:
            return ReponseHA(True, "C'est fait")
        return ReponseHA(False, "Désolé")

    async def appareils(self, domaines):
        return []

    async def creer_automatisation(self, identifiant, config):
        self.creees.append(config)


class FauxLLM:
    def __init__(self, tri):
        self.tri = tri

    async def trier(self, texte):
        return self.tri


class FausseIA:
    async def proposer_automatisation(self, *args):
        return Proposition(True, "Tous les jours à 6h, j'ouvre les volets.", {"alias": "x"})


def routeur(ha, tri=llm_local.Tri(llm_local.AUTRE), ia=None):
    s = Settings(personnes={"bastien": Personne("bastien", "admin"), "leo": Personne("leo", "enfant")})
    return Routeur(s, ha, FauxLLM(tri), ia)


@pytest.mark.asyncio
async def test_commande_simple_passe_par_home_assistant():
    ha = FauxHA(compris={"allume le salon"})
    r = await routeur(ha).traiter("allume le salon", "bastien", 0.9)
    assert r.route == "home_assistant"


@pytest.mark.asyncio
async def test_llm_reformule_pour_home_assistant():
    ha = FauxHA(compris={"allume la lumière du salon"})
    tri = llm_local.Tri(llm_local.DOMOTIQUE, commande="allume la lumière du salon")
    r = await routeur(ha, tri).traiter("tu peux mettre un peu de lumière dans le salon", "bastien", 0.9)
    assert r.route == "llm_local+home_assistant"


@pytest.mark.asyncio
async def test_inconnu_refuse():
    r = await routeur(FauxHA()).traiter("allume le salon", "bastien", 0.2)
    assert r.route == "refus"


@pytest.mark.asyncio
async def test_automatisation_pas_executee_tout_de_suite_puis_confirmee():
    ha = FauxHA(compris={"tous les jours à 6h ouvre les volets"})
    rt = routeur(ha, llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    r = await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    assert r.texte.endswith("Tu confirmes ?")
    assert ha.commandes == []  # rien n'a été exécuté immédiatement
    r = await rt.traiter("oui", "bastien", 0.9)
    assert r.texte == "C'est enregistré."
    assert ha.creees[0]["alias"] == "x"


@pytest.mark.asyncio
async def test_confirmation_expiree_ou_annulee():
    ha = FauxHA()
    rt = routeur(ha, llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    assert (await rt.traiter("non", "bastien", 0.9)).texte == "D'accord, j'annule."
    await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    rt._attentes["bastien"].expire = time.monotonic() - 1
    await rt.traiter("oui", "bastien", 0.9)
    assert ha.creees == []


@pytest.mark.asyncio
async def test_enfant_ne_cree_pas_d_automatisation():
    rt = routeur(FauxHA(), llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    r = await rt.traiter("tous les jours à 6h ouvre les volets", "leo", 0.9)
    assert r.route == "refus"
