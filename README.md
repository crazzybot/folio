# Markdown Previewer

A lightweight, two-pane Markdown browser. Drop `.md` files into a local workspace
folder, and the app lets you navigate, search, and read them with full syntax
highlighting — all without leaving your browser.

```
┌──────────────────┬──────────────────────────────────────────────┐
│  Document list   │  Rendered Markdown (GFM + syntax highlight)  │
│  (searchable)    │                                               │
│  ◀ drag ▶        │                                               │
└──────────────────┴──────────────────────────────────────────────┘
```

**Key features**

- Recursive workspace scan — supports sub-folders
- Live search across titles and filenames
- Resizable / collapsible sidebar (mouse drag + keyboard arrows)
- GitHub-style dark theme
- GFM support: tables, task lists, strikethrough
- Syntax-highlighted fenced code blocks (Python, JS/TS, JSON, Bash, CSS, HTML, YAML, Markdown)

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Python | 3.11 |
| [uv](https://docs.astral.sh/uv/) | latest |
| Node.js | 18 |
| npm | 9 |

---

## Quick start

```bash
# 1 — clone / enter the project
cd markdown-previewer

# 2 — copy the example env file (edit as needed)
cp .env.example .env
```

**Terminal 1 — Backend**

```bash
cd markdown-previewer/backend
MARKDOWN_WORKSPACE=../workspace uv run uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Frontend dev server**

```bash
cd markdown-previewer/frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Tip:** The `workspace/` folder already contains two sample documents
> (`welcome.md` and `samples/code-demo.md`) so the app is usable immediately.

---

## Environment variables

| Variable | Where it is read | Default | Description |
|---|---|---|---|
| `MARKDOWN_WORKSPACE` | Backend (runtime) | `./workspace` | Absolute or relative path to the folder the server scans for Markdown files. Relative paths are resolved from the backend's working directory. |
| `VITE_API_BASE_URL` | Frontend (build time) | `http://localhost:8000` | Base URL the browser uses to call the backend API. Must be set before running `npm run build` for production deployments. |

---

## REST API reference

### `GET /api/documents`

Returns a sorted list of every Markdown file found in the workspace.

**Response** `200 OK`

```json
[
  {
    "id": "a3f1c2d4...",
    "filename": "welcome.md",
    "location": "welcome.md",
    "title": "Welcome",
    "created": "2026-07-11T22:08:00Z"
  },
  {
    "id": "b9e0d1f3...",
    "filename": "code-demo.md",
    "location": "samples/code-demo.md",
    "title": "Code Demo",
    "created": "2026-07-11T22:08:00Z"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `id` | string | SHA-1 of the POSIX-relative path. Stable across server restarts. |
| `filename` | string | Bare filename (e.g. `welcome.md`). |
| `location` | string | Relative POSIX path from workspace root. |
| `title` | string | First ATX heading, first non-empty line, or filename stem — in that order. |
| `created` | string | File creation time as UTC ISO-8601. |

---

### `GET /api/documents/{id}/content`

Returns the raw Markdown source for a single document.

**Response** `200 OK`

```json
{
  "id": "a3f1c2d4...",
  "content": "# Welcome\n\nWelcome to **Markdown Previewer** …"
}
```

**Response** `404 Not Found` — when `id` does not match any file in the workspace.

```json
{ "detail": "Document a3f1c2d4 not found" }
```

---

## Project structure

```
markdown-previewer/
├── .env.example                  # template — copy to .env and edit
├── README.md
├── workspace/                    # Markdown files served by the backend
│   ├── welcome.md
│   └── samples/
│       └── code-demo.md
│
├── backend/
│   ├── pyproject.toml            # uv project — FastAPI + uvicorn
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI app, CORS, two route handlers
│       └── scanner.py            # workspace scanner, ID generation, title extraction
│
└── frontend/
    ├── package.json              # Vite + React 18 + TypeScript
    ├── vite.config.ts            # manual chunk splitting, /api proxy
    ├── tsconfig.json             # strict mode + noUncheckedIndexedAccess
    ├── index.html
    └── src/
        ├── main.tsx              # React root
        ├── types.ts              # DocumentMeta, DocumentContent
        ├── api.ts                # fetch helpers
        ├── index.css             # design tokens (CSS custom properties)
        ├── App.tsx               # layout, drag-resize, data fetching
        ├── App.module.css
        └── components/
            ├── DocumentList.tsx        # searchable sidebar list
            ├── DocumentList.module.css
            ├── MarkdownViewer.tsx      # react-markdown + remark-gfm + rehype-highlight
            └── MarkdownViewer.module.css
```

---

## Development scripts

### Backend

```bash
# Install deps and start with hot-reload
cd markdown-previewer/backend
MARKDOWN_WORKSPACE=../workspace uv run uvicorn app.main:app --reload --port 8000

# Run tests (if added)
uv run pytest
```

### Frontend

```bash
cd markdown-previewer/frontend

npm run dev          # Vite dev server at http://localhost:5173
npm run build        # type-check + production bundle → dist/
npm run preview      # serve the production build locally
```

---

## Deployment notes

1. **Backend** — any ASGI host (Railway, Fly.io, Render) running `uvicorn app.main:app`.
   Set `MARKDOWN_WORKSPACE` to a persistent volume path.
2. **Frontend** — run `VITE_API_BASE_URL=https://your-backend.example.com npm run build`,
   then serve the `dist/` folder from any static host (Netlify, Vercel, GitHub Pages, nginx).
3. **CORS** — the backend currently allows all origins (`*`). Tighten this to your
   production frontend URL by setting `allow_origins` in `app/main.py`.
