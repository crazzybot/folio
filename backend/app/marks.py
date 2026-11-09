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
import re
import secrets
import sys
import threading
import unicodedata
from datetime import UTC, datetime
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Protocol

VERSION = 1
COLORS = ("yellow", "green", "blue", "pink")
MAX_EXACT = 20_000  # characters of highlighted text
MAX_CONTEXT = 64  # characters of prefix / suffix
MAX_NOTE = 10_000
MAX_HIGHLIGHTS = 1_000  # per document
MAX_BOOKMARKS = 1_000  # per document
MAX_HEADING_TEXT = 1_000
MAX_REQUESTED_STATUS = 40

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


def _requested_status(value: Any) -> str | None:
    if value is None:
        return None
    text = _string(value, "requestedStatus", MAX_REQUESTED_STATUS).strip()
    if "\n" in text or "\r" in text:
        raise MarkError(400, "requestedStatus must be one line")
    return text or None


def _document_note_body(body: Any) -> tuple[str | None, str | None]:
    """A PUT body's note: ``{text, requestedStatus}``, each null (or blank) for none."""
    if not isinstance(body, dict):
        raise MarkError(400, "Expected a JSON object")
    return _note(body.get("text")), _requested_status(body.get("requestedStatus"))


def stored_note(value: Any) -> dict[str, Any] | None:
    """A record's saved note, or None when it has none (or one this version can't read)."""
    if not isinstance(value, dict):
        return None
    created, updated = value.get("created"), value.get("updated")
    if not isinstance(created, str) or not isinstance(updated, str):
        return None

    def text_or_none(v: Any) -> str | None:
        return v if isinstance(v, str) and v.strip() else None

    found = {
        "text": text_or_none(value.get("text")),
        "requestedStatus": text_or_none(value.get("requestedStatus")),
        "created": created,
        "updated": updated,
    }
    return None if found["text"] is None and found["requestedStatus"] is None else found


def _has_marks(record: dict[str, Any]) -> bool:
    """Whether a record still holds anything: a record without marks is removed."""
    return bool(record["highlights"] or record["bookmarks"] or stored_note(record.get("documentNote")))


def _merged_note(dest: dict[str, Any] | None, moved: dict[str, Any] | None) -> dict[str, Any] | None:
    """A note moved onto a document that has one: its comment added below, its status only if there's none."""
    if dest is None or moved is None:
        return dest or moved
    return {
        "text": "\n\n".join(t for t in (dest["text"], moved["text"]) if t is not None) or None,
        "requestedStatus": dest["requestedStatus"] or moved["requestedStatus"],
        "created": dest["created"],
        "updated": _now(),
    }


