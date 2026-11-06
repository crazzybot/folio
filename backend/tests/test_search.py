from app.scanner import _stable_id
from app.search import search_content, search_workspace
from tests.conftest import SKIP_DIRS, WORKSPACE


def test_counts_matches_and_numbers_snippets_by_occurrence():
    count, matches = search_content("foo\nbar FOO foo\nfoo", "foo")
    assert count == 4
    assert [(m.line, m.occurrence, m.text[m.start : m.end]) for m in matches] == [(1, 0, "foo"), (2, 1, "FOO"), (2, 2, "foo")]


def test_shortens_long_lines_and_drops_indentation():
    line = "x" * 100 + " needle " + "y" * 120
    (long,) = search_content(line, "needle")[1]
    assert long.text.startswith("…") and long.text.endswith("…")
    assert long.text[long.start : long.end] == "needle"
    (indented,) = search_content("    an indented needle", "needle")[1]
    assert indented.text == "an indented needle"


def test_workspace_search_in_list_order_skipping_skipped_folders():
    results = search_workspace(WORKSPACE, "heading", skip_dirs=SKIP_DIRS)
    assert [(r.id, r.match_count) for r in results] == [
        (_stable_id("README.md"), 1),
        (_stable_id("docs/front-matter.md"), 1),
        (_stable_id("docs/plain.md"), 1),
    ]
    assert search_workspace(WORKSPACE, "Vendored", skip_dirs=SKIP_DIRS) == []


def test_short_queries_return_nothing():
    assert search_workspace(WORKSPACE, " a ", skip_dirs=SKIP_DIRS) == []
