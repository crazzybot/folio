# Marks: highlights, notes and bookmarks — and folder focus

Status: design agreed. Phase 1 (folder focus) implemented; phases 2–4 not started.

Folio stays read-only: marks never touch workspace files. They live in a
separate data folder in the user's home, keyed so that the same file keeps its
marks whichever folder is opened as the workspace.

## Decisions

| Question | Decision |
|---|---|
| Bookmark granularity | Whole documents and headings only — not arbitrary positions |
| Highlight colours | 4 fixed colours: yellow (default), green, blue, pink |
| Self-hosted (Docker) | One shared volume; all users of a server share its marks |
| Data location | `~/.folio` on macOS and Linux, `%USERPROFILE%\.folio` on Windows |

## 1. Model

Two kinds of mark. A comment is a highlight with a note, as in Kindle or Apple
Books, so there is no third kind.

| Mark | Points at | Carries |
|---|---|---|
| **Bookmark** | a document, or a heading in it | created time |
| **Highlight** | a passage of rendered text | colour, optional note, created / updated times |

"Note" in the UI means a highlight with a note.

## 2. Storage

### Location

```
~/.folio/                     %USERPROFILE%\.folio on Windows
  marks/
    <record-id>.json          one file per document that has marks
```

- Desktop: `path.join(os.homedir(), ".folio")`. Not Electron's `userData`
  (where `settings.json` lives): marks are the user's own data, easy to find
  and back up.
- Backend: `MARKDOWN_DATA_DIR`, default `~/.folio`. Docker sets
  `MARKDOWN_DATA_DIR=/data` on a named volume; the workspace mount stays `:ro`.

### Record

```json
{
  "version": 1,
  "path": "/Users/alexei/notes/guides/setup.md",
  "fingerprint": { "sha1": "…", "size": 18342, "filename": "setup.md" },
  "bookmarks": [
    { "id": "…", "heading": null, "created": "2026-11-07T10:00:00Z" },
    { "id": "…", "heading": { "text": "Install", "level": 2, "occurrence": 0 }, "created": "…" }
  ],
  "highlights": [
    {
      "id": "…",
      "color": "yellow",
      "note": "Check this on Windows",
      "quote": { "exact": "…", "prefix": "≤32 chars before", "suffix": "≤32 chars after" },
      "position": { "start": 1234, "end": 1290 },
      "created": "…",
      "updated": "…"
    }
  ]
}
```

- **Keyed by absolute real path**, not by document id. `realpath` resolves
  symlinks; names are normalised to NFC (macOS file names can come back NFD);
  on macOS and Windows paths are compared case-insensitively. So opening
  `~/notes`, `~/notes/guides` or `~` all reach the same record. Document ids
  stay workspace-relative and are only used for routing.
- **One file per document**, with a random record id as its name: small
  writes, a damaged file only loses one document's marks, and a rename only
  rewrites `path`.
- **No index file.** The store reads `marks/` at startup and keeps a
  path → record map in memory, so nothing can drift out of sync.
- **Atomic writes**: write `<id>.json.tmp`, then rename over the record. Each
  change re-reads the record first (read–modify–write), so the desktop app and
  a local backend sharing `~/.folio` rarely lose an edit.
- A record with no bookmarks and no highlights left is deleted.
- `fingerprint` is refreshed on every write and used only for re-linking.
- Unknown `version` → the record is left alone (read-only) rather than rewritten.

### Anchoring highlights

Anchors are made against the **rendered text** (`textContent` of the document
element), not the Markdown source: selections come from the DOM, and
reformatting markup (`*x*` → `_x_`) doesn't move the text. All anchoring is
done in the frontend; the server stores anchors as opaque data.

Re-anchoring, in order:

1. **Position check** — text at `start..end` equals `exact` → done.
2. **Exact quote** — find every occurrence of `exact`; if several, pick the one
   whose surrounding text best matches `prefix` / `suffix`, ties broken by
   distance from `start`.
3. **Fuzzy** — approximate match near `start` (`diff-match-patch` `match_main`,
   bounded threshold); prefix / suffix must still roughly agree.
4. **Orphan** — not painted; listed under the document as "Not found in the
   current text" with the quote and note kept, and a Delete action.

Re-anchored highlights are not written back automatically; the stored
position is updated the next time the highlight is edited.

Heading bookmarks resolve by heading text + level, `occurrence` picking among
duplicates; a heading that no longer exists falls back to the top of the
document, marked as such in the Marks view.

### Re-linking moved or renamed documents

A record whose `path` no longer exists isn't deleted. When the workspace is
listed, missing records are matched against its documents:

