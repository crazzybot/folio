import json

import pytest

from app.scanner import (
    _stable_id,
    extract_headings,
    extract_meta,
    find_document,
    scan_attachments,
    scan_workspace,
    split_front_matter,
    wiki_link_text,
)
from tests.conftest import FIXTURES, SKIP_DIRS, WORKSPACE

# The desktop app's scanner must produce the same (desktop/test/scanner.test.ts)
EXPECTED = json.loads((FIXTURES / "expected-scan.json").read_text())


def test_scan_matches_shared_expected_output():
    docs = scan_workspace(WORKSPACE, skip_dirs=SKIP_DIRS)
    comparable = [
        {
            "id": d.id,
            "filename": d.filename,
            "location": d.location,
            "title": d.title,
            "headings": [{"level": h.level, "text": h.text} for h in d.headings],
            **({} if d.meta is None else {"meta": {
                "status": d.meta.status,
                "statusDetail": d.meta.status_detail,
                "date": d.meta.date,
                "people": list(d.meta.people),
                "tags": list(d.meta.tags),
            }}),
        }
        for d in docs
    ]
    assert comparable == EXPECTED["documents"]


def test_scan_caps_depth():
    locations = [d.location for d in scan_workspace(WORKSPACE, skip_dirs=SKIP_DIRS, max_depth=1)]
    assert "docs/plain.md" in locations
    assert "docs/guides/setup.markdown" not in locations


def test_scan_of_missing_workspace_is_empty():
    assert scan_workspace(WORKSPACE / "nope") == []


def test_attachments_match_shared_expected_output():
    assert scan_attachments(WORKSPACE, skip_dirs=SKIP_DIRS) == EXPECTED["attachments"]


def test_find_document_returns_content():
    found = find_document(WORKSPACE, _stable_id("docs/plain.md"), skip_dirs=SKIP_DIRS)
    assert found is not None
    assert found[1] == "No headings here.\nSecond line.\n"


@pytest.mark.parametrize("location", ["nope.md", "node_modules/pkg/readme.md", "docs/outside-link.md"])
def test_find_document_refuses_unknown_skipped_and_escaping(location):
    assert find_document(WORKSPACE, _stable_id(location), skip_dirs=SKIP_DIRS) is None


# The same cases as desktop/test/scanner.test.ts
META_CASES = json.loads((FIXTURES / "meta-cases.json").read_text())


@pytest.mark.parametrize("case", META_CASES, ids=[c["name"] for c in META_CASES])
def test_extract_meta(case):
    meta = extract_meta(case["text"])
    as_json = None if meta is None else {
        "status": meta.status,
        "statusDetail": meta.status_detail,
        "date": meta.date,
        "people": list(meta.people),
        "tags": list(meta.tags),
    }
    assert as_json == case["meta"]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('---\ntitle: "Quoted"\ntags: [x]\n---\nBody', ("Body", "Quoted")),
        ("---\ncreated: 1\n...\nBody", ("Body", None)),
        ("---\n---\nBody", ("Body", None)),
        ("Text\n---\nmore", ("Text\n---\nmore", None)),
        ("---\nnever closed", ("---\nnever closed", None)),
    ],
)
def test_split_front_matter(text, expected):
    assert split_front_matter(text) == expected


@pytest.mark.parametrize(
    ("inner", "text"),
    [
        ("Note", "Note"),
        ("Note|alias", "alias"),
        ("Note#Heading", "Note > Heading"),
        ("#Heading", "Heading"),
        ("Note#^block", "Note"),
        ("folder/Note|  spaced  ", "spaced"),
    ],
)
def test_wiki_link_text(inner, text):
    assert wiki_link_text(inner) == text


def test_extract_headings_skips_code_and_front_matter():
    text = "---\n# not: a heading\n---\n# A *b* `c`\n```\n# no\n```\n## [Link](x) and [[N|alias]] ##\n####### seven\n#\n"
    assert [(h.level, h.text) for h in extract_headings(text)] == [(1, "A b c"), (2, "Link and alias")]


def test_extract_headings_reads_one_line_html_headings():
    text = '<h1 align="center">A <em>b</em></h1>\n<H3>c</H3>\n<h2>unclosed\n<h7>no</h7>\n'
    assert [(h.level, h.text) for h in extract_headings(text)] == [(1, "A b"), (3, "c")]
