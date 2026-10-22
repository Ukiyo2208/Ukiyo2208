import pytest

from app.homeassistant import Appareil
from app.ia_web import ErreurAutomatisation, anonymiser, verifier

APPAREILS = [
    Appareil("cover.volet_chambre", "cover", "Volet chambre", "Chambre"),
    Appareil("light.salon", "light", "Lampe salon", "Salon"),
]
DOMAINES = ["cover", "light", "lock"]


def table():
    return anonymiser(APPAREILS, envoyer_noms=False)[1]


def test_anonymiser_cache_les_vrais_ids_et_les_noms():
    liste, t = anonymiser(APPAREILS, envoyer_noms=False)
    assert liste[0] == {"id": "cover.appareil_1", "type": "cover", "piece": "Chambre"}
    assert t == {"cover.appareil_1": "cover.volet_chambre", "light.appareil_1": "light.salon"}


def test_verifier_remet_les_vrais_ids():
    config = verifier(
        """
alias: Volets 6h
triggers:
  - trigger: time
    at: "06:00:00"
actions:
  - action: cover.open_cover
    target:
      entity_id: cover.appareil_1
""",
        table(),
        DOMAINES,
    )
    assert config["actions"][0]["target"]["entity_id"] == "cover.volet_chambre"
    assert config["description"].startswith("Créée par Bêta")


@pytest.mark.parametrize(
    "yaml_texte",
    [
        "triggers: [{trigger: time, at: '06:00'}]\nactions: [{action: shell_command.pirate}]",
        "triggers: [{trigger: time, at: '06:00'}]\nactions: [{action: lock.unlock, target: {entity_id: lock.porte}}]",
        "triggers: [{trigger: time, at: '06:00'}]\nactions: [{action: light.turn_on, data: {brightness: '{{ 5 }}'}}]",
        "triggers: [{trigger: time, at: '06:00'}]",
        "pas: [du yaml",
    ],
)
def test_verifier_refuse(yaml_texte):
    with pytest.raises(ErreurAutomatisation):
        verifier(yaml_texte, table(), DOMAINES)
