"""
main.py — FastAPI application for the Folio backend.

Environment variables
---------------------
MARKDOWN_WORKSPACE
    Absolute or relative path to the folder that contains markdown files.
    Defaults to ``./workspace`` (relative to the current working directory).

MARKDOWN_SKIP_DIRS
    Comma-separated list of folder **names** that the scanner will skip
    entirely (the folder and all its descendants are ignored).
    Example: ``MARKDOWN_SKIP_DIRS=.git,node_modules,.venv,__pycache__``
    Defaults to version control, dependency, virtualenv, cache and tool-data
    folders (``.git``, ``node_modules``, ``.venv``, ``venv``, ``.local``,
    ``.tox``, ``.next``, ``Pods``… — see ``_DEFAULT_SKIP_DIRS``).

MARKDOWN_MAX_DEPTH
    Maximum number of folder levels below the workspace to scan
    (``docs/guide.md`` is depth 1). Unset or empty means unlimited. A safety
    cap for very large workspaces; skipping cache folders via
    MARKDOWN_SKIP_DIRS is usually the more precise fix.

MARKDOWN_DATA_DIR
    Folder for Folio's own data — highlights are kept in its ``marks/``
    subfolder, never in the workspace. Defaults to ``~/.folio``, the desktop
    app's folder too, so both see the same marks.

MARKDOWN_CORS_ORIGINS
    Comma-separated browser origins allowed to call the API cross-origin.
    Defaults to the local Vite dev/preview servers. Set it empty to disable
    CORS entirely (the Docker setup is same-origin through nginx).

MARKDOWN_ALLOWED_HOSTS
    Comma-separated Host header values the API answers to; anything else gets
    400, which blocks DNS-rebinding attacks. Defaults to
    ``localhost,127.0.0.1``.

Usage
-----
    uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.scanner import (
    IMAGE_TYPES,
    LINKED_FILE_TYPES,
    DocumentMeta,
    find_document,
    find_file,
    scan_attachments,
    scan_workspace,
)
from app.marks import MarkError, MarksStore, list_marks as list_workspace_marks
from app.search import search_workspace

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Folders never worth scanning: version control, dependencies, virtualenvs,
# caches and tool data. Same list as the desktop app's default skipDirs. Not
# dist / build / vendor / target: some projects keep real documentation there.
_DEFAULT_SKIP_DIRS = (
    ".git,node_modules,.venv,venv,__pycache__,.cache,.local,.tox,.nox,.mypy_cache,"
    ".pytest_cache,.ruff_cache,.next,.nuxt,.svelte-kit,.yarn,bower_components,"
    ".terraform,Pods,.gradle"
)
_DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:5173,http://127.0.0.1:5173"
)
_DEFAULT_ALLOWED_HOSTS = "localhost,127.0.0.1"


def _csv_env(name: str, default: str) -> list[str]:
    """Parse a comma-separated environment variable into a list of values."""
    raw = os.environ.get(name, default)
    return [value.strip() for value in raw.split(",") if value.strip()]


def _workspace() -> Path:
    """Resolve the workspace path from the environment (or use the default)."""
    raw = os.environ.get("MARKDOWN_WORKSPACE", "./workspace")
    return Path(raw).expanduser().resolve()


def _skip_dirs() -> frozenset[str]:
    """Parse MARKDOWN_SKIP_DIRS into a frozenset of folder name strings."""
    return frozenset(_csv_env("MARKDOWN_SKIP_DIRS", _DEFAULT_SKIP_DIRS))


def _marks() -> MarksStore:
    """The marks store in MARKDOWN_DATA_DIR (default ~/.folio)."""
    return MarksStore(Path(os.environ.get("MARKDOWN_DATA_DIR") or "~/.folio").expanduser())


def _max_depth() -> int | None:
    """Parse MARKDOWN_MAX_DEPTH; unset, empty or invalid means unlimited."""
    raw = os.environ.get("MARKDOWN_MAX_DEPTH", "").strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Folio API",
    description="Serves markdown file metadata and raw content from a workspace folder.",
    version="0.2.0",
)

# Answer only to expected Host headers. Without this, a web page on any
# domain that DNS-rebinds to 127.0.0.1 could read the API as same-origin.
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=_csv_env("MARKDOWN_ALLOWED_HOSTS", _DEFAULT_ALLOWED_HOSTS),
)

# Only the local frontend may call the API cross-origin — never "*", which
# would let any website the user visits read their documents.
_cors_origins = _csv_env("MARKDOWN_CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )


# ---------------------------------------------------------------------------
# Response models (typed dicts keep things lightweight without Pydantic models)
# ---------------------------------------------------------------------------

from typing import TypedDict


class HeadingItem(TypedDict):
    level: int
    text: str


class DocumentListItem(TypedDict):
    id: str
    filename: str
    location: str
    title: str
    created: str
    headings: list[HeadingItem]


class DocumentContent(TypedDict):
    id: str
    content: str


class SearchMatchItem(TypedDict):
    line: int
    text: str
    start: int
    end: int
    occurrence: int


class SearchResultItem(TypedDict):
    id: str
    matchCount: int
    matches: list[SearchMatchItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get(
    "/api/documents",
    response_model=list[DocumentListItem],
    summary="List all markdown documents in the workspace",
)
def list_documents() -> list[DocumentListItem]:
    """
    Recursively scan the workspace and return metadata for every ``*.md`` /
    ``*.markdown`` file, sorted by their relative path.

    The workspace is re-scanned on every request — no file-watcher required.
    If the workspace folder does not exist yet an empty array is returned.
    """
    workspace = _workspace()
    docs: list[DocumentMeta] = scan_workspace(
        workspace, skip_dirs=_skip_dirs(), max_depth=_max_depth()
    )
    return [
        DocumentListItem(
            id=doc.id,
            filename=doc.filename,
            location=doc.location,
            title=doc.title,
            created=doc.created,
            headings=[HeadingItem(level=h.level, text=h.text) for h in doc.headings],
        )
        for doc in docs
    ]


@app.get(
    "/api/documents/{doc_id}/content",
    response_model=DocumentContent,
    summary="Fetch the raw markdown content of a single document",
)
def get_document_content(doc_id: str) -> DocumentContent:
    """
    Return the raw markdown string for the document identified by *doc_id*.

    The ID is derived from the file's relative path inside the workspace
    (``sha1(relative_path)`` hex digest) so it is stable across server
    restarts as long as the file is not moved.

    Raises **404** if no document with the given ID exists in the workspace.
    """
    workspace = _workspace()
    result = find_document(workspace, doc_id, skip_dirs=_skip_dirs(), max_depth=_max_depth())
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{doc_id}' not found.",
        )
    doc, content = result
    return DocumentContent(id=doc.id, content=content)


@app.get(
    "/api/attachments",
    response_model=list[str],
    summary="List the image files in the workspace",
)
def list_attachments() -> list[str]:
    """
    Return the workspace-relative paths of every image file, sorted, so
    Obsidian-style embeds (``![[diagram.png]]``) can be resolved by name.
    Skips the same folders as the document list.
    """
    return scan_attachments(_workspace(), skip_dirs=_skip_dirs(), max_depth=_max_depth())


@app.get(
    "/api/search",
    response_model=list[SearchResultItem],
    summary="Search the text of every document",
)
def search_documents(q: str = Query(..., max_length=500)) -> list[SearchResultItem]:
    """
    Return the documents whose text contains *q* (case-insensitive, plain
    text), in document-list order, each with its match count and up to three
    matching lines. Queries shorter than two characters return ``[]``.
    """
    results = search_workspace(_workspace(), q, skip_dirs=_skip_dirs(), max_depth=_max_depth())
    return [
        SearchResultItem(
            id=r.id,
            matchCount=r.match_count,
            matches=[
                SearchMatchItem(line=m.line, text=m.text, start=m.start, end=m.end, occurrence=m.occurrence)
                for m in r.matches
            ],
        )
        for r in results
    ]


# ---------------------------------------------------------------------------
# Marks — kept in MARKDOWN_DATA_DIR, never in the workspace (see app/marks.py)
# ---------------------------------------------------------------------------


class HighlightQuote(TypedDict):
    exact: str
    prefix: str
    suffix: str


class HighlightPosition(TypedDict):
    start: int
    end: int


class HighlightItem(TypedDict):
    id: str
    color: str
    note: str | None
    quote: HighlightQuote
    position: HighlightPosition
    created: str
    updated: str


class BookmarkHeading(TypedDict):
    text: str
    level: int
    occurrence: int


class BookmarkItem(TypedDict):
    id: str
    heading: BookmarkHeading | None
    created: str


class DocumentMarksItem(TypedDict):
    docId: str
    location: str
    bookmarks: list[BookmarkItem]
    highlights: list[HighlightItem]


class SuggestionItem(TypedDict):
    docId: str
    location: str


class MissingMarksItem(TypedDict):
    recordId: str
    location: str
    bookmarks: list[BookmarkItem]
    highlights: list[HighlightItem]
    suggestion: SuggestionItem | None


class MarksListing(TypedDict):
    documents: list[DocumentMarksItem]
    missing: list[MissingMarksItem]



async def _json_body(request: Request) -> Any:
    """
    The request's JSON body. Requiring the JSON content type means a page on
    another site can't send one without a CORS preflight, which it fails —
    a plain cross-site form post is refused here.
    """
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Expected application/json")
    try:
        return await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON") from None


def _document(doc_id: str) -> Path:
    """The path of a workspace document; 404 if there's none."""
    workspace = _workspace()
    result = find_document(workspace, doc_id, skip_dirs=_skip_dirs(), max_depth=_max_depth())
    if result is None:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found.")
    doc, _content = result
    return workspace / doc.location


