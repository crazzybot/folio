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
class DocumentMeta:
    """Lightweight record for the document listing endpoint."""
    id: str
    filename: str
    location: str   # relative path from workspace root, forward-slash separated
    title: str
    created: str    # ISO-8601 with timezone


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ATX_HEADING = re.compile(r"^#{1,6}\s+(.+)", re.MULTILINE)
_MARKDOWN_EXTENSIONS = {".md", ".markdown"}
# Titles come from the top of the file; don't read huge files whole
_TITLE_SCAN_CHARS = 64 * 1024


def _stable_id(relative_path: str) -> str:
    """SHA-1 of the normalised relative path string; return full 40-char hex."""
    return hashlib.sha1(relative_path.encode("utf-8")).hexdigest()


def _extract_title(path: Path, relative_path: str) -> str:
    """
    Return a human-readable title for the file using this priority:
      1. First ATX heading  (# Title)
      2. First non-empty line
      3. Filename without extension
    """
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            text = f.read(_TITLE_SCAN_CHARS)
    except OSError:
        return path.stem

    # 1. ATX heading
    match = _ATX_HEADING.search(text)
    if match:
        return match.group(1).strip()

    # 2. First non-empty line
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped

    # 3. Fallback: filename without extension
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan_workspace(
    workspace: Path,
    skip_dirs: frozenset[str] = frozenset(),
) -> list[DocumentMeta]:
    """
    Recursively scan *workspace* for markdown files and return a list of
    :class:`DocumentMeta` sorted by ``location``.

    *skip_dirs* is a set of folder **names** (not paths) that will be pruned
    from the walk entirely — e.g. ``frozenset({".git", "node_modules"})``.

    If the workspace folder does not exist an empty list is returned so the
    server starts cleanly before the user has created any files.
    """
    if not workspace.exists():
        return []

    results: list[DocumentMeta] = []

    for root, dirs, files in os.walk(workspace):
        # Prune in-place so os.walk never descends into skipped directories.
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            if file_path.suffix.lower() not in _MARKDOWN_EXTENSIONS:
                continue
            if not _is_inside(file_path, workspace):
                continue

            try:
                # Relative path from workspace root, normalised to forward slashes
                rel = file_path.relative_to(workspace)
                location = rel.as_posix()

                doc = DocumentMeta(
                    id=_stable_id(location),
                    filename=file_path.name,
                    location=location,
                    title=_extract_title(file_path, location),
                    created=_ctime_iso(file_path),
                )
                results.append(doc)
            except (OSError, ValueError):
                # Skip files we cannot stat or that escape the workspace
                continue

    results.sort(key=lambda d: d.location)
    return results


def find_document(
    workspace: Path,
    doc_id: str,
    skip_dirs: frozenset[str] = frozenset(),
) -> tuple[DocumentMeta, str] | None:
    """
    Return *(meta, raw_content)* for the document whose ID matches *doc_id*,
    or ``None`` if not found.
    """
    for doc in scan_workspace(workspace, skip_dirs=skip_dirs):
        if doc.id == doc_id:
            file_path = workspace / doc.location
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None
            return doc, content
    return None
