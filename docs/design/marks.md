# Marks: highlights, notes and bookmarks — and folder focus

Status: implemented — phases 1–4 (folder focus; store + highlights; notes, bookmarks, Marks view; moved and deleted documents).

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
    <record-id>.json          one file per document that has marks;
                              record id = SHA-1 of the normalised real path
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
- **One file per document**, named by the SHA-1 of its normalised real path:
  small writes, a damaged file only loses one document's marks, and finding a
  document's record is one file read. Two processes sharing the folder can't
  create two records for the same file. (Re-linking a moved file, phase 4,
  writes the record under its new name.)
- **No index file.** Listing reads `marks/`; records are matched to scanned
  documents by location compared case- and NFC-insensitively, so names stored
  NFD on macOS still match.
- **Atomic writes**: write `<id>.<random>.tmp`, then rename over the record.
  Each change re-reads the record first (read–modify–write, serialised within
  a process), so the desktop app and a local backend sharing `~/.folio` rarely
  lose an edit.
- A damaged record is left untouched: changes to it are refused (409) and
  listing skips it.
- A record with no bookmarks and no highlights left is deleted.
- `fingerprint` is refreshed on every write and used only for re-linking.
- Unknown `version` → the record is left alone (read-only) rather than rewritten.
- **Sending notes** (sending-notes.md) adds optional fields, still
  version 1: a highlight's and the document note's `state` (`sent`,
  `addressed`, `resolved`; absent means open) and `private` (set only when
  the user chose), and the record's `rounds` (the latest five sends: id,
  time, `via`, the document's SHA-1, the highlight ids). Fields a version
  doesn't know are kept on every write, so an older install still shows and
  changes these records; a new version number would have hidden them
  (`marks:list` skips other versions).
- **Threads** add more optional fields, still version 1: a note's
  `author` (absent: the user; `agent` with a name, or `github` with a login),
  `replies` (oldest first, at most 100 of 10 000 characters, each with an
  id, author, text and time) and `seen` (when the user last saw the
  thread). A reply marked addressed sets the note to `addressed`; any other
  reply sets it back to open, so it goes with the next round. A round
  fetched by an agent has `via: "mcp"` and the agent's name in `client`.
  The document note keeps fields it doesn't know too.

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

A record whose `path` no longer exists isn't deleted. When the workspace's
marks are listed, records of missing files under the workspace are matched
against its documents that have no marks yet ("unmarked"):

1. Exactly one unmarked document with the same content (SHA-1 of its bytes;
   only documents of a size some missing file had are hashed) → re-linked
   automatically, whatever its name (moved or renamed, not edited). Two
   missing files with the same content are left to the user.
2. Exactly one unmarked document with the same file name (case-insensitive),
   and at least half of the record's highlighted passages (looked for in the
   source with Markdown punctuation and whitespace collapsed) and bookmarked
   headings found in it → offered as **Move to <location>**. A record with
   only a document bookmark has nothing to check, so the name decides.
3. Every missing record is listed under **Missing documents** with **Move
   to…** (a document picker: any document of the workspace) and **Delete**,
   which asks first. Not a file dialog, as first planned: it works in the
   browser too, and can't pick a file outside the workspace, where the marks
   wouldn't show.

Moving merges with the target's own marks (highlights by id, bookmarks by
heading). Records of files outside the workspace aren't listed, and a file
that exists but isn't listed (a skipped folder, beyond the depth limit) isn't
missing. Marks are never deleted without the user asking.

Fingerprints are taken from the file's bytes, not its decoded text: Python
reads text with Windows line endings converted, Node doesn't, so both stores
would otherwise disagree about a CRLF file.

## 3. API

REST (backend) and IPC (desktop) mirror each other, as for documents today.
Only records under the current workspace are visible.

| Purpose | REST | IPC |
|---|---|---|
| All marks in the workspace (badges, Marks view, missing records) | `GET /api/marks` | `marks:list` |
| Add a highlight | `POST /api/documents/{id}/highlights` | `marks:highlight-add` |
| Change colour / note | `PATCH /api/documents/{id}/highlights/{hid}` | `marks:highlight-update` |
| Delete a highlight | `DELETE /api/documents/{id}/highlights/{hid}` | `marks:highlight-delete` |
| Add a bookmark | `POST /api/documents/{id}/bookmarks` | `marks:bookmark-add` |
| Remove a bookmark | `DELETE /api/documents/{id}/bookmarks/{bid}` | `marks:bookmark-delete` |
| Move a missing file's marks (`{docId}`) | `POST /api/marks/{recordId}/relink` | `marks:relink` |
| Delete a missing file's marks | `DELETE /api/marks/{recordId}` | `marks:forget` |

`GET /api/marks` returns `{ documents: [{ docId, location, highlights }] }`
with `bookmarks` (phase 3) beside `highlights`; documents with either are
listed. Phase 4 adds `missing`: `[{ recordId, location, bookmarks,
highlights, suggestion: { docId, location } | null }]`; relink and delete
answer 404 for anything else than a missing file's record in the workspace. The frontend
loads all of it once, so there's no per-document endpoint.
A bookmark is added with `{"heading": null}` (the document) or `{"heading":
{text, level, occurrence}}` in the body — not as a key in the URL, since
heading text can contain anything — and adding an existing one returns it.
It's removed by its id.