def _store_call(action):
    """Run a store change, turning its refusals into HTTP errors."""
    try:
        return action()
    except MarkError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from None


@app.get(
    "/api/marks",
    response_model=MarksListing,
    summary="List the bookmarks and highlights of every document in the workspace",
)
def list_marks() -> MarksListing:
    """
    Every listed document that has marks, in document-list order, and the
    marks of files in the workspace that no longer exist (``missing``, by
    location). Marks are found by the document's real path, so the same file
    shows the same marks from any workspace that contains it.

    A missing file's marks move by themselves to the one unmarked document
    with the same content (moved or renamed, not edited); otherwise the one
    unmarked document with its name is ``suggestion`` when most of its marks
    are found in it.
    """
    workspace = _workspace()
    docs = scan_workspace(workspace, skip_dirs=_skip_dirs(), max_depth=_max_depth())
    return list_workspace_marks(_marks(), workspace, docs, lambda doc: {h.text for h in doc.headings})


def _missing_record(record_id: str) -> None:
    """404 unless *record_id* is the marks of a file in the workspace that no longer exists."""
    for rid, _location, record in _marks().in_workspace(_workspace()).values():
        if rid == record_id and not os.path.exists(record["path"]):
            return
    raise HTTPException(status_code=404, detail=f"No missing document's marks '{record_id}'.")


