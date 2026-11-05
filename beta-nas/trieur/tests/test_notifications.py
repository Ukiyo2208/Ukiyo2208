import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import notifications  # noqa: E402


def corps(req):
    return json.loads(req.data)


def test_destinations_et_types():
    d = notifications.destinations("ha:mobile_app_pixel  https://discord.com/api/webhooks/1/a,ntfy:https://ntfy.sh/x https://site.fr/h")
    assert [notifications.type_de(x) for x in d] == ["home_assistant", "discord", "ntfy", "webhook"]


def test_home_assistant(monkeypatch):
    monkeypatch.setenv("HA_URL", "http://192.100.2.68/")
    monkeypatch.setenv("HA_TOKEN", "jeton-ha")
    r = notifications.requete("ha:notify.mobile_app_pixel", "Tri", "3 propositions", "http://nas:8800/tri/")
    assert r.full_url == "http://192.100.2.68/api/services/notify/mobile_app_pixel"
    assert r.get_header("Authorization") == "Bearer jeton-ha"
    assert corps(r) == {"title": "Tri", "message": "3 propositions",
                        "data": {"url": "http://nas:8800/tri/", "clickAction": "http://nas:8800/tri/"}}


def test_discord_et_ntfy():
    r = notifications.requete("https://discord.com/api/webhooks/1/abc", "Tri terminé", "3 à valider", "http://l")
    assert corps(r)["content"] == "**Tri terminé**\n3 à valider\nhttp://l"
    r = notifications.requete("ntfy:https://ntfy.sh/beta-secret", "Tri terminé", "3 à valider", "http://l")
    assert r.full_url == "https://ntfy.sh"
    assert corps(r)["topic"] == "beta-secret" and corps(r)["title"] == "Tri terminé" and corps(r)["click"] == "http://l"


def test_envoi_webhook_et_erreur():
    recus = []

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            recus.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(204); self.end_headers()

    srv = HTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/hook"
    resultats = notifications.envoyer_maintenant("T", "M", "L", [url, "http://127.0.0.1:9/x"])
    srv.shutdown()
    assert recus == [{"titre": "T", "message": "M", "lien": "L"}]
    assert resultats[url] == "ok" and resultats["http://127.0.0.1:9/x"] != "ok"


def test_resume_sans_secrets(monkeypatch):
    monkeypatch.setenv("NOTIFICATIONS", "ha:mobile_app_x https://discord.com/api/webhooks/1/SECRET")
    assert notifications.resume() == ["Home Assistant", "Discord"]
