"""Comptes professionnels Microsoft 365 en lecture seule (Microsoft Graph simulé)."""

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta

import pytest

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import graphmail  # noqa: E402


class Rep:
    def __init__(self, code=200, data=None, contenu=None):
        self.status_code, self._d = code, data
        self.content = contenu if contenu is not None else (json.dumps(data).encode() if data is not None else b"")

    def json(self):
        return self._d


@pytest.fixture
def graph(monkeypatch):
    appels = []
    debut = (datetime.now() + timedelta(minutes=10)).replace(second=0, microsecond=0)

    def requete(methode, url, **kw):
        chemin = url.replace(graphmail.GRAPH, "")
        appels.append((methode, chemin, kw.get("json"), kw.get("params")))
        assert kw["headers"]["Authorization"] == "Bearer jeton" and "ImmutableId" in kw["headers"]["Prefer"]
        if chemin.startswith("/me/mailFolders/") and chemin.endswith("?$select=id"):
            connu = chemin.split("/")[3].split("?")[0]
            return Rep(200, {"id": "ID-" + connu}) if connu in ("inbox", "archive", "sentitems") else Rep(404, {"error": {"message": "nope"}})
        if chemin == "/me/mailFolders?$top=100":
            return Rep(200, {"value": [{"id": "ID-inbox", "displayName": "Inbox", "unreadItemCount": 3, "childFolderCount": 1},
                                       {"id": "ID-projets", "displayName": "Projets", "unreadItemCount": 1, "childFolderCount": 0},
                                       {"id": "ID-archive", "displayName": "Archive", "childFolderCount": 0}]})
        if chemin == "/me/mailFolders/ID-inbox/childFolders?$top=100":
            return Rep(200, {"value": [{"id": "ID-clients", "displayName": "Clients", "childFolderCount": 0}]})
        if chemin == "/me/mailFolders/inbox/messages":
            m = {"id": "AAMk=1", "subject": "Réunion budget", "from": {"emailAddress": {"name": "Chef", "address": "Chef@Entreprise.fr"}},
                 "toRecipients": [], "receivedDateTime": "2026-11-27T08:00:00Z", "isRead": False, "hasAttachments": True}
            return Rep(200, {"value": [m], "@odata.count": 1})
        if chemin == "/me/mailFolders/inbox?$select=unreadItemCount":
            return Rep(200, {"unreadItemCount": 5})
        if chemin == "/me/messages/AAMk%3D1":
            if methode == "PATCH":
                return Rep(200, {})
            return Rep(200, {"id": "AAMk=1", "subject": "Réunion budget", "from": {"emailAddress": {"name": "Chef", "address": "chef@e.fr"}},
                             "body": {"contentType": "html", "content": "<p>Bonjour <script>x()</script><img src='cid:logo'></p>"},
                             "hasAttachments": True, "isRead": False, "receivedDateTime": "2026-11-27T08:00:00Z"})
        if chemin.startswith("/me/messages/AAMk%3D1/attachments?"):
            return Rep(200, {"value": [{"id": "A1", "name": "logo.png", "contentType": "image/png", "isInline": True, "contentId": "logo", "size": 10},
                                       {"id": "A2", "name": "budget.pdf", "contentType": "application/pdf", "isInline": False, "size": 2000}]})
        if chemin.endswith("/attachments/A1/$value"):
            return Rep(200, None, b"PNG")
        if chemin.endswith("/attachments/A2/$value"):
            return Rep(200, None, b"%PDF")
        if chemin == "/me/messages/AAMk%3D1/move":
            return Rep(201, {"id": "AAMk=1"})
        raise AssertionError(chemin)

    import accounts
    monkeypatch.setattr(graphmail.requests, "request", requete)
    monkeypatch.setattr(accounts, "token", lambda acc, cle: "jeton")
    return appels, debut


def compte(ranger=False):
    return {"id": "pro1", "owner": "local", "label": "Travail", "pro": True,
            "mail": {"kind": "graph", "readonly": True, "move": ranger, "token": "ms_pro_tri" if ranger else "ms_pro"}}


def test_dossiers_et_liste(graph):
    acc = compte()
    f = graphmail.folders(acc)
    assert [x["label"] for x in f][:2] == ["Boîte de réception", "Archives"]
    assert {"Projets", "Clients"} <= {x["label"] for x in f} and next(x for x in f if x["label"] == "Clients")["depth"] == 1
    d = graphmail.messages(acc, "INBOX")
    m = d["messages"][0]
    assert m["uid"] == "AAMk=1" and m["from"][0]["email"] == "chef@entreprise.fr" and not m["seen"] and d["total"] == 1