@app.post(
    "/api/marks/{record_id}/relink",
    status_code=204,
    summary="Move a missing document's marks to a document",
)
def relink_marks(record_id: str, body: Any = Depends(_json_body)) -> Response:
    """Body: ``{"docId"}``. Marks the document already has are kept, and the moved ones added."""
    _missing_record(record_id)
    doc_id = body.get("docId") if isinstance(body, dict) else None
    if not isinstance(doc_id, str):
        raise HTTPException(status_code=400, detail="docId must be a string")
    path = _document(doc_id)
    _store_call(lambda: _marks().relink(record_id, path))
    return Response(status_code=204)


@app.delete(
    "/api/marks/{record_id}",
    status_code=204,
    summary="Delete a missing document's marks",
)
def forget_marks(record_id: str) -> Response:
    _missing_record(record_id)
    _store_call(lambda: _marks().forget(record_id))
    return Response(status_code=204)


@app.post(
    "/api/documents/{doc_id}/highlights",
    response_model=HighlightItem,
    status_code=201,
    summary="Highlight a passage of a document",
)
def add_highlight(doc_id: str, body: Any = Depends(_json_body)) -> HighlightItem:
    """
    Body: ``{"color", "quote": {"exact", "prefix", "suffix"}, "position":
    {"start", "end"}, "note"?}`` — positions and quote are in the rendered
    text. Returns the saved highlight with its id.
    """
    path = _document(doc_id)
    return _store_call(lambda: _marks().add_highlight(path, body))


