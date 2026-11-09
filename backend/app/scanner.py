"""
scanner.py — Discovers and catalogues markdown files under the workspace folder.

Each file is assigned a stable ID derived from its relative path so that IDs
survive renames of the workspace root but change when the file moves within it.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Heading:
    """A section heading, for searching titles and headings without reading files."""
    level: int      # 1-6
    text: str       # as rendered: no markdown syntax


@dataclass(frozen=True)
class Metadata:
    """What a document says about itself: front matter fields, or its status line."""
    status: str | None          # first word of the status, lowercased: "accepted", "draft"…
    status_detail: str | None   # the status as written, when it says more ("superseded by ADR-0005")
    date: str | None
    people: tuple[str, ...]     # decision-makers (MADR 4) or deciders (MADR 3)
    tags: tuple[str, ...]       # lowercased, without "#", no duplicates


@dataclass(frozen=True)
class DocumentMeta:
    """Lightweight record for the document listing endpoint."""
    id: str
    filename: str
    location: str   # relative path from workspace root, forward-slash separated
    title: str
    created: str    # ISO-8601 with timezone
    headings: tuple[Heading, ...] = ()
    meta: Metadata | None = None    # None when the document has none of its fields


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MARKDOWN_EXTENSIONS = {".md", ".markdown"}
# Titles and headings come from the top of the file; don't read huge files whole
_HEAD_SCAN_CHARS = 256 * 1024
_MAX_HEADINGS = 200

# One heading line: "## Text", optional closing #s; up to 3 spaces of indent
_HEADING_LINE = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$")
# An HTML heading on one line, as READMEs centre their title: <h1 align="center">Name</h1>
_HTML_HEADING_LINE = re.compile(r"^ {0,3}<h([1-6])(?:\s[^>]*)?>(.*?)</h\1\s*>", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]*>")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")


def _stable_id(relative_path: str) -> str:
    """SHA-1 of the normalised relative path string; return full 40-char hex."""
    return hashlib.sha1(relative_path.encode("utf-8")).hexdigest()


def _read_head(path: Path) -> str | None:
    """The start of the file (up to _HEAD_SCAN_CHARS), or None if it can't be read."""
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            return f.read(_HEAD_SCAN_CHARS)
    except OSError:
        return None


# YAML front matter at the very start of a file (as Obsidian, Jekyll, Hugo… write it)
_FRONT_MATTER = re.compile(r"^\ufeff?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)")
_FRONT_MATTER_TITLE = re.compile(r"^title[ \t]*:[ \t]*(.+?)[ \t]*$", re.MULTILINE)
_WIKI_LINK = re.compile(r"!?\[\[([^\]]*)\]\]")
_MAX_ATTACHMENTS = 10000


def split_front_matter(text: str) -> tuple[str, str | None]:
    """The text after any front matter, and the front matter's ``title:``, if set."""
    match = _FRONT_MATTER.match(text)
    if not match:
        return text, None
    raw = _FRONT_MATTER_TITLE.search(match.group(1) or "")
    title = re.sub(r"^([\"'])(.*)\1$", r"\2", raw.group(1)).strip() if raw else ""
    return text[match.end():], title or None


def wiki_link_text(inner: str) -> str:
    """
    How a [[wiki link]] reads: its alias, else "Note > Heading", "Note" or
    "Heading" (block references, #^id, are left out). Matches the viewer.
    """
    if "|" in inner:
        return inner.split("|", 1)[1].strip()
    name, _, heading = inner.partition("#")
    name = name.strip()
    heading = "" if heading.startswith("^") else heading.strip()
    return f"{name} > {heading}" if name and heading else name or heading