1. Same content SHA-1 → re-linked automatically (moved, not edited).
2. Exactly one document with the same file name, and most of the record's
   quotes found in its text → offered to the user ("Move 4 marks to
   guides/setup.md?").
3. Otherwise listed under **Missing documents** with **Locate…** (desktop file
   dialog) and **Delete**.

Marks are never deleted without the user asking.

## 3. API

REST (backend) and IPC (desktop) mirror each other, as for documents today.
Only records under the current workspace are visible.

| Purpose | REST | IPC |
|---|---|---|
| All marks in the workspace (badges, Marks view, missing records) | `GET /api/marks` | `marks:list` |
| One document's marks | `GET /api/documents/{id}/marks` | `marks:get` |
| Add a highlight | `POST /api/documents/{id}/highlights` | `marks:highlight-add` |
| Change colour / note | `PATCH /api/documents/{id}/highlights/{hid}` | `marks:highlight-update` |
| Delete a highlight | `DELETE /api/documents/{id}/highlights/{hid}` | `marks:highlight-delete` |
| Add / remove a bookmark | `PUT` / `DELETE /api/documents/{id}/bookmarks/{key}` | `marks:bookmark-set` / `-delete` |
| Re-link a missing record | `POST /api/marks/{recordId}/relink` | `marks:relink` |
| Delete a missing record | `DELETE /api/marks/{recordId}` | `marks:delete` |

`GET /api/marks` returns `{ documents: [{ docId, location, bookmarks, highlights }], missing: [{ recordId, path, filename, bookmarks, highlights }] }`.
Bookmark `key` is `doc` or `h:<level>:<occurrence>:<text>` (URL-encoded).

- **Item-level changes**, never whole-record replacement, so two windows don't
  overwrite each other.
- **Validation** on the server: colour from the fixed set, note ≤ 10 000
  characters, quote parts bounded, ids generated server-side.
- **Live updates**: desktop broadcasts `marks:changed` to every window (like
  `workspace:changed`); the browser refetches on window focus.
- **Parity**: a Python and a TypeScript store module, tested against shared
  fixture records, as the scanner is.

## 4. UI

### Creating and editing

- **Select text** → a small toolbar above the selection: **Highlight · Add
  note · Copy**. Highlight uses the last colour picked; Add note highlights and
  opens the note editor.
- **Click a highlight** → popover: 4 colour swatches, the note (editable in
  place), Delete.
- Highlights with a note end in a small note icon; hovering it shows the note.
- **Bookmark the document**: bookmark icon in the breadcrumb header.
  **Bookmark a heading**: icon that appears when hovering the heading.
- Shortcuts (Edit menu on desktop): `⌘⇧H` / `Ctrl+Shift+H` highlight
  selection, `⌘D` / `Ctrl+D` toggle document bookmark.

Rendering: a new `annotation` layer in `searchHighlight.ts`, one
`::highlight()` per colour, painted under the `search` and `find` layers.
The Custom Highlight API creates no elements, so clicks are hit-tested with
`caretPositionFromPoint`, and note icons sit in an overlay positioned from
`range.getBoundingClientRect()`. Selections inside Mermaid diagrams and KaTeX
output are ignored.

### In the document list

- Bookmarked document: bookmark icon at the row's end.
- Document with highlights: small count (`● 3`).
- Collapsed folder containing marks: one dim dot.

### Marks view

A **Documents | Marks** switch at the top of the sidebar.

```
[ Documents | Marks ]
[ Filter marks…        ] [This document ▾]
BOOKMARKS
  ★ Setup guide
  ★ Setup guide › Install
HIGHLIGHTS & NOTES
  ▾ Setup guide                 3
     ▌"Run the installer as admin…"
       ✎ Check this on Windows
  ▸ Release process             5
MISSING DOCUMENTS (1)
  ▸ old-notes.md — Locate… · Delete
```

- **Scope**: This document / All documents (= the workspace, or the focused
  folder). Remembered; "This document" follows the open document.
- **Filter** matches quote and note text; a "Notes only" toggle is the only
  other filter.
- Clicking an entry opens the document and scrolls to the mark; Back returns.
- Order: document tree order, then position in the document.
- The same keyboard navigation as the document list.

### Outline

Sections containing highlights show a small count beside the heading.

### Not in the first version

Tags, colour filters, sort options, margin notes, threaded replies. First
candidate afterwards: **Export marks as Markdown** (per document or all).

## 5. Folder focus

**Focus on Folder** (desktop and browser): the focus button shown when
hovering a folder row, a folder segment in the breadcrumb, or (desktop) the
folder row's context menu.

- Narrows the document list, title / heading / full-text search and the Marks
  "All documents" scope to that folder (filtered in the frontend; no API
  change).
- The workspace doesn't change, so wiki links, images and document ids keep
  working.
- A bar above the search box shows `notes / guides ✕`; ✕ or Escape in the
  list clears it. The status bar shows "12 of 340 documents".
- Remembered per workspace in view-state.

**Open Folder as Workspace** (desktop only): same context menu; switches the
workspace like File → Open and adds it to Open Recent. Marks carry over
because they're keyed by real path.

## 6. Phases

1. **Folder focus** — no new data; useful on its own.
2. **Store + highlights** — Python and TS stores with shared fixtures, API,
   selection toolbar, painting, popover, list badges.
3. **Notes, bookmarks, Marks view, outline counts.**
4. **Re-linking and missing documents**; then Markdown export.

## 7. Testing

- Store: path normalisation (symlink, NFC, case), atomic write, empty-record
  removal, unknown version left alone, validation — same fixtures in pytest
  and vitest.
- Anchoring: unit tests on plain strings for each step — unchanged, edit
  before / inside / after the highlight, duplicate quotes, deleted passage
  (orphan).
- Cross-workspace: the same file listed from its folder and from a parent
  folder returns the same marks.
- Re-linking: move without edits (auto), rename with edits (offered), deleted
  (missing).