@app.patch(
    "/api/documents/{doc_id}/highlights/{highlight_id}",
    response_model=HighlightItem,
    summary="Change a highlight's colour or note",
)
def update_highlight(doc_id: str, highlight_id: str, body: Any = Depends(_json_body)) -> HighlightItem:
    """Body: ``{"color"?, "note"?}``; an empty or blank note removes it."""
    path = _document(doc_id)
    return _store_call(lambda: _marks().update_highlight(path, highlight_id, body))


@app.delete(
    "/api/documents/{doc_id}/highlights/{highlight_id}",
    status_code=204,
    summary="Remove a highlight",
)
def delete_highlight(doc_id: str, highlight_id: str) -> Response:
    path = _document(doc_id)
    _store_call(lambda: _marks().delete_highlight(path, highlight_id))
    return Response(status_code=204)


@app.post(
    "/api/documents/{doc_id}/bookmarks",
    response_model=BookmarkItem,
    summary="Bookmark a document or one of its headings",
)
def add_bookmark(doc_id: str, body: Any = Depends(_json_body)) -> BookmarkItem:
    """
    Body: ``{"heading": null}`` for the document, or ``{"heading": {"text",
    "level", "occurrence"}}`` for a heading (``occurrence`` counts earlier
    headings with the same text and level). Returns the bookmark — the
    existing one if it's already bookmarked.
    """
    path = _document(doc_id)
    return _store_call(lambda: _marks().add_bookmark(path, body))


@app.delete(
    "/api/documents/{doc_id}/bookmarks/{bookmark_id}",
    status_code=204,
    summary="Remove a bookmark",
)
def delete_bookmark(doc_id: str, bookmark_id: str) -> Response:
    path = _document(doc_id)
    _store_call(lambda: _marks().delete_bookmark(path, bookmark_id))
    return Response(status_code=204)


# Files are only ever displayed or downloaded, never run: an SVG or other file
# opened directly must not execute scripts or load anything (the same policy
# as the desktop app).
_SERVED_TYPES = {**IMAGE_TYPES, **LINKED_FILE_TYPES}

_FILE_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
}


@app.get(
    "/api/files/{location:path}",
    summary="Fetch an image or linked file from the workspace",
    response_class=FileResponse,
)
def get_file(location: str) -> FileResponse:
    """
    Return the file at *location* (workspace-relative, forward slashes): an
    image a document embeds (``![](img/diagram.png)``) or a file it links to
    (``[data](report.pdf)``).

    Only images and the document, data, office and media types in
    ``LINKED_FILE_TYPES`` are served — never HTML, scripts, executables or
    archives — only from inside the workspace and never from a folder in
    MARKDOWN_SKIP_DIRS. Raises **404** for anything else.
    """
    path = find_file(_workspace(), location, _SERVED_TYPES, skip_dirs=_skip_dirs())
    if path is None:
        raise HTTPException(status_code=404, detail=f"File '{location}' not found.")
    return FileResponse(path, media_type=_SERVED_TYPES[path.suffix.lower()], headers=_FILE_HEADERS)


# ---------------------------------------------------------------------------
# Direct-run entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
