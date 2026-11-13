# New and changed documents

Status: implemented (2026-11-13).

Agents regenerate specs and ADRs often, and a reviewer can't re-read a
whole folder to find what changed. Folio remembers which version of each
document the user last read, and shows which documents are new or changed
since.

## Decisions

| Question | Decision |
|---|---|
| What "read" records | The SHA-1 of the document's bytes, and the time. Not scroll position or how much was read |
| When a document counts as read | Shown for 3 seconds with the window focused and visible. Also **Mark as Read** in the document's context menu (desktop) |
| First run | The first time a workspace is listed, every document in it without a record is recorded as read at its current version (a baseline), so the list isn't all "new" on day one. The workspaces seen are kept, so this happens once per workspace |
| Where it's kept | `~/.folio/reads/`, beside `marks/`: it's the user's state, like marks. Not in the marks record, which is deleted once empty and drives re-linking |
| Live demo | The same rules, with records kept in the browser like the demo's marks |

## Model

```
~/.folio/
  reads/
    <record-id>.json        same id as marks: SHA-1 of the normalised real path
    workspaces.json         workspaces seen (real path → first seen), for the baseline
```

```json
{
  "version": 1,
  "path": "/Users/me/app/docs/adr/0003-event-store.md",
  "read": { "sha1": "…", "at": "2026-11-10T09:12:00Z" },
  "previous": { "sha1": "…", "at": "2026-11-03T16:40:00Z" },
  "baseline": false
}
```

- A document with no record is **new**: it appeared after the baseline.
  One whose current SHA-1 differs from `read.sha1` is **changed**.
- `baseline: true` marks a version recorded on first run, not actually read;
  the hover card says "Changed since Folio first saw it".
- `previous` is the read before, so **Mark as Unread** can go back one
  step: the document shows as changed again. With no read before, the
  record goes and the document shows as new. Reading the same version
  again keeps `previous` as it was.
- Records are written atomically (temp file, then rename), and changes run
  one at a time, as for marks (marks.md).

### The current version

`reads:list` scans the workspace and returns each document's current SHA-1
with its record. Hashes are cached by modification time and size, so a
listing reads only files that changed. The scanner itself reads only the
top of each file and stays as it was, so its output (and
`tests/fixtures/expected-scan.json`) doesn't change.

The renderer works out each document's state from that list. A document's
content comes with the SHA-1 of the version shown; **Mark as Read** sends
it, and the store refuses (409) when the file has changed on disk since, so
a version that wasn't shown is never recorded as read.

## UI

- **Document list**: a filled dot after the title for changed, a ring for
  new; the row's accessible name ends in "changed" or "new". Folders show
  how many documents under them are unread; the **Documents** tab shows the
  total in the focused folder ("Documents · 4").
- **Hover cards**: "Changed since you read it on 3 Nov", "Changed since
  Folio first saw it on 3 Nov" or "New since you last looked"; a folder's
  card adds "N unread".
- **Filter menu**: **Unread** under a **Read** heading, with its count, and
  an **Unread** chip while it's on. Remembered per workspace with the status
  and tag filters. The open document stays listed once it's read, so it
  doesn't vanish while being read.
- **Context menus** (desktop): **Mark as Read** or **Mark as Unread** on a
  document, **Mark All as Read** on a folder with unread documents.

## API

| Purpose | IPC |
|---|---|
| Each document's current SHA-1 and record | `reads:list` |
| Mark read (the SHA-1 of the version shown) | `reads:mark` |
| Go back one read | `reads:unmark` |
| Mark every document under a folder read | `reads:mark-folder` |

Every window is told with `reads:changed`. The demo's data source has the
same calls (`frontend/src/demo/reads.ts`).

## Implementation

- `packages/core/src/reads.ts`: `ReadsStore` and `hashFile`.
- `frontend/src/reads.ts`: a document's state and the words for it;
  `frontend/src/useReads.ts`: the records, kept up to date, and marking the
  shown document read.