def _plain_heading(raw: str) -> str:
    """Heading text as rendered: link text instead of links, no emphasis or code markers."""
    text = _WIKI_LINK.sub(lambda m: wiki_link_text(m.group(1)), raw)
    text = _LINK.sub(r"\1", text)
    text = re.sub(r"[*`~]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_headings(text: str) -> tuple[Heading, ...]:
    """ATX (# … ######) and one-line HTML headings outside fenced code blocks, in document order."""
    headings: list[Heading] = []
    fence: str | None = None
    for line in re.split(r"\r\n|\r|\n", split_front_matter(text)[0]):
        fence_match = _FENCE.match(line)
        if fence_match:
            marker = fence_match.group(1)
            # A fence closes with the same character, at least as long
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            continue
        if fence is not None:
            continue
        match = _HEADING_LINE.match(line)
        if match:
            raw = match.group(2)
            level = len(match.group(1))
        else:
            match = _HTML_HEADING_LINE.match(line)
            if not match:
                continue
            raw = _HTML_TAG.sub("", match.group(2))
            level = int(match.group(1))
        heading_text = _plain_heading(raw)
        if not heading_text:
            continue
        headings.append(Heading(level, heading_text))
        if len(headings) >= _MAX_HEADINGS:
            break
    return tuple(headings)


# ---------------------------------------------------------------------------
# Metadata (docs/design/frontmatter-metadata.md)
# Not a YAML parser: the few forms these keys are written in, the same rules
# as desktop/src/scanner.ts.
# ---------------------------------------------------------------------------

_MAX_TAGS = 20
_MAX_TAG_LENGTH = 40
_MAX_PEOPLE = 20

# A top-level key and its value: "status: accepted", "tags:" (a block list follows)
_FRONT_MATTER_KEY = re.compile(r"^([A-Za-z][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$")
_QUOTED = re.compile(r"^([\"'])(.*)\1$")
_BLOCK_LIST_ITEM = re.compile(r"^[ \t]+-[ \t]+(.*?)[ \t]*$")
_COMMENT = re.compile(r"[ \t]+#.*$")
_TRAILING_PUNCTUATION = re.compile(r"[.,;:!]+$")
# "Status: accepted", "* Status: accepted", "**Status:** accepted"
_STATUS_LINE = re.compile(
    r"^ {0,3}(?:[*+-][ \t]+)?(?:\*\*|__)?status(?:\*\*|__)?[ \t]*:(?:\*\*|__)?[ \t]*(.+?)[ \t]*$",
    re.IGNORECASE,
)


def _front_matter_fields(block: str) -> dict[str, str | list[str]]:
    """Top-level keys of front matter: a scalar's text, or a block list's items. First of each key wins."""
    fields: dict[str, str | list[str]] = {}
    lines = re.split(r"\r\n|\r|\n", block)
    i = 0
    while i < len(lines):
        match = _FRONT_MATTER_KEY.match(lines[i])
        if match:
            value: str | list[str] = match.group(2) or ""
            if value == "":
                items: list[str] = []
                while i + 1 < len(lines) and (item := _BLOCK_LIST_ITEM.match(lines[i + 1])):
                    items.append(item.group(1))
                    i += 1
                if items:
                    value = items
            fields.setdefault(match.group(1), value)
        i += 1
    return fields


def _scalar(raw: str) -> str | None:
    """A scalar's text: unquoted, without a trailing comment; None for anything but plain text."""
    value = raw.strip()
    quoted = _QUOTED.match(value) or _QUOTED.match(_COMMENT.sub("", value))
    if quoted:
        return quoted.group(2).strip() or None
    plain = _COMMENT.sub("", value).strip()
    # Flow collections and block scalars aren't plain text
    if plain == "" or plain[0] in "[{|>":
        return None
    return plain


def _list(raw: str | list[str] | None) -> list[str]:
    """A list's items: a block list, a flow list ("[a, b]") or comma-separated text."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [item for item in map(_scalar, raw) if item is not None]
    value = raw.strip()
    if not re.search(r"[\"']", value):
        value = _COMMENT.sub("", value)
    flow = re.match(r"^\[(.*)\](?:[ \t]+#.*)?$", value)
    if flow:
        value = flow.group(1)
    elif value[:1] in ("{", "|", ">"):
        return []
    return [item for item in map(_scalar, value.split(",")) if item is not None]


def _parse_status(raw: str) -> tuple[str, str | None] | None:
    """A status as words: ("superseded", "superseded by ADR-0005"); None when there's no word."""
    value = re.sub(r"[*`]", "", raw).strip()
    first = re.match(r"^\S+", value)
    word = _TRAILING_PUNCTUATION.sub("", first.group(0)).lower() if first else ""
    if word == "":
        return None
    bare = _TRAILING_PUNCTUATION.sub("", value).lower() == word
    return word, None if bare else value


def _body_status(body: str) -> tuple[str, str | None] | None:
    """The status written in the first section: a "Status:" line before the second heading, or a "## Status" section."""
    fence: str | None = None
    started = False  # past the first non-blank line
    section: list[str] | None = None  # the "Status" section's first paragraph, once inside it
    for line in re.split(r"\r\n|\r|\n", body):
        fence_match = _FENCE.match(line)
        if fence_match:
            marker = fence_match.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            started = True
            if section:
                break
            continue
        if fence is not None:
            continue
        blank = line.strip() == ""
        if section is not None:
            if (section if blank else _HEADING_LINE.match(line)):
                break
            if not blank:
                section.append(line.strip())
            continue
        if blank:
            continue
        heading = _HEADING_LINE.match(line)
        if heading:
            # The heading the document starts with is its title; the next one ends the first section
            if not started:
                started = True
                continue
            if _plain_heading(heading.group(2)).lower() != "status":
                return None
            section = []
            continue
        started = True
        status_line = _STATUS_LINE.match(line)
        if status_line:
            return _parse_status(status_line.group(1))
    return _parse_status(" ".join(section)) if section else None


def extract_meta(text: str) -> Metadata | None:
    """The document's metadata (see :class:`Metadata`), or None when it has none."""
    match = _FRONT_MATTER.match(text)
    fields = _front_matter_fields((match.group(1) or "") if match else "")
    raw_status = fields.get("status")
    status = (_parse_status(_scalar(raw_status) or "") if isinstance(raw_status, str) else None) or _body_status(
        text[match.end():] if match else text
    )
    raw_date = fields.get("date")
    tags: list[str] = []
    for tag in _list(fields.get("tags", fields.get("tag"))):
        tag = tag.lstrip("#").strip().lower()
        if tag and len(tag) <= _MAX_TAG_LENGTH and tag not in tags:
            tags.append(tag)
    meta = Metadata(
        status=status[0] if status else None,
        status_detail=status[1] if status else None,
        date=_scalar(raw_date) if isinstance(raw_date, str) else None,
        people=tuple(_list(fields.get("decision-makers", fields.get("deciders")))[:_MAX_PEOPLE]),
        tags=tuple(tags[:_MAX_TAGS]),
    )
    if meta.status is None and meta.date is None and not meta.people and not meta.tags:
        return None
    return meta


def _extract_title(text: str | None, path: Path) -> str:
    """
    Return a human-readable title for the file using this priority:
      1. Front matter ``title:``
      2. First heading  (# Title or <h1>Title</h1>, not in a code block)
      3. First non-empty line
      4. Filename without extension
    """
    if text is None:
        return path.stem
    body, title = split_front_matter(text)
    if title is not None:
        return title

    # 2. First heading, as it reads: "About [[Note|the note]]" is "About the note"
    headings = extract_headings(text)
    if headings:
        return headings[0].text

    # 3. First non-empty line
    for line in body.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped

    # 4. Fallback: filename without extension
    return path.stem


def _is_inside(path: Path, workspace: Path) -> bool:
    """
    Whether *path* is a file within *workspace*. Symlinks are allowed only
    when they point at a file inside the workspace, so a shared folder can't
    surface e.g. ``notes.md -> ~/.ssh/id_rsa``.
    """
    if not path.is_symlink():
        return True
    target = path.resolve()
    return target.is_file() and target.is_relative_to(workspace.resolve())


def _ctime_iso(path: Path) -> str:
    """Return the file creation time (ctime) as an ISO-8601 string with UTC offset."""
    ctime = path.stat().st_ctime
    dt = datetime.fromtimestamp(ctime, tz=timezone.utc)
    return dt.isoformat()


def _build_meta(file_path: Path, workspace: Path) -> DocumentMeta:
    """Build the :class:`DocumentMeta` record for a file inside *workspace*."""
    # Relative path from workspace root, normalised to forward slashes
    location = file_path.relative_to(workspace).as_posix()
    head = _read_head(file_path)
    return DocumentMeta(
        id=_stable_id(location),
        filename=file_path.name,
        location=location,
        title=_extract_title(head, file_path),
        created=_ctime_iso(file_path),
        headings=() if head is None else extract_headings(head),
        meta=None if head is None else extract_meta(head),
    )


# ---------------------------------------------------------------------------
# ID index
# Every scan records id -> location, so opening a document is a lookup plus
# one file read instead of a full re-walk of the workspace (which costs ~1 s
# for a few thousand folders on a Docker bind mount).
# ---------------------------------------------------------------------------

_index_key: tuple[Path, frozenset[str], int | None] | None = None
_index: dict[str, str] = {}


def _remember(
    workspace: Path, skip_dirs: frozenset[str], max_depth: int | None, docs: list[DocumentMeta]
) -> None:
    global _index_key, _index
    # Swap in a complete dict so concurrent readers never see a partial index
    _index = {doc.id: doc.location for doc in docs}
    _index_key = (workspace, skip_dirs, max_depth)


def _indexed_location(
    workspace: Path, skip_dirs: frozenset[str], max_depth: int | None, doc_id: str
) -> str | None:
    if _index_key != (workspace, skip_dirs, max_depth):
        return None
    return _index.get(doc_id)


def _is_servable(
    file_path: Path,
    location: str,
    workspace: Path,
    skip_dirs: frozenset[str],
    max_depth: int | None,
) -> bool:
    """
    Re-check an indexed path before reading it: the file may have been
    removed, or a folder on its path swapped for a symlink, since the scan.
    """
    folders = location.split("/")[:-1]
    try:
        return (
            file_path.suffix.lower() in _MARKDOWN_EXTENSIONS
            and not any(part in skip_dirs for part in folders)
            and (max_depth is None or len(folders) <= max_depth)
            and file_path.is_file()
            and file_path.resolve().is_relative_to(workspace.resolve())
        )
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan_workspace(
    workspace: Path,
    skip_dirs: frozenset[str] = frozenset(),
    max_depth: int | None = None,
) -> list[DocumentMeta]:
    """
    Recursively scan *workspace* for markdown files and return a list of
    :class:`DocumentMeta` sorted by ``location``.

    *skip_dirs* is a set of folder **names** (not paths) that will be pruned
    from the walk entirely — e.g. ``frozenset({".git", "node_modules"})``.

    *max_depth* caps how many folder levels below the workspace are scanned
    (``docs/guide.md`` is depth 1); ``None`` means unlimited.

    If the workspace folder does not exist an empty list is returned so the
    server starts cleanly before the user has created any files.
    """
    if not workspace.exists():
        return []

    results: list[DocumentMeta] = []

    for root, dirs, files in os.walk(workspace):
        root_path = Path(root)
        depth = len(root_path.relative_to(workspace).parts)
        # Prune in-place so os.walk never descends into skipped directories
        # or below the depth limit.
        if max_depth is not None and depth >= max_depth:
            dirs[:] = []
        else:
            dirs[:] = [d for d in dirs if d not in skip_dirs]
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() not in _MARKDOWN_EXTENSIONS:
                continue
            if not _is_inside(file_path, workspace):
                continue

            try:
                results.append(_build_meta(file_path, workspace))
            except (OSError, ValueError):
                # Skip files we cannot stat or that escape the workspace
                continue

    results.sort(key=lambda d: d.location)
    _remember(workspace, skip_dirs, max_depth, results)
    return results


def find_document(
    workspace: Path,
    doc_id: str,
    skip_dirs: frozenset[str] = frozenset(),
    max_depth: int | None = None,
) -> tuple[DocumentMeta, str] | None:
    """
    Return *(meta, raw_content)* for the document whose ID matches *doc_id*,
    or ``None`` if not found.

    Uses the index from the last scan; only an unknown ID (e.g. a file added
    since, or a cold start) triggers a full rescan.
    """
    location = _indexed_location(workspace, skip_dirs, max_depth, doc_id)
    if location is None:
        scan_workspace(workspace, skip_dirs=skip_dirs, max_depth=max_depth)
        location = _indexed_location(workspace, skip_dirs, max_depth, doc_id)
        if location is None:
            return None

    file_path = workspace / location
    if not _is_servable(file_path, location, workspace, skip_dirs, max_depth):
        return None
    try:
        meta = _build_meta(file_path, workspace)
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        return None
    return meta, content


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

# Image types a document may embed, with the content type they are served as
IMAGE_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}