- **Item-level changes**, never whole-record replacement, so two windows don't
  overwrite each other.
- **Validation** on the server: colour from the fixed set, note ≤ 10 000
  characters, `exact` 1–20 000 and prefix / suffix ≤ 64 characters, integer
  offsets with end > start, at most 1 000 highlights per document, ids
  (16 hex characters) generated server-side.
- **JSON only**: write endpoints refuse other content types (415), so a page
  on another site can't post without a CORS preflight.
- **Live updates**: desktop broadcasts `marks:changed` to every window (like
  `workspace:changed`); the browser refetches on window focus.
- **Parity**: a Python and a TypeScript store module, tested against shared
  fixture records, as the scanner is.

## 4. UI

### Creating and editing

- **Select text** → a small toolbar above the selection (below it at the top
  of the view): the **4 colour swatches** — one click highlights in that
  colour — **Add note** (highlights in the last colour and opens the note
  editor) and **Copy**.
- **Click a highlight** → popover: 4 colour swatches, Add / Edit note,
  Remove, and the note below (click it to edit). The editor saves with
  `⌘↩` / `Ctrl+Enter`, Save, or by clicking away; Escape cancels the edit.
- Highlights with a note show a note icon in the right margin, level with
  the highlight's last line (not after the text, which it would cover);
  hovering shows the note, clicking opens the popover.
- **Bookmark the document**: bookmark icon in the breadcrumb header.
  **Bookmark a heading**: icon that appears when hovering the heading.
- Shortcuts: `⌘⇧H` / `Ctrl+Shift+H` highlights the selection in the last
  colour picked (yellow at first); `⌘D` / `Ctrl+D` toggles the document
  bookmark. On desktop both are also in the Edit menu (Highlight Selection,
  Bookmark Document), which shows the keys but leaves them to the page.

Rendering: a new `annotation` layer in `searchHighlight.ts`, one
`::highlight()` per colour, painted under the `search` and `find` layers.
The Custom Highlight API creates no elements, so clicks are hit-tested
against the painted ranges' client rects, and note icons (phase 3) sit in an
overlay positioned from `range.getBoundingClientRect()`. The rendered text
that anchors refer to (`textModel.ts`) leaves out buttons, Mermaid diagrams,
KaTeX markup and anything marked `data-marks-skip`, so it doesn't change when
a diagram finishes drawing.

### In the document list

- Bookmarked document: bookmark icon at the row's end.
- Document with highlights: small count (`● 3`).
- Collapsed folder containing marks: one dim dot.

### Marks view

A **Documents | Marks** switch at the top of the sidebar, in place of its
title; the Documents view stays mounted while hidden, so its search and
folders are kept. It always lists the marks of every listed document (the
workspace, or the focused folder); the open document's marks are in its
outline instead of a "This document" scope, which made the header too
crowded to read.

```
[ Documents | Marks ]
[ Filter marks…                    ✎ ]
▾ Setup guide                    ★  3
    ★ Install
    ★ Troubleshooting
    ▌"Run the installer as admin…"
      ✎ Check this on Windows
▸ Release process                   5
  Changelog                      ★
MISSING DOCUMENTS (1)
▸ setup.md  docs/old                3
    [Move to docs/guides/setup.md] [Move to…] [Delete]
```

- **Grouped by document**, each listed once: its row shows the title, a ★
  when the document itself is bookmarked (click it to remove the bookmark)
  and how many marks are under it. Under it, heading bookmarks named by
  their heading (document order), then highlights and notes (text order).
  Naming bookmarks by the document title, as a flat Bookmarks section did,
  listed the same title several times without saying where each led.
- Clicking a document row opens the document (top) and unfolds it; its
  chevron folds or unfolds without opening. A document whose only mark is
  its own bookmark has no chevron.

- **Filter** matches quote and note text, heading text and document titles;
  the filter menu (the funnel beside it) picks kinds of marks (bookmarks, or
  highlights and notes) and note states (sending-notes.md); it
  replaced the earlier **Notes only** toggle.
- The open document's marks are tinted, and its highlights that can't be
  found in the current text are shown as such.
- Clicking an entry opens the document and scrolls to the mark; Back returns.
- Order: document tree order, then position in the document.
- The same keyboard navigation as the document list.

### Outline

The open document's marks: bookmarked headings show a bookmark icon, and
sections containing highlights a small count (counted from the highlights
found in the rendered text).

### Not in the first version

Tags, colour filters, sort options, margin notes, threaded replies. First
candidate afterwards: **Export marks as Markdown** (per document or all).

## 5. Folder focus

**Focus on Folder** (desktop and browser): the focus button shown when
hovering a folder row, a folder segment in the breadcrumb, or (desktop) the
folder row's context menu.

- Narrows the document list, title / heading / full-text search and the
  Marks view to that folder (filtered in the frontend; no API change).
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
