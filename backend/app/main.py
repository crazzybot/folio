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

Usage
-----
    uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.scanner import DocumentMeta, find_document, scan_workspace

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_DEFAULT_SKIP_DIRS = ".git,node_modules,.venv,__pycache__,.cache"


def _workspace() -> Path:
    """Resolve the workspace path from the environment (or use the default)."""
    raw = os.environ.get("MARKDOWN_WORKSPACE", "./workspace")
    return Path(raw).expanduser().resolve()


def _skip_dirs() -> frozenset[str]:
    """Parse MARKDOWN_SKIP_DIRS into a frozenset of folder name strings."""
    raw = os.environ.get("MARKDOWN_SKIP_DIRS", _DEFAULT_SKIP_DIRS)
    return frozenset(name.strip() for name in raw.split(",") if name.strip())


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Markdown Previewer API",
    description="Serves markdown file metadata and raw content from a workspace folder.",
    version="0.1.0",
)

# Allow all origins so the React dev server (typically :5173 or :3000) can
# call this API without browser CORS errors.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
    docs: list[DocumentMeta] = scan_workspace(workspace, skip_dirs=_skip_dirs())
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
    result = find_document(workspace, doc_id, skip_dirs=_skip_dirs())
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{doc_id}' not found in workspace '{workspace}'.",
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
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
