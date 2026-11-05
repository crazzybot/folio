"""
main.py — FastAPI application for the Markdown Previewer backend.

Environment variables
---------------------
MARKDOWN_WORKSPACE
    Absolute or relative path to the folder that contains markdown files.
    Defaults to ``./workspace`` (relative to the current working directory).

MARKDOWN_SKIP_DIRS
    Comma-separated list of folder **names** that the scanner will skip
    entirely (the folder and all its descendants are ignored).
    Example: ``MARKDOWN_SKIP_DIRS=.git,node_modules,.venv,__pycache__``
    Defaults to ``.git,node_modules,.venv,__pycache__,.cache``.

MARKDOWN_MAX_DEPTH
    Maximum number of folder levels below the workspace to scan
    (``docs/guide.md`` is depth 1). Unset or empty means unlimited. A safety
    cap for very large workspaces; skipping cache folders via
    MARKDOWN_SKIP_DIRS is usually the more precise fix.

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

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.scanner import DocumentMeta, find_document, scan_workspace

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_DEFAULT_SKIP_DIRS = ".git,node_modules,.venv,__pycache__,.cache"
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


def _max_depth() -> int | None:
    """Parse MARKDOWN_MAX_DEPTH; unset, empty or invalid means unlimited."""
    raw = os.environ.get("MARKDOWN_MAX_DEPTH", "").strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Markdown Previewer API",
    description="Serves markdown file metadata and raw content from a workspace folder.",
    version="0.1.0",
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
        allow_methods=["GET"],
    )


# ---------------------------------------------------------------------------
# Response models (typed dicts keep things lightweight without Pydantic models)
# ---------------------------------------------------------------------------

from typing import TypedDict


class DocumentListItem(TypedDict):
    id: str
    filename: str
    location: str
    title: str
    created: str


class DocumentContent(TypedDict):
    id: str
    content: str


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
