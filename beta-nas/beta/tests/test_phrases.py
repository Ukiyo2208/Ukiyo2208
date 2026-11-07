from app.homeassistant import ReponseHA
from app.phrases import naturelle

FAIT = ReponseHA(True, "Éteint", "action_done", [{"name": "Salon", "type": "area"}], [])
sans_debut = lambda liste: ""  # noqa: E731
d_accord = lambda liste: "D'accord, "  # noqa: E731


def test_reprend_les_mots_de_la_commande():
    assert naturelle("éteins la lumière du salon", FAIT, d_accord) == "D'accord, j'éteins la lumière du salon."
    assert naturelle("Allume la cuisine", FAIT, sans_debut) == "J'allume la cuisine."
    assert naturelle("ferme les volets de l'étage", FAIT, sans_debut) == "Je ferme les volets de l'étage."


def test_politesse_et_formes_diverses():
    assert naturelle("Hey Bêta, tu peux allumer la lampe du bureau s'il te plaît ?", FAIT, sans_debut) == "J'allume la lampe du bureau."
    assert naturelle("eteins-moi le salon", FAIT, sans_debut) == "J'éteins le salon."
    assert naturelle("mets la clim à 21 degrés", FAIT, sans_debut) == "Je mets la clim à 21 degrés."
    assert naturelle("allume", FAIT, sans_debut) == "J'allume Salon."


def test_questions_et_echecs_gardent_la_reponse_de_home_assistant():
    question = ReponseHA(True, "Il fait 21 degrés dans le salon.", "query_answer", [], [])
    assert naturelle("quelle température dans le salon", question) == "Il fait 21 degrés dans le salon."
    rate = ReponseHA(True, "Une erreur est survenue", "action_done", [], [{"name": "Volet"}])
    assert naturelle("ferme le volet", rate) == "Une erreur est survenue"
    inconnu = ReponseHA(True, "C'est fait", "action_done", [], [])
    assert naturelle("bonne nuit", inconnu) == "C'est fait"