def _with_note(record: dict[str, Any], note: dict[str, Any] | None) -> dict[str, Any]:
    """*record* with *note* as its document note (none for None)."""
    rest = {k: v for k, v in record.items() if k != "documentNote"}
    return rest if note is None else {**rest, "documentNote": note}


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
        if not _has_marks(record):
            path.unlink(missing_ok=True)
            return
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
        tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)

    def records(self) -> list[tuple[str, dict[str, Any]]]:
        """Every readable record of this version, with its id (others are left alone)."""
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
                found.append((file.stem, record))
        return found

    def in_workspace(self, workspace: Path) -> dict[str, tuple[str, str, dict[str, Any]]]:
        """
        Records of files inside *workspace* (whether or not they still exist),
        by location key (see location_key): record id, location, record.
        """
        root = real_path(workspace)
        prefix = _normalise(root) + os.sep
        found = {}
        for rid, record in self.records():
            if _normalise(record["path"]).startswith(prefix):
                location = record["path"][len(root) + 1 :].replace(os.sep, "/")
                found[location_key(location)] = (rid, location, record)
        return found

    # ── Moved and deleted documents ──────────────────────────────────────────

    def relink(self, rid: str, path: Path) -> None:
        """Move record *rid*'s marks to the document at *path*, merged with any it has."""
        _check_record_id(rid)
        target = record_id(path)
        with _lock:
            source = self._writable(rid)
            if source is None:
                raise MarkError(404, f"Marks '{rid}' not found")
            if target == rid:
                return
            dest = self._writable(target) or {"version": VERSION, "bookmarks": [], "highlights": []}
            ids = {h.get("id") for h in dest["highlights"]}
            headings = [b.get("heading") for b in dest["bookmarks"]]
            merged = {
                **dest,
                "bookmarks": dest["bookmarks"] + [b for b in source["bookmarks"] if b.get("heading") not in headings],
                "highlights": dest["highlights"] + [h for h in source["highlights"] if h.get("id") not in ids],
            }
            note = _merged_note(stored_note(dest.get("documentNote")), stored_note(source.get("documentNote")))
            self._write(target, _refreshed(_with_note(merged, note), path))
            self._file(rid).unlink(missing_ok=True)

    def forget(self, rid: str) -> None:
        """Delete record *rid* and all its marks."""
        _check_record_id(rid)
        with _lock:
            if self._read(rid) is None:
                raise MarkError(404, f"Marks '{rid}' not found")
            self._file(rid).unlink(missing_ok=True)

    # ── The document's note ──────────────────────────────────────────────────

    def set_note(self, path: Path, body: Any) -> dict[str, Any] | None:
        """Set the document's note (``{text, requestedStatus}``); both null removes it. Returns it, or None."""
        text, status = _document_note_body(body)
        rid = record_id(path)
        with _lock:
            record = self._writable(rid) or {"version": VERSION, "bookmarks": [], "highlights": []}
            old = stored_note(record.get("documentNote"))
            now = _now()
            saved = (
                None
                if text is None and status is None
                else {"text": text, "requestedStatus": status, "created": old["created"] if old else now, "updated": now}
            )
            self._write(rid, _refreshed(_with_note(record, saved), path))
        return saved

    def delete_note(self, path: Path) -> None:
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            if record is None or stored_note(record.get("documentNote")) is None:
                raise MarkError(404, "The document has no note")
            self._write(rid, _refreshed(_with_note(record, None), path))

    # ── Highlights ───────────────────────────────────────────────────────────

    def add_highlight(self, path: Path, body: Any) -> dict[str, Any]:
        highlight = _new_highlight(body)
        rid = record_id(path)
        with _lock:
            record = self._writable(rid) or {"version": VERSION, "bookmarks": [], "highlights": []}
            if len(record["highlights"]) >= MAX_HIGHLIGHTS:
                raise MarkError(409, f"A document can have at most {MAX_HIGHLIGHTS} highlights")
            record["highlights"].append(highlight)
            self._write(rid, _refreshed(record, path))
        return highlight

    def update_highlight(self, path: Path, highlight_id: str, body: Any) -> dict[str, Any]:
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
            self._write(rid, _refreshed(record, path))
        return highlight

    def delete_highlight(self, path: Path, highlight_id: str) -> None:
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            record["highlights"].remove(_find(record, highlight_id))
            self._write(rid, _refreshed(record, path))

    # ── Bookmarks ────────────────────────────────────────────────────────────

    def add_bookmark(self, path: Path, body: Any) -> dict[str, Any]:
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
            self._write(rid, _refreshed(record, path))
        return bookmark

    def delete_bookmark(self, path: Path, bookmark_id: str) -> None:
        rid = record_id(path)
        with _lock:
            record = self._writable(rid)
            record["bookmarks"].remove(_find(record, bookmark_id, "bookmarks"))
            self._write(rid, _refreshed(record, path))


def _check_record_id(rid: str) -> None:
    # Record ids name files: only what record_id makes
    if not re.fullmatch(r"[0-9a-f]{40}", rid):
        raise MarkError(404, f"Marks '{rid}' not found")


def _find(record: dict[str, Any] | None, mark_id: str, kind: str = "highlights") -> dict[str, Any]:
    """The highlight (or bookmark, with kind="bookmarks") with *mark_id*; 404 if there's none."""
    for mark in [] if record is None else record[kind]:
        if mark.get("id") == mark_id:
            return mark
    raise MarkError(404, f"{kind[:-1].capitalize()} '{mark_id}' not found")


def fingerprint(path: Path) -> dict[str, Any]:
    """What identifies the file's content, to re-link its marks if it's moved: from its bytes, as stored."""
    data = path.read_bytes()
    return {"sha1": hashlib.sha1(data).hexdigest(), "size": len(data), "filename": path.name}


def _refreshed(record: dict[str, Any], path: Path) -> dict[str, Any]:
    """
    The record with its path and fingerprint brought up to date. Fields this
    version doesn't know are kept, so a newer version's survive its changes.
    """
    return {
        **record,
        "version": VERSION,
        "path": real_path(path),
        "fingerprint": fingerprint(path),
        "bookmarks": record.get("bookmarks", []),
        "highlights": record["highlights"],
    }