def test_lecture_sans_modification(graph):
    appels, _ = graph
    d = graphmail.read(compte(), "INBOX", "AAMk=1", marquer_lu=True)
    assert "<script" not in d["html"] and "data:image/png;base64,UE5H" in d["html"]
    assert d["attachments"] == [{"n": 0, "name": "budget.pdf", "size": 2000, "type": "application/pdf"}] and d["readonly"]
    assert not any(a[0] == "PATCH" for a in appels)  # lecture seule : jamais marqué lu
    assert graphmail.piece(compte(), "AAMk=1", 0) == ("budget.pdf", "application/pdf", b"%PDF")


def test_ranger_seulement_si_autorise(graph):
    appels, _ = graph
    with pytest.raises(ValueError, match="lecture seule"):
        graphmail.action(compte(), "move", ["AAMk=1"], "ID-projets")
    graphmail.action(compte(True), "move", ["AAMk=1"], "ID-projets")
    assert appels[-1][:3] == ("POST", "/me/messages/AAMk%3D1/move", {"destinationId": "ID-projets"})
    graphmail.action(compte(True), "archive", ["AAMk=1"])
    assert appels[-1][2] == {"destinationId": "archive"}
    for interdit in ("trash", "delete", "send"):
        with pytest.raises(ValueError):
            graphmail.action(compte(True), interdit, ["AAMk=1"])


def test_nouveaux_mails(graph):
    import mail
    etat = {}
    assert graphmail.nouveaux(compte(), etat) == [] and "depuis" in etat["pro1"]  # premier passage : on note seulement l'heure
    nouveaux = graphmail.nouveaux(compte(), etat)
    assert [m["subject"] for m in nouveaux] == ["Réunion budget"] and mail._unread["pro1"] == 5
    assert etat["pro1"]["depuis"] == "2026-11-27T08:00:01Z"


def test_rappel_rendez_vous_pro(graph, monkeypatch):
    import accounts
    import activity
    import extcal
    _, debut = graph
    acc = compte() | {"cal": {"kind": "graph", "readonly": True, "token": "ms_pro", "calendars": [{"id": "c", "gid": "G", "name": "Calendrier"}]}}
    monkeypatch.setattr(accounts, "everyone", lambda: [acc])
    monkeypatch.setattr(extcal, "graph_events", lambda a, c, s, e: [
        {"ref": "E1", "title": "Point projet", "start": debut.isoformat(), "end": (debut + timedelta(hours=1)).isoformat(),
         "allday": False, "location": "Salle 3", "reminder": 15}])
    notes = []
    monkeypatch.setattr(activity, "log", lambda *a, **k: notes.append((a, k)))
    graphmail._agenda_pro.clear()
    sent = {}
    graphmail.rappels(sent, datetime.now())
    graphmail.rappels(sent, datetime.now())  # pas deux fois
    assert len(notes) == 1 and "Point projet" in notes[0][0][2] and "Salle 3" in notes[0][0][2]


def test_routes_de_la_page_mails(graph, monkeypatch):
    import accounts
    import store
    from app import app
    acc = compte(ranger=False) | {"provider": "microsoft", "email": "moi@entreprise.fr", "secret": accounts.seal({}),
                                  "cal": None, "created": 0}
    store.save("accounts/comptes", {"accounts": [acc]})
    c = app.test_client()
    d = c.get("/api/mail").get_json()
    assert d["accounts"][0]["mail"]["kind"] == "graph"
    assert c.get("/api/mail/pro1/folders").get_json()["readonly"] is True
    assert c.get("/api/mail/pro1/messages?folder=INBOX").get_json()["messages"][0]["subject"] == "Réunion budget"
    m = c.get("/api/mail/pro1/message?folder=INBOX&uid=AAMk%3D1").get_json()
    assert m["subject"] == "Réunion budget" and m["readonly"]
    assert c.get("/api/mail/pro1/part?folder=INBOX&uid=AAMk%3D1&n=0").data == b"%PDF"
    r = c.post("/api/mail/pro1/action", json={"uids": ["AAMk=1"], "op": "trash"})
    assert r.status_code >= 400 and "lecture seule" in r.get_json()["error"]
    r = c.post("/api/mail/pro1/send", data={"to": "x@y.fr", "subject": "s", "text": "t"})
    assert r.status_code >= 400 and "lecture seule" in r.get_json()["error"]
    r = c.post("/api/mail/pro1/folders", json={"name": "Nouveau"})  # créer un dossier : refusé aussi (IMAP)
    assert r.status_code >= 400