# Other files a document may link to ([data](report.pdf)), with the content
# type they are served as. Documents, data, office files and media only: no
# HTML or SVG (they'd run scripts), executables, scripts, launchers
# (.command, .webloc), archives, disk images or macro-enabled Office files;
# not .key either (Keynote, but also private keys). Mirrored by the desktop
# app's LINKED_FILE_TYPES (desktop/src/files.ts).
_TEXT = "text/plain; charset=utf-8"
LINKED_FILE_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".txt": _TEXT,
    ".log": _TEXT,
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".json": "application/json",
    ".yaml": _TEXT,
    ".yml": _TEXT,
    ".xml": _TEXT,
    ".rtf": "application/rtf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".pages": "application/vnd.apple.pages",
    ".numbers": "application/vnd.apple.numbers",
    ".epub": "application/epub+zip",
    ".heic": "image/heic",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}


def find_file(
    workspace: Path,
    location: str,
    types: dict[str, str],
    skip_dirs: frozenset[str] = frozenset(),
) -> Path | None:
    """
    Return the path of the file at workspace-relative *location*, or ``None``.

    Only files whose extension is in *types* are served, never from a
    skipped folder, and the resolved file (symlinks included) must lie
    inside the workspace.
    """
    parts = location.split("/")
    if any(part in ("", ".", "..") or "\\" in part for part in parts):
        return None
    if any(part in skip_dirs for part in parts[:-1]):
        return None
    file_path = workspace.joinpath(*parts)
    if file_path.suffix.lower() not in types:
        return None
    try:
        resolved = file_path.resolve()
        if not resolved.is_file() or not resolved.is_relative_to(workspace.resolve()):
            return None
    except OSError:
        return None
    return file_path


# ---------------------------------------------------------------------------
# Attachments — images in the workspace, for ![[image.png]] embeds, which
# name a file without its folder. Same pruning as the document scan.
# ---------------------------------------------------------------------------

def scan_attachments(
    workspace: Path,
    skip_dirs: frozenset[str] = frozenset(),
    max_depth: int | None = None,
) -> list[str]:
    """Workspace-relative locations of the image files in *workspace*, sorted."""
    if not workspace.exists():
        return []
    found: list[str] = []
    for root, dirs, files in os.walk(workspace):
        root_path = Path(root)
        depth = len(root_path.relative_to(workspace).parts)
        if max_depth is not None and depth >= max_depth:
            dirs[:] = []
        else:
            dirs[:] = [d for d in dirs if d not in skip_dirs]
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() not in IMAGE_TYPES or not _is_inside(file_path, workspace):
                continue
            found.append(file_path.relative_to(workspace).as_posix())
            if len(found) >= _MAX_ATTACHMENTS:
                return sorted(found)
    return sorted(found)
