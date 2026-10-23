from fastapi.testclient import TestClient


def test_docs_logo_et_favicon(monkeypatch, tmp_path):
    monkeypatch.setenv("BETA_TOKEN", "secret")
    monkeypatch.setenv("BETA_CONFIG", str(tmp_path / "absent.yaml"))
    monkeypatch.setenv("OLLAMA_URL", "http://127.0.0.1:9")  # préchauffage en échec silencieux
    from app.main import app

    with TestClient(app) as client:
        page = client.get("/docs")
        assert page.status_code == 200 and "/static/favicon.png" in page.text
        assert client.get("/static/logo.png").headers["content-type"] == "image/png"
        assert client.get("/favicon.ico").status_code == 200
        assert "/static/logo.png" in client.get("/openapi.json").json()["info"]["description"]
