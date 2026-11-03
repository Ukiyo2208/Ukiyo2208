import json

import httpx
import pytest

from app import ia
from app.settings import charger


def modeles():
    return {
        "rapide": ia.Modele("rapide", "ollama", "qwen2.5:3b", url="http://nas:11434"),
        "puissant": ia.Modele("puissant", "ollama", "qwen3.5:27b", url="http://pc:11434"),
        "cloud": ia.Modele("cloud", "anthropic", "claude-opus-5-5", cle=""),  # pas de clé : ignoré
    }


def brancher(registre, nom, gestionnaire):
    """Remplace le réseau d'une IA par une fonction de test."""
    client = registre._client(registre.modeles[nom])
    client._client = httpx.AsyncClient(base_url=client.m.url, transport=httpx.MockTransport(gestionnaire))


def ollama_repond(texte):
    def gestionnaire(requete):
        return httpx.Response(200, json={"message": {"content": texte}})
    return gestionnaire


def en_panne(requete):
    return httpx.Response(500)


@pytest.mark.asyncio
async def test_conversation_va_au_premier_disponible():
    registre = ia.IA(modeles())
    # Le cloud n'a pas de clé : la discussion part directement au modèle puissant
    assert [m.nom for m in registre.candidats(ia.CONVERSATION)] == ["puissant", "rapide"]
    brancher(registre, "puissant", ollama_repond("Paris."))
    r = await registre.demander(ia.CONVERSATION, "système", [{"role": "user", "content": "capitale ?"}])
    assert (r.texte, r.modele) == ("Paris.", "puissant")


@pytest.mark.asyncio
async def test_secours_si_le_premier_est_en_panne():
    registre = ia.IA(modeles())
    brancher(registre, "puissant", en_panne)
    brancher(registre, "rapide", ollama_repond("Paris."))
    r = await registre.demander(ia.CONVERSATION, "système", [{"role": "user", "content": "capitale ?"}])
    assert r.modele == "rapide"


@pytest.mark.asyncio
async def test_une_seule_ia_pour_une_tache():
    registre = ia.IA(modeles(), taches={ia.CONVERSATION: ["puissant"]})
    brancher(registre, "puissant", en_panne)
    with pytest.raises(ia.IndisponibleError):
        await registre.demander(ia.CONVERSATION, "s", [{"role": "user", "content": "x"}])


@pytest.mark.asyncio
async def test_json_invalide_passe_au_suivant():
    registre = ia.IA(modeles(), taches={ia.COMPRENDRE: ["puissant", "rapide"]})
    brancher(registre, "puissant", ollama_repond("pas du json"))
    brancher(registre, "rapide", ollama_repond('{"categorie": "domotique", "commande": "allume"}'))
    donnees, modele = await registre.demander_json(ia.COMPRENDRE, "s", "allume", {"type": "object"})
    assert donnees["categorie"] == "domotique" and modele == "rapide"


@pytest.mark.asyncio
async def test_cloud_anthropic(monkeypatch):
    m = ia.Modele("cloud", "anthropic", "claude-opus-5-5", cle="cle-test")
    registre = ia.IA({"cloud": m}, taches={ia.CONVERSATION: ["cloud"]})
    vu = {}

    def anthropic_repond(requete):
        vu.update(json.loads(requete.content))
        return httpx.Response(200, json={
            "id": "m", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
            "content": [{"type": "text", "text": "Bonjour Bastien !"}], "stop_reason": "end_turn",
            "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1},
        })

    import anthropic
    client = registre._client(m)
    client._client = anthropic.AsyncAnthropic(
        api_key="cle-test", http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2_transport(anthropic_repond))
    )
    r = await registre.demander(ia.CONVERSATION, "Tu es Bêta.", [{"role": "user", "content": "salut"}])
    assert r.texte == "Bonjour Bastien !" and r.modele == "cloud"
    assert vu["model"] == "claude-opus-5-5" and vu["system"] == "Tu es Bêta."
    assert vu["output_config"] == {"effort": "low"} and vu["fallbacks"] == "default"


def httpx2_transport(gestionnaire):
    import httpx2

    def adapter(requete):
        r = gestionnaire(requete)
        return httpx2.Response(r.status_code, content=r.content, headers=dict(r.headers))

    return httpx2.MockTransport(adapter)


def test_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "cle")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama:11434")
    config = tmp_path / "config.yaml"
    config.write_text(
        "ia:\n"
        "  modeles:\n"
        "    puissant: {url: 'http://192.168.1.50:11434', modele: 'qwen3.5:27b'}\n"
        "  taches:\n"
        "    conversation: puissant\n"
    )
    s = charger(str(config))
    assert s.ia.resume()["conversation"] == ["puissant (qwen3.5:27b)"]
    assert s.ia.resume()["automatisations"] == ["cloud (claude-opus-5-5)", "puissant (qwen3.5:27b)"]
    assert s.ia.resume()["comprendre"] == ["rapide (qwen2.5:3b)"]
    sans = charger(str(tmp_path / "absent.yaml"))
    assert sans.ia.resume()["conversation"] == ["cloud (claude-opus-5-5)", "rapide (qwen2.5:3b)"]


@pytest.mark.asyncio
async def test_comprendre_sans_ia_passe_aux_mots_cles():
    from app import llm_local

    registre = ia.IA(modeles(), taches={ia.COMPRENDRE: ["rapide"]})
    brancher(registre, "rapide", en_panne)
    tri = await llm_local.LLMLocal(registre, "http://nas:11434", "qwen2.5:3b").trier("tous les jours à 7h ouvre le volet")
    assert tri.categorie == llm_local.AUTOMATISATION
