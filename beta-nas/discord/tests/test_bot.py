"""Bot Discord : commandes valides pour Discord, accès, et appels à Bêta / Bêta Tool (réseau simulé)."""

import asyncio
import json
import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.update(BETA_TOKEN="secret", BETA_TOOL_JETON="bt_x", BETA_TOOL_LIEN="http://nas:8080")

import actions  # noqa: E402
import bot  # noqa: E402


def test_commandes_valides_pour_discord():
    noms = set()
    for c in bot.bot.tree.get_commands():
        assert c.name == c.name.lower() and len(c.name) <= 32 and c.name.isascii(), c.name
        assert 1 <= len(c.description) <= 100, (c.name, len(c.description))
        noms.add(c.name)
    assert {"beta", "maison", "camera", "energie", "colis", "agenda", "courses", "telecharger", "envoyer", "aide"} <= noms
    assert len(noms) <= 100


def test_utilisateurs_autorises():
    assert bot.utilisateurs("123456789012345678=Bastien, 987654321098765432=julie;abc=x") == {
        123456789012345678: "bastien", 987654321098765432: "julie"}
    assert bot.utilisateurs("") == {}


@pytest.fixture
def reseau(monkeypatch):
    appels = []

    def repondre(req: httpx.Request):
        appels.append((req.method, str(req.url), req.headers.get("Authorization"), req.content))
        chemin = req.url.path
        if chemin == "/v1/texte":
            corps = json.loads(req.content)
            return httpx.Response(200, json={"reponse": f"OK : {corps['texte']} ({corps['personne']})"})
        if chemin == "/v1/maison/etat":
            return httpx.Response(200, json={
                "appareils": [{"id": "light.salon", "nom": "Lustre", "etat": "on", "piece": "Salon"},
                              {"id": "binary_sensor.porte", "nom": "Porte", "etat": "on", "piece": "Entrée", "attr": {"device_class": "door"}},
                              {"id": "camera.jardin", "nom": "Jardin", "etat": "idle"}],
                "groupes": [{"nom": "Lustre", "principal": "light.salon", "piece": "Salon"}],
                "personnes": [{"nom": "Bastien", "etat": "home"}], "meteo": {"etat": "sunny", "temperature": 18}})
        if chemin == "/v1/cameras":
            return httpx.Response(200, json=[{"id": "abc", "nom": "Entrée"}])
        if chemin in ("/v1/cameras/abc/image", "/v1/maison/camera/camera.jardin"):
            return httpx.Response(200, content=b"JPEG")
        if chemin == "/api/v1/command":
            return httpx.Response(200, json={"speech": "C'est noté : Lait sur la liste de courses.", "link": "#/recettes/courses"})
        if chemin == "/api/v1/ext/upload":
            return httpx.Response(200, json={"label": "Paperasse", "detail": "Lecture en cours", "link": "#/paperasse"})
        if chemin == "/api/v1/ext/video":
            return httpx.Response(200, json={"ids": ["x"]})
        return httpx.Response(404, json={"detail": "inconnu"})

    vrai = httpx.AsyncClient
    monkeypatch.setattr(actions.httpx, "AsyncClient", lambda **k: vrai(transport=httpx.MockTransport(repondre), **k))
    return appels


def test_parler_et_maison(reseau):
    r = asyncio.run(actions.parler("allume le salon", "bastien"))
    assert r.texte == "OK : allume le salon (bastien)" and reseau[0][2] == "Bearer secret"
    m = asyncio.run(actions.maison())
    assert "18°" in m.texte and "à la maison" in m.texte
    champs = dict(m.champs)
    assert "💡 Lustre" in champs["Salon"] and "🚪 Porte ouvert" in champs["Entrée"]


def test_cameras(reseau):
    assert asyncio.run(actions.cameras()) == [("Entrée", "cam:abc"), ("Jardin", "ha:camera.jardin")]
    assert asyncio.run(actions.camera("ha:camera.jardin")).image == b"JPEG"
    assert asyncio.run(actions.camera("entrée")).image == b"JPEG"  # nom tapé à la main


def test_bete_tool(reseau):
    r = asyncio.run(actions.commande_tool("ajoute du lait à la liste de courses", "🛒 Courses"))
    assert "Lait" in r.texte and r.lien == "http://nas:8080/#/recettes/courses" and reseau[-1][2] == "Bearer bt_x"
    f = asyncio.run(actions.envoyer_fichier("facture.pdf", b"%PDF"))
    assert "Paperasse" in f.texte
    v = asyncio.run(actions.telecharger("https://youtu.be/x", audio=True))
    assert "musique" in v.texte and json.loads(reseau[-1][3])["mode"] == "audio"
    with pytest.raises(actions.Erreur):
        asyncio.run(actions.telecharger("pas un lien"))


def test_embed():
    e, f = bot.embed(actions.Reponse("texte", titre="T", champs=[("a", "b")], image=b"x"))
    assert e.title == "T" and e.fields[0].name == "a" and f is not None


def test_notifications_dans_le_salon(monkeypatch):
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer

    envoyes = []

    class Salon:
        async def send(self, content=None, embed=None):
            envoyes.append((content, embed.title, embed.description))

    monkeypatch.setattr(bot, "SALON", 42)
    monkeypatch.setattr(bot.bot, "get_channel", lambda i: Salon() if i == 42 else None)

    async def scenario():
        app = web.Application()
        app.router.add_post("/notifier", bot.bot.recevoir)
        async with TestClient(TestServer(app)) as c:
            assert (await c.post("/notifier", json={"titre": "x"})).status == 401
            r = await c.post("/notifier", json={"titre": "💧 Fuite d'eau", "message": "Cuisine"}, headers={"Authorization": "Bearer secret"})
            assert (await r.json())["envoyes"] == 1
            await c.post("/notifier", json={"titre": "📦 Colis livré", "message": "Casque"}, headers={"Authorization": "Bearer secret"})
    asyncio.run(scenario())
    assert envoyes == [("@here", "💧 Fuite d'eau", "Cuisine"), (None, "📦 Colis livré", "Casque")]
