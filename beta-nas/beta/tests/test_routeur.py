import time

import pytest

from app import llm_local
from app.homeassistant import ReponseHA
from app import ia
from app.routeur import APRES_CAMERA, IDENTIFICATION_REQUISE, INITIALE, QUI_REQUIS, Routeur
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
    """Remplace les vraies IA : répond comme le ferait l'IA attitrée de chaque tâche."""

    def __init__(self):
        self.appels = []

    def disponible(self, tache):
        return True

    async def demander(self, tache, systeme, messages, **kwargs):
        self.appels.append((tache, messages))
        return ia.Resultat(f"Réponse {len(messages)}", "cloud")

    async def demander_json(self, tache, systeme, message, schema, max_tokens=4096):
        self.appels.append((tache, message))
        yaml = "triggers: [{trigger: time, at: '06:00:00'}]\nactions: [{action: notify.notify, data: {message: volets}}]"
        return {"possible": True, "resume": "Tous les jours à 6h, j'ouvre les volets.", "yaml": yaml}, "cloud"


class FausseLocalisation:
    def __init__(self, candidat=None):
        self.candidat_ = candidat

    async def candidat(self, piece):
        return self.candidat_


def routeur(ha, tri=llm_local.Tri(llm_local.AUTRE), ia=None, candidat=None):
    s = Settings(personnes={"bastien": Personne("bastien", "admin"), "leo": Personne("leo", "enfant")})
    return Routeur(s, ha, FauxLLM(tri), ia, FausseLocalisation(candidat))


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
async def test_sans_visage_la_domotique_marche():
    ha = FauxHA(compris={"allume le salon"})
    r = await routeur(ha).traiter("allume le salon", None, 0.0)
    assert r.route == "home_assistant"


@pytest.mark.asyncio
async def test_sans_visage_pas_de_mails_ni_d_automatisation():
    rt = routeur(FauxHA(), llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    for demande in ("lis mes mails", "tous les jours à 6h ouvre les volets"):
        r = await rt.traiter(demande, "bastien", 0.2)  # visage trop incertain
        assert r.route == "refus" and "face à la tablette" in r.texte


@pytest.mark.asyncio
async def test_automatisation_pas_executee_tout_de_suite_puis_confirmee():
    ha = FauxHA(compris={"tous les jours à 6h ouvre les volets"})
    rt = routeur(ha, llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    r = await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    assert r.texte.endswith("Tu confirmes ?")
    assert ha.commandes == []  # rien n'a été exécuté immédiatement
    r = await rt.traiter("oui", "bastien", 0.9)
    assert r.texte == "C'est enregistré."
    assert ha.creees[0]["alias"] == "Tous les jours à 6h, j'ouvre les volets."


@pytest.mark.asyncio
async def test_confirmation_expiree_ou_annulee():
    ha = FauxHA()
    rt = routeur(ha, llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    assert (await rt.traiter("non", "bastien", 0.9)).texte == "D'accord, j'annule."
    await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", 0.9)
    rt._attentes["maison"].expire = time.monotonic() - 1
    await rt.traiter("oui", "bastien", 0.9)
    assert ha.creees == []


@pytest.mark.asyncio
async def test_enfant_ne_cree_pas_d_automatisation():
    rt = routeur(FauxHA(), llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    r = await rt.traiter("tous les jours à 6h ouvre les volets", "leo", 0.9)
    assert r.route == "refus"


@pytest.mark.asyncio
async def test_question_generale_sans_camera_et_par_l_ia_de_discussion():
    fausse = FausseIA()
    tri = llm_local.Tri(llm_local.CONVERSATION)
    r = await routeur(FauxHA(), tri, fausse).traiter("capitale de la France ?", etape=INITIALE)
    assert r.route == "conversation:cloud"
    assert fausse.appels[0][0] == ia.CONVERSATION


@pytest.mark.asyncio
async def test_la_discussion_garde_le_fil():
    fausse = FausseIA()
    rt = routeur(FauxHA(), llm_local.Tri(llm_local.CONVERSATION), fausse)
    await rt.traiter("qui a peint la Joconde ?", "bastien", 0.9)
    r = await rt.traiter("et en quelle année ?", "bastien", 0.9)
    messages = fausse.appels[-1][1]
    assert [m["content"] for m in messages[:2]] == ["qui a peint la Joconde ?", "Réponse 1"]
    assert r.texte == "Réponse 3"


@pytest.mark.asyncio
async def test_sans_ia_de_discussion():
    r = await routeur(FauxHA(), llm_local.Tri(llm_local.CONVERSATION)).traiter("raconte une blague", "bastien", 0.9)
    assert r.route == "incompris"


@pytest.mark.asyncio
async def test_seul_a_l_etage_pas_besoin_de_camera():
    rt = routeur(FauxHA(), candidat="bastien")
    r = await rt.traiter("lis mes mails", piece="salon", etape=INITIALE)
    assert r.texte == "Aucune boîte mail n'est configurée pour toi."  # traité comme Bastien


@pytest.mark.asyncio
async def test_plusieurs_personnes_camera_puis_pour_qui():
    rt = routeur(FauxHA())
    assert (await rt.traiter("lis mes mails", etape=INITIALE)).route == IDENTIFICATION_REQUISE
    r = await rt.traiter("lis mes mails", etape=APRES_CAMERA)  # la tablette n'a vu personne
    assert r.route == QUI_REQUIS and r.texte == "C'est pour qui ?"


@pytest.mark.asyncio
async def test_automatisation_exige_le_visage_meme_seul_a_l_etage():
    ha = FauxHA()
    rt = routeur(ha, llm_local.Tri(llm_local.AUTOMATISATION), FausseIA(), candidat="bastien")
    texte = "tous les jours à 6h ouvre les volets"
    assert (await rt.traiter(texte, etape=INITIALE)).route == IDENTIFICATION_REQUISE
    r = await rt.traiter(texte, etape=APRES_CAMERA)  # pas de visage : pas de « c'est pour qui »
    assert r.route == "refus" and "visage" in r.texte
    r = await rt.traiter(texte, "bastien", 0.9, etape=APRES_CAMERA)
    assert r.texte.endswith("Tu confirmes ?")
    # Le « oui » arrive sans visage : il doit quand même valider
    r = await rt.traiter("oui", etape=INITIALE)
    assert r.texte == "C'est enregistré."


@pytest.mark.asyncio
async def test_declaration_ne_suffit_pas_pour_automatiser():
    from app.settings import DECLARATION
    rt = routeur(FauxHA(), llm_local.Tri(llm_local.AUTOMATISATION), FausseIA())
    r = await rt.traiter("tous les jours à 6h ouvre les volets", "bastien", niveau=DECLARATION)
    assert r.route == "refus" and "visage" in r.texte
