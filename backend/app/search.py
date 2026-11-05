"""
search.py — Full-text search across the workspace's markdown files.

A case-insensitive plain-text match (no regex). Each result carries the
document's match count and a few matching lines as snippets; a snippet's
``occurrence`` is the 0-based index of its match among all matches in the
document, so the viewer can scroll to that match. desktop/src/search.ts is
the desktop app's port.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.scanner import scan_workspace

MIN_QUERY_LENGTH = 2
_MAX_QUERY_LENGTH = 200
_MAX_RESULTS = 200
_MAX_SNIPPETS = 3
_MAX_FILE_BYTES = 2 * 1024 * 1024  # larger files are skipped
_SNIPPET_BEFORE = 40
_SNIPPET_AFTER = 80


@dataclass(frozen=True)
class SearchMatch:
    line: int        # 1-based line number
    text: str        # the line, shortened around the match when long
    start: int       # the match within text: [start, end)
    end: int
    occurrence: int  # 0-based index of this match among the document's matches


@dataclass
class SearchResult:
    id: str
    match_count: int = 0
    matches: list[SearchMatch] = field(default_factory=list)


def _snippet(line: str, start: int, end: int) -> tuple[str, int, int]:
    """The line around [start, end), shortened with "…" where cut."""
    begin = max(0, start - _SNIPPET_BEFORE)
    stop = min(len(line), end + _SNIPPET_AFTER)
    prefix = "…" if begin > 0 else ""
    suffix = "…" if stop < len(line) else ""
    body = line[begin:stop]
    # Leading indentation carries no meaning in a snippet
    trimmed = body if prefix else body.lstrip()
    shift = len(prefix) - (len(body) - len(trimmed)) - begin
    return prefix + trimmed + suffix, start + shift, end + shift


def search_content(content: str, needle: str) -> tuple[int, list[SearchMatch]]:
    """Count the matches of lowercase *needle* in *content*, with the first few as snippets."""
    matches: list[SearchMatch] = []
    count = 0
    for number, line in enumerate(content.splitlines(), start=1):
        lower = line.lower()
        at = lower.find(needle)
        while at != -1:
            if len(matches) < _MAX_SNIPPETS:
                text, start, end = _snippet(line, at, at + len(needle))
                matches.append(SearchMatch(number, text, start, end, count))
            count += 1
            at = lower.find(needle, at + len(needle))
    return count, matches


def search_workspace(
    workspace: Path,
    query: str,
    skip_dirs: frozenset[str] = frozenset(),
    max_depth: int | None = None,
) -> list[SearchResult]:
    """Documents whose text contains *query*, in document-list order."""
    needle = query.strip().lower()[:_MAX_QUERY_LENGTH]
    if len(needle) < MIN_QUERY_LENGTH:
        return []

    results: list[SearchResult] = []
    for doc in scan_workspace(workspace, skip_dirs=skip_dirs, max_depth=max_depth):
        path = workspace / doc.location
        try:
            if path.stat().st_size > _MAX_FILE_BYTES:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue  # removed or unreadable since the scan
        count, matches = search_content(content, needle)
        if count:
            results.append(SearchResult(doc.id, count, matches))
            if len(results) >= _MAX_RESULTS:
                break
    return results