# ---------------------------------------------------------------------------
# Listing, with moved documents found again
# ---------------------------------------------------------------------------

# Markdown punctuation and whitespace: a highlight's rendered text is looked
# for in a document's source with these collapsed to one space
_MARKUP = re.compile(r"[\s*_`~#>|\[\]]+")


def _plain(text: str) -> str:
    return _MARKUP.sub(" ", text).strip().lower()


class ListedDocument(Protocol):
    id: str
    location: str


def _evidence(record: dict[str, Any], content: str, headings: set[str]) -> bool:
    """Whether most of the record's highlights and bookmarked headings are in the document."""
    plain = _plain(content)
    checks = [_plain(h["quote"]["exact"]) in plain for h in record["highlights"]]
    checks += [b["heading"]["text"] in headings for b in record["bookmarks"] if b.get("heading")]
    # Only a bookmark on the document itself: the same name is all there is to go by
    return not checks or sum(checks) * 2 >= len(checks)


def list_marks(
    store: MarksStore,
    workspace: Path,
    docs: Sequence[ListedDocument],
    headings_of: Callable[[ListedDocument], set[str]],
) -> dict[str, Any]:
    """
    The marks of the listed *docs* (a workspace scan) that have any, in list
    order, and the records of files in *workspace* that no longer exist.

    A missing file's marks move by themselves to the one unmarked document
    with the same content (a file moved or renamed without edits). Failing
    that, the one unmarked document with the same file name is suggested when
    most of the marks are found in it.
    """
    found = store.in_workspace(workspace)
    missing = [entry for entry in found.values() if not os.path.exists(entry[2]["path"])]
    unmarked = [doc for doc in docs if location_key(doc.location) not in found]

    if missing:
        moved = _relink_unedited(store, workspace, missing, unmarked)
        if moved:
            found = store.in_workspace(workspace)
            missing = [entry for entry in found.values() if not os.path.exists(entry[2]["path"])]
            unmarked = [doc for doc in docs if location_key(doc.location) not in found]

    documents = []
    for doc in docs:
        entry = found.get(location_key(doc.location))
        if entry is not None and _has_marks(entry[2]):
            record = entry[2]
            note = stored_note(record.get("documentNote"))
            documents.append(
                {
                    "docId": doc.id,
                    "location": doc.location,
                    "bookmarks": record["bookmarks"],
                    "highlights": record["highlights"],
                    **({} if note is None else {"note": note}),
                }
            )

    listed_missing = []
    for rid, location, record in sorted(missing, key=lambda entry: entry[1]):
        filename = location.rsplit("/", 1)[-1]
        namesakes = [d for d in unmarked if d.location.rsplit("/", 1)[-1].lower() == filename.lower()]
        suggestion = None
        if len(namesakes) == 1:
            doc = namesakes[0]
            content = _read_text(workspace / doc.location)
            if content is not None and _evidence(record, content, headings_of(doc)):
                suggestion = {"docId": doc.id, "location": doc.location}
        listed_missing.append(
            {
                "recordId": rid,
                "location": location,
                "bookmarks": record["bookmarks"],
                "highlights": record["highlights"],
                **({} if (note := stored_note(record.get("documentNote"))) is None else {"note": note}),
                "suggestion": suggestion,
            }
        )
    return {"documents": documents, "missing": listed_missing}


def _relink_unedited(
    store: MarksStore,
    workspace: Path,
    missing: list[tuple[str, str, dict[str, Any]]],
    unmarked: Sequence[ListedDocument],
) -> bool:
    """Move each missing file's marks to the one unmarked document with its content; True if any moved."""
    # Missing files told apart by their content; two with the same content are left to the user
    sha1s = [entry[2].get("fingerprint", {}).get("sha1") for entry in missing]
    wanted = {sha1: entry for sha1, entry in zip(sha1s, missing) if sha1 and sha1s.count(sha1) == 1}
    sizes = {wanted[sha1][2]["fingerprint"].get("size") for sha1 in wanted}
    # Hash only documents of a size some missing file had
    by_sha1: dict[str, list[Path]] = {}
    for doc in unmarked:
        path = workspace / doc.location
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > 0 and size in sizes:
            by_sha1.setdefault(fingerprint(path)["sha1"], []).append(path)
    moved = False
    for sha1, (rid, _location, _record) in wanted.items():
        paths = by_sha1.get(sha1, [])
        if len(paths) == 1:
            store.relink(rid, paths[0])
            moved = True
    return moved


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
