"""
marks.py — Highlights, notes and bookmarks, kept outside the workspace.

Folio never writes to documents. Marks live in ``<data dir>/marks/``, one JSON
record per document, named by the SHA-1 of the document's normalised real
path — so a file keeps its marks whichever folder is opened as the workspace
(its own folder, a parent folder…), and two processes sharing the data folder
(the desktop app and a local backend) find the same record.

Same format and rules as ``desktop/src/marks.ts``; both are tested against
``tests/fixtures/marks``. See docs/design/marks.md.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
import threading
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

VERSION = 1
COLORS = ("yellow", "green", "blue", "pink")
MAX_EXACT = 20_000  # characters of highlighted text
MAX_CONTEXT = 64  # characters of prefix / suffix
MAX_NOTE = 10_000
MAX_HIGHLIGHTS = 1_000  # per document
MAX_BOOKMARKS = 1_000  # per document
MAX_HEADING_TEXT = 1_000

# Paths differ only by case on these platforms' default file systems
_CASE_INSENSITIVE = sys.platform in ("darwin", "win32")


class MarkError(Exception):
    """A request the store refuses; ``status`` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def _normalise(path: str) -> str:
    """Comparable form of a path: NFC (macOS may give NFD names), lower case where case doesn't matter."""
    path = unicodedata.normalize("NFC", path)
    return path.lower() if _CASE_INSENSITIVE else path


def real_path(path: Path) -> str:
    """The path stored in a record: symlinks resolved, NFC."""
    return unicodedata.normalize("NFC", os.path.realpath(path))


def record_id(path: Path) -> str:
    """The record (file name) for the document at *path*."""
    return hashlib.sha1(_normalise(real_path(path)).encode("utf-8")).hexdigest()


def location_key(location: str) -> str:
    """Comparable form of a workspace-relative location, to match records to scanned documents."""
    return _normalise(location)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _string(value: Any, name: str, max_length: int, *, min_length: int = 0) -> str:
    if not isinstance(value, str) or not min_length <= len(value) <= max_length:
        raise MarkError(400, f"{name} must be a string of {min_length}–{max_length} characters")
    return value


