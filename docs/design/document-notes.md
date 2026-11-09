# Document notes

Status: proposed.

A note on the document as a whole: an overall comment, and optionally a
request to change the document's status ("accept this ADR"). It goes into
Copy review notes ahead of the highlights, so the agent that wrote the
document makes the change.

Folio stays read-only (marks.md): it never edits the document, not even its
status. It asks; the agent edits; Folio sees the result.

Builds on marks.md (storage, API), review-notes.md (the copied text) and
frontmatter-metadata.md (statuses).

## Decisions

| Question | Decision |
|---|---|
| How many per document | One. Point-by-point feedback belongs on highlights; this is the overall verdict |
| What it holds | Text (Markdown), and/or a requested status. Nothing else structured: tags, "superseded by" and the like are asked for in the text |
| Statuses offered | The known statuses, those used in the workspace, or any word typed in |
| When a request is done | When the document's status is the requested one — read from the document, not stored |
| Record format | An optional field in today's version 1 record, not a new version (section 1) |
| In the copy | First in its document's part: the status change (with where the status is written), then the comment, then the numbered highlights |

## 1. Model

```json
{
  "version": 1,
  "path": "…",
  "bookmarks": [],
  "highlights": [],
  "documentNote": {
    "text": "Fine once the rotation question is answered.",
    "requestedStatus": "accepted",
    "created": "2026-11-09T10:00:00Z",
    "updated": "2026-11-09T10:05:00Z"
  }
}
```

- `text`: Markdown, ≤ 10 000 characters (as a highlight's note), or null.
- `requestedStatus`: one word as the user picked or typed it, trimmed, ≤ 40
  characters, or null. Compared with the document's `meta.status` by its
  first word, lowercased — the same normalisation as the scanners'.
- A note with neither is removed. A record with no highlights, bookmarks or
  note is removed (today: no highlights or bookmarks).

### Compatibility

Records stay at version 1, with `documentNote` optional. Bumping the
version would make older apps hide every mark of such a document (they skip
other versions) and refuse to change them (409).

Apps before this one rebuild a record from the fields they know when they
change it, so **they drop a document's note** when they add or remove a
mark on that document, delete the record with its last highlight or
bookmark, and move only highlights and bookmarks when relinking. Accepted
as rare — two app versions on one marks folder (say, an old Docker backend
beside the desktop app, which updates itself) — rather than hiding every
mark of a noted document from older apps.

From this version on, both stores keep fields they don't know when they
rewrite a record, so later additions won't have the problem.

## 2. API

| Purpose | REST | IPC |
|---|---|---|
| Set the document's note | `PUT /api/documents/{id}/note` | `marks:note-set` |
| Remove it | `DELETE /api/documents/{id}/note` | `marks:note-delete` |

- `PUT` takes `{ "text": string | null, "requestedStatus": string | null }`
  and returns the saved note; both null removes it (as `DELETE`).
  `created` is kept across updates.
- `GET /api/marks`: each document gains `note` (the note, or absent), and a
  document with only a note is listed. Missing files' records carry `note`
  too.
- Relink: a moved note becomes the target's note; if the target already has
  one, its requested status is kept (the moved one fills it only when
  empty) and the moved text is appended after a blank line.
- Validation, JSON-only writes and `marks:changed` as for other marks;
  shared fixture records for both stores.

## 3. Where the status is written

For the copy to say exactly what to change, the scanners report where they
found the status:

```ts
meta.statusLine: number | null   // 1-based line in the source: front matter `status:`,
                                 // the "Status:" line, or the Status section's first line
```

Both scanners, with the cases in `tests/fixtures/meta-cases.json`. The
front end checks the source for front matter itself (the existing pattern),
to word a request for a document without a status yet.

## 4. In the copied review notes

One document:

````markdown
Review notes on 0003-hmac-signatures.md. My overall comment comes first, then
each quote from the document followed by my comment. Please revise the
document to address them.

Status: change it to "accepted". It is "proposed" now, on line 3:
`Status: proposed · 2026-10-02`.

Overall: Fine once the rotation question below is answered.

1. /Users/me/relay/docs/adr/0003-hmac-signatures.md:24 · Consequences
   > anyone forge deliveries to that endpoint until it's rotated

   How long does a rotation take a tenant today?
````

- **Status line**, by where the status is written:
  - front matter: `…on line 2: \`status: proposed\`.`
  - a `Status:` line or `## Status` section: its line, quoted as above;
  - none yet, with front matter: `Add \`status: accepted\` to its front matter.`
  - none yet, without: `Add a \`Status: accepted\` line under its title.`
- **Overall**: the text as written; lines after the first are kept as they
  are, below it.
- A request already done (the document has that status) is left out, and
  the preview says so: "1 status change already made, left out".
- **Several documents**: under each `## path` heading, its status line and
  comment come before its notes; numbering across documents is unchanged.
- **Opening line**: the default names what comes: "My overall comment comes
  first, then each quote…" with a note, and "…to address my comment" with a
  note and no highlights. A custom opening line (Settings) is used as it is.
- A document with a note and no highlights can be copied.
- The path isn't repeated before the status line: with one document the
  opening line names the file and every numbered note has the full path;
  with several, the `## path` heading does.

## 5. UI

### Writing it

- **Toolbar**: a "Note on document" button beside the bookmark, filled when
  the document has a note. It opens a popover under it:
  - **Status**: a select — "No change (now proposed)", the known statuses,
    others used in the workspace, and "Other…" (a text field); the chosen
    status's glyph shows beside it (a native select can't show icons), and
    the document's current status isn't offered as a change;
  - **Comment**: a text area, as the highlight note editor (⌘↩ / Ctrl+Enter
    saves, Esc cancels);
  - Save, and Remove when there's a note. Clicking elsewhere saves what
    changed, as a highlight's note does; pressing the toolbar button again
    does the same.
- The document header (metadata strip) shows the note's request and the
  start of its comment, with an Edit link that opens the popover. A
  document without metadata gets the strip when it has a note.

### Showing it

- **Header**: a line under the metadata — the note icon, `→ ✓ Accepted`
  and the comment's first line, muted. Done: `✓ Now accepted · Clear
  request`; clearing a request leaves the comment (a note with neither is
  removed).
- **Marks view**: a "Note" row first under its document — the request and
  the comment's first line; its hover card shows the comment in full.
  Notes only includes it; the filter matches its text. The document's copy
  button counts it.
- **Hover card** (document list and Marks view): "Your note: → Accepted"
  and the comment's first line.
- **Missing files**: a note shows among the file's marks and moves with
  them.

Not in this version: a marker on the list row for a pending request (to see
whether the header and Marks view are enough first).

## 6. Phases

1. **Store and API**: the field in both stores, set / delete, listing,
   relink, removal rules, shared fixtures.
2. **Editor and display**: toolbar button and popover, header, Marks view,
   hover cards.
3. **Copy**: `meta.statusLine` in both scanners, the status line and
   overall comment in review notes, done requests left out, opening lines.

## 7. Testing

- Stores: set, update (created kept), clear both fields (removed), record
  with only a note kept and listed, last highlight removed with a note
  (record kept), relink with and without a note on the target, validation
  limits — same fixtures in pytest and vitest.
- Scanners: `statusLine` for front matter, a status line, a `## Status`
  section, none.
- Review notes: each status-line wording, a done request left out, note
  without highlights, several documents, custom opening line, multi-line
  comment.
- Editor: current status not offered, "Other…" word, Remove.

## Later

- Other structured requests (tags, superseded by), if the text proves too
  loose for agents.
- A note's history across review rounds (review-notes.md, "Later").
