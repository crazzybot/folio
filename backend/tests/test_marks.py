import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.marks import real_path, record_id
from app.scanner import _stable_id
from tests.conftest import FIXTURES, WORKSPACE

MARKS = FIXTURES / "marks"
PLAIN = _stable_id("docs/plain.md")
README = _stable_id("README.md")


def _fixture_path(path: str) -> str:
    """A fixture record's path with {WORKSPACE} replaced by the real workspace path."""
    if not path.startswith("{WORKSPACE}/"):
        return path
    return real_path(Path(WORKSPACE, *path.removeprefix("{WORKSPACE}/").split("/")))


@pytest.fixture
def data_dir(tmp_path) -> Path:
    """A data folder holding the fixture records, each under its real record id."""
    folder = tmp_path / "marks"
    folder.mkdir()
    for file in sorted((MARKS / "records").glob("*.json")):
        record = json.loads(file.read_text(encoding="utf-8"))
        record["path"] = _fixture_path(record["path"])
        name = record_id(Path(record["path"])) if record["path"].startswith(real_path(WORKSPACE)) else file.stem
        (folder / f"{name}.json").write_text(json.dumps(record), encoding="utf-8")
    return tmp_path


@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("MARKDOWN_WORKSPACE", str(WORKSPACE))
    monkeypatch.setenv("MARKDOWN_SKIP_DIRS", ".git,node_modules")
    monkeypatch.setenv("MARKDOWN_DATA_DIR", str(data_dir))
    return TestClient(app, base_url="http://localhost")


def _record(data_dir: Path, location: str) -> dict | None:
    file = data_dir / "marks" / f"{record_id(WORKSPACE / location)}.json"
    return json.loads(file.read_text(encoding="utf-8")) if file.exists() else None


def _highlight(**changes):
    return {
        "color": "yellow",
        "quote": {"exact": "No headings", "prefix": "", "suffix": " here."},
        "position": {"start": 0, "end": 11},
        **changes,
    }


def test_lists_the_workspace_marks_like_the_shared_fixture(client):
    expected = json.loads((MARKS / "expected-listing.json").read_text(encoding="utf-8"))
    expected["documents"][0]["docId"] = PLAIN
    assert client.get("/api/marks").json() == expected


def test_finds_the_same_marks_from_a_subfolder_workspace(client, monkeypatch):
    monkeypatch.setenv("MARKDOWN_WORKSPACE", str(WORKSPACE / "docs"))
    [doc] = client.get("/api/marks").json()["documents"]
    assert (doc["location"], doc["docId"]) == ("plain.md", _stable_id("plain.md"))


def test_adds_updates_and_deletes_a_highlight(client, data_dir):
    res = client.post(f"/api/documents/{PLAIN}/highlights", json=_highlight(note="  "))
    assert res.status_code == 201
    added = res.json()
    assert added["color"] == "yellow" and added["note"] is None and len(added["id"]) == 16

    record = _record(data_dir, "docs/plain.md")
    assert [h["id"] for h in record["highlights"]] == ["a1b2c3d4e5f60718", added["id"]]
    assert record["path"] == real_path(WORKSPACE / "docs/plain.md")
    assert record["fingerprint"]["filename"] == "plain.md"
    assert record["fingerprint"]["size"] == len((WORKSPACE / "docs/plain.md").read_bytes())

    res = client.patch(f"/api/documents/{PLAIN}/highlights/{added['id']}", json={"color": "pink", "note": "Why?"})
    assert (res.json()["color"], res.json()["note"]) == ("pink", "Why?")

    assert client.delete(f"/api/documents/{PLAIN}/highlights/{added['id']}").status_code == 204
    assert client.delete(f"/api/documents/{PLAIN}/highlights/a1b2c3d4e5f60718").status_code == 204
    # No marks left: the record is removed
    assert _record(data_dir, "docs/plain.md") is None
    assert client.get("/api/marks").json() == {"documents": []}


@pytest.mark.parametrize(
    "case", json.loads((MARKS / "invalid-highlights.json").read_text(encoding="utf-8")), ids=lambda c: c[0]
)
def test_refuses_invalid_highlights(client, data_dir, case):
    before = _record(data_dir, "docs/plain.md")
    assert client.post(f"/api/documents/{PLAIN}/highlights", json=case[1]).status_code == 400
    assert _record(data_dir, "docs/plain.md") == before


def test_refuses_an_invalid_colour_change(client):
    res = client.patch(f"/api/documents/{PLAIN}/highlights/a1b2c3d4e5f60718", json={"color": "red"})
    assert res.status_code == 400


def test_refuses_bodies_that_arent_json(client):
    # A cross-site form can post text/plain without a CORS preflight
    res = client.post(
        f"/api/documents/{PLAIN}/highlights",
        content=json.dumps(_highlight()),
        headers={"content-type": "text/plain"},
    )
    assert res.status_code == 415


def test_leaves_records_of_a_newer_version_alone(client, data_dir):
    file = data_dir / "marks" / f"{record_id(WORKSPACE / 'README.md')}.json"
    before = file.read_text(encoding="utf-8")
    assert client.post(f"/api/documents/{README}/highlights", json=_highlight()).status_code == 409
    assert file.read_text(encoding="utf-8") == before


def test_leaves_damaged_records_alone(client, data_dir):
    file = data_dir / "marks" / f"{record_id(WORKSPACE / 'docs/plain.md')}.json"
    file.write_text("{ not json", encoding="utf-8")
    assert client.get("/api/marks").json() == {"documents": []}
    assert client.post(f"/api/documents/{PLAIN}/highlights", json=_highlight()).status_code == 409
    assert file.read_text(encoding="utf-8") == "{ not json"


def test_404s_unknown_documents_and_highlights(client):
    assert client.post("/api/documents/nope/highlights", json=_highlight()).status_code == 404
    assert client.delete(f"/api/documents/{PLAIN}/highlights/nope").status_code == 404
    assert client.patch(f"/api/documents/{PLAIN}/highlights/nope", json={"color": "blue"}).status_code == 404


def test_writes_nothing_into_the_workspace(client):
    before = sorted(str(p) for p in WORKSPACE.rglob("*"))
    client.post(f"/api/documents/{PLAIN}/highlights", json=_highlight())
    assert sorted(str(p) for p in WORKSPACE.rglob("*")) == before


def test_record_ids_ignore_case_only_where_the_file_system_does(tmp_path):
    file = tmp_path / "Note.md"
    file.write_text("x")
    same = record_id(tmp_path / "note.md") == record_id(file)
    assert same == (os.name == "nt" or os.uname().sysname == "Darwin")