def _offset(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise MarkError(400, f"{name} must be a non-negative integer")
    return value


def _color(value: Any) -> str:
    if value not in COLORS:
        raise MarkError(400, f"color must be one of {', '.join(COLORS)}")
    return value


def _note(value: Any) -> str | None:
    if value is None:
        return None
    note = _string(value, "note", MAX_NOTE)
    return note if note.strip() else None


def _new_highlight(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise MarkError(400, "Expected a JSON object")
    quote, position = body.get("quote"), body.get("position")
    if not isinstance(quote, dict) or not isinstance(position, dict):
        raise MarkError(400, "quote and position must be objects")
    start = _offset(position.get("start"), "position.start")
    end = _offset(position.get("end"), "position.end")
    if end <= start:
        raise MarkError(400, "position.end must be after position.start")
    now = _now()
    return {
        "id": secrets.token_hex(8),
        "color": _color(body.get("color")),
        "note": _note(body.get("note")),
        "quote": {
            "exact": _string(quote.get("exact"), "quote.exact", MAX_EXACT, min_length=1),
            "prefix": _string(quote.get("prefix", ""), "quote.prefix", MAX_CONTEXT),
            "suffix": _string(quote.get("suffix", ""), "quote.suffix", MAX_CONTEXT),
        },
        "position": {"start": start, "end": end},
        "created": now,
        "updated": now,
    }


def _heading(value: Any) -> dict[str, Any] | None:
    """A bookmarked heading — its text, level and which of the same-text, same-level headings — or None for the document."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise MarkError(400, "heading must be an object or null")
    level = value.get("level")
    if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= 6:
        raise MarkError(400, "heading.level must be an integer from 1 to 6")
    return {
        "text": _string(value.get("text"), "heading.text", MAX_HEADING_TEXT, min_length=1),
        "level": level,
        "occurrence": _offset(value.get("occurrence", 0), "heading.occurrence"),
    }


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

# Changes are read–modify–write of one file; FastAPI runs requests on threads
_lock = threading.Lock()


class MarksStore:
    def __init__(self, data_dir: Path) -> None:
        self.folder = data_dir / "marks"

    # ── Records ──────────────────────────────────────────────────────────────

    def _file(self, rid: str) -> Path:
        return self.folder / f"{rid}.json"

    def _read(self, rid: str) -> dict[str, Any] | None:
        """The record, None if there is none; a damaged one is refused rather than overwritten."""
        try:
            raw = self._file(rid).read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            record = json.loads(raw)
        except ValueError:
            record = None
        if (
            not isinstance(record, dict)
            or not isinstance(record.get("highlights"), list)
            or not isinstance(record.get("bookmarks", []), list)
        ):
            raise MarkError(409, "This document's marks file is damaged; it was left as it is")
        record.setdefault("bookmarks", [])
        return record

    def _writable(self, rid: str) -> dict[str, Any] | None:
        record = self._read(rid)
        if record is not None and record.get("version") != VERSION:
            raise MarkError(409, "These marks were saved by a newer version of Folio")
        return record

    def _write(self, rid: str, record: dict[str, Any]) -> None:
        """Save atomically (temp file, then rename); a record with no marks left is removed."""
        path = self._file(rid)
        if not record["highlights"] and not record["bookmarks"]:
            path.unlink(missing_ok=True)
            return
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
        tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)

    def records(self) -> list[dict[str, Any]]:
        """Every readable record of this version (others are left alone)."""
        found = []
        for file in sorted(self.folder.glob("*.json")):
            try:
                record = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if (
                isinstance(record, dict)
                and record.get("version") == VERSION
                and isinstance(record.get("path"), str)
                and isinstance(record.get("highlights"), list)
                and isinstance(record.get("bookmarks", []), list)
            ):
                record.setdefault("bookmarks", [])
                found.append(record)
        return found

    def in_workspace(self, workspace: Path) -> dict[str, dict[str, Any]]:
        """Records of documents inside *workspace*, by location key (see location_key)."""
        root = real_path(workspace)
        prefix = _normalise(root) + os.sep
        found = {}
        for record in self.records():
            if _normalise(record["path"]).startswith(prefix):
                location = record["path"][len(root) + 1 :].replace(os.sep, "/")
                found[location_key(location)] = record
        return found

    # ── Highlights ───────────────────────────────────────────────────────────

    def add_highlight(self, path: Path, content: str, body: Any) -> dict[str, Any]:
        highlight = _new_highlight(body)
        rid = record_id(path)
        with _lock:
            record = self._writable(rid) or {"version": VERSION, "bookmarks": [], "highlights": []}
            if len(record["highlights"]) >= MAX_HIGHLIGHTS:
                raise MarkError(409, f"A document can have at most {MAX_HIGHLIGHTS} highlights")
            record["highlights"].append(highlight)
            self._write(rid, _refreshed(record, path, content))
        return highlight

    def update_highlight(self, path: Path, content: str, highlight_id: str, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise MarkError(400, "Expected a JSON object")
        # Validate before changing anything
        changes: dict[str, Any] = {}
        if "color" in body:
            changes["color"] = _color(body["color"])
        if "note" in body:
            changes["note"] = _note(body["note"])
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            highlight = _find(record, highlight_id)
            highlight.update(changes, updated=_now())
            self._write(rid, _refreshed(record, path, content))
        return highlight

    def delete_highlight(self, path: Path, content: str, highlight_id: str) -> None:
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            record["highlights"].remove(_find(record, highlight_id))
            self._write(rid, _refreshed(record, path, content))

    # ── Bookmarks ────────────────────────────────────────────────────────────

    def add_bookmark(self, path: Path, content: str, body: Any) -> dict[str, Any]:
        """Bookmark the document (``{"heading": null}``) or a heading; an existing bookmark is returned as it is."""
        if not isinstance(body, dict):
            raise MarkError(400, "Expected a JSON object")
        heading = _heading(body.get("heading"))
        rid = record_id(path)
        with _lock:
            record = self._writable(rid) or {"version": VERSION, "bookmarks": [], "highlights": []}
            for bookmark in record["bookmarks"]:
                if bookmark.get("heading") == heading:
                    return bookmark
            if len(record["bookmarks"]) >= MAX_BOOKMARKS:
                raise MarkError(409, f"A document can have at most {MAX_BOOKMARKS} bookmarks")
            bookmark = {"id": secrets.token_hex(8), "heading": heading, "created": _now()}
            record["bookmarks"].append(bookmark)
            self._write(rid, _refreshed(record, path, content))
        return bookmark

    def delete_bookmark(self, path: Path, content: str, bookmark_id: str) -> None:
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            record["bookmarks"].remove(_find(record, bookmark_id, "bookmarks"))
            self._write(rid, _refreshed(record, path, content))


def _find(record: dict[str, Any] | None, mark_id: str, kind: str = "highlights") -> dict[str, Any]:
    """The highlight (or bookmark, with kind="bookmarks") with *mark_id*; 404 if there's none."""
    for mark in [] if record is None else record[kind]:
        if mark.get("id") == mark_id:
            return mark
    raise MarkError(404, f"{kind[:-1].capitalize()} '{mark_id}' not found")


def _refreshed(record: dict[str, Any], path: Path, content: str) -> dict[str, Any]:
    """The record with its path and fingerprint (used to re-link moved files) brought up to date."""
    data = content.encode("utf-8")
    return {
        "version": VERSION,
        "path": real_path(path),
        "fingerprint": {"sha1": hashlib.sha1(data).hexdigest(), "size": len(data), "filename": path.name},
        "bookmarks": record.get("bookmarks", []),
        "highlights": record["highlights"],
    }
