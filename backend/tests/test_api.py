import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.scanner import _stable_id
from tests.conftest import WORKSPACE


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MARKDOWN_WORKSPACE", str(WORKSPACE))
    monkeypatch.setenv("MARKDOWN_SKIP_DIRS", ".git,node_modules")
    return TestClient(app, base_url="http://localhost")


def test_reports_the_version_in_pyproject(client):
    with open(Path(__file__).resolve().parents[1] / "pyproject.toml", "rb") as f:
        expected = tomllib.load(f)["project"]["version"]
    assert client.get("/openapi.json").json()["info"]["version"] == expected


def test_lists_documents(client):
    docs = client.get("/api/documents").json()
    assert [d["location"] for d in docs][:2] == ["README.md", "docs/blank.md"]
    assert docs[0]["headings"][0] == {"level": 1, "text": "Project Readme"}


def test_returns_content_and_404s_unknown_ids(client):
    res = client.get(f"/api/documents/{_stable_id('docs/plain.md')}/content")
    assert res.json()["content"].startswith("No headings here.")
    assert client.get("/api/documents/nope/content").status_code == 404


def test_searches(client):
    results = client.get("/api/search", params={"q": "Second line"}).json()
    assert [(r["id"], r["matchCount"]) for r in results] == [(_stable_id("docs/plain.md"), 1)]
    assert results[0]["matches"][0]["line"] == 2


def test_lists_attachments(client):
    assert client.get("/api/attachments").json() == ["attachments/pixel.png", "docs/diagram.svg"]


def test_serves_images_with_a_sandboxing_policy(client):
    res = client.get("/api/files/attachments/pixel.png")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert "sandbox" in res.headers["content-security-policy"]


def test_serves_linked_files(client):
    res = client.get("/api/files/docs/data.csv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "sandbox" in res.headers["content-security-policy"]


@pytest.mark.parametrize(
    "location",
    [
        "node_modules/pkg/skipped.png",
        "docs/plain.md",
        "missing.png",
        "%2E%2E/expected-scan.json",
        "docs/outside-link.md",
        "docs/install.command",
        "docs/page.html",
        "docs/notes.txt.md",
    ],
)
def test_refuses_other_files(client, location):
    assert client.get(f"/api/files/{location}").status_code == 404


def test_rejects_unknown_hosts(monkeypatch):
    monkeypatch.setenv("MARKDOWN_WORKSPACE", str(WORKSPACE))
    assert TestClient(app, base_url="http://evil.example").get("/api/documents").status_code == 400
