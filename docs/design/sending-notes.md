# Sending notes: sent and private notes, the Send dialog

Status: implemented (2026-11-11), released in 0.5.0; differences from the
design under As built. Replaces the preview of
[review-notes.md](review-notes.md) §5.

Two problems show up once review is a loop rather than a single copy:

- **Notes are sent twice.** The user copies notes, the agent revises, the
  user marks up the next revision and copies again. The second copy has the
  new notes and the old ones the agent already got, and nothing tells
  either of them apart. Copying only notes made after the document last
  changed misses notes made before a change some other instruction caused.
  Flagging every copied note as handled is wrong when the copied text is
  never pasted.
- **Not every mark is feedback.** Some highlights are reminders, or a
  passage to find again. Those shouldn't go to the agent, get states, or
  count as waiting for anyone.

The answer: a note says whether it was **sent**, the user decides at the
moment of sending, and **private** marks stay out of the loop. The copy
preview becomes a list to pick from, in place of raw Markdown.

## Decisions

| Question | Decision |
|---|---|
| How Folio knows a note was sent | The user says so: **Don't send these notes again** in the Send dialog (on by default, remembered) |
| What "sent" means | A state between open and addressed: the agent has it, no answer yet. Not "addressed", which is the agent's claim that it's done |
| Undoing a send | **Undo** in the toast after copying, **Mark not sent** on a note |
| Which marks are private | Highlights without a note, and notes the user locked (**Only me**). A note written on a bare highlight is feedback unless it's locked |
| What private means | Never copied, no state, never counted as waiting for anyone |
| Choosing intent | Never at creation. Making a mark works as before; intent is set by the lock or at sending |
| The Send dialog | A list of marks like the Marks view, with checkboxes; the exact Markdown in a **Text** tab |

## 1. States and privacy

A note gets a state and a privacy field (optional fields of the marks
record, [marks.md](marks.md) §2; see As built):

```json
{
  "id": "a1b2c3d4e5f60718",
  "note": "Where does 100 come from?",
  "state": "sent",
  "private": false,
  "…": "…"
}
```

- `state`: `open` → `sent` → `addressed` → `resolved`.
  - **open**: not sent yet (the default).
  - **sent**: copied with **Don't send these notes again**. The round that
    sent it lists its id.
  - **addressed**: the agent says it's done.
  - **resolved**: the user closed it.
- Moves back to **open**: **Reopen**, or **Mark not sent** (the note's
  popover).
- `private`: written only when the user chooses. Absent means: private if
  the highlight has no note, feedback if it has one. So:
  - a bare highlight is private;
  - writing a note on it makes it feedback, unless it's locked;
  - **Only me** (the lock) sets `private: true`; unlocking removes it;
  - **Send to agent** on a bare highlight sets `private: false`: it's sent
    as `(no comment)`, as [review-notes.md](review-notes.md) §1 did for
    every bare highlight.
- A private note keeps whatever state it had, but nothing shows or uses
  it. Making a sent note private doesn't unsend it; it just leaves the
  loop.
- The document note follows the same rules: the lock makes it private. A
  requested status change is always feedback.

## 2. How marks look

The highlight's colour belongs to the user, so state can't use colour. It
uses the margin icon's shape and the paint. What needs the user (unsent,
addressed) is loud; what's waiting (sent) or done (resolved) is quiet.

| | Margin icon | Highlight |
|---|---|---|
| Private | Plain note icon (none for a bare highlight) | As before |
| Open (unsent) | Solid note icon | Full paint |
| Sent | Outline note icon with a small arrow | Full paint, dashed underline |
| Addressed | Note icon with a check | Full paint |
| Resolved | Faded note icon | Lighter paint |

- Shapes differ, so the states read without colour and in both themes.
- With inline notes on ([inline-notes.md](inline-notes.md)), the same
  icon is shown beside each note in the text.
- **Popover**: a status line under the note, beside the lock:
  - Sent: "Sent · Nov 11, 10:02 · **Mark not sent**";
  - Addressed: "Addressed · **Resolve** / **Reopen**";
  - Open and private: nothing. A bare highlight's popover has **Send to
    agent**.
- **Marks view**: the state filter is Open · Sent · Addressed · Resolved ·
  Private, by default everything but Resolved (private marks are a
  reader's own, and stay listed). Each document row adds a summary of its
  feedback: "3 unsent · 2 sent · 1 addressed". Private marks count in the
  row's mark count, not in the summary.

## 3. The Send dialog

Replaces the preview panel ([review-notes.md](review-notes.md) §5). Same
entry points: the viewer header (the open document), a document row and
the button beside the filter in the Marks view (what the view shows). The
dialog only narrows what the entry point gave it, so filtering first is no
longer the way to choose.

```
┌ Send review notes ─────────────────────────────── [List | Text] ┐
│                                                                  │
│ ☑ Event store ADR                       docs/adr · 3 of 3        │
│   ☑ ▌"We will store events in Postgres, one table per…"          │
│        ✎ Why not a single events table? Explain the trade-off    │
│   ☑ ▌"Snapshots are taken every 100 events."                     │
│        ✎ Where does 100 come from?                               │
│   ☑ ◆ Document: change status to Accepted                        │
│                                                                  │
│ ◩ Setup guide                           docs/guides · 1 of 2     │
│   ☑ ▌"Run the installer as admin…"                               │
│        ✎ Check this on Windows                                   │
│   ☐ ▌"Proxy settings are read from…"              🔒 Only me      │
│        ✎ ask Dana about this                                      │
│                                                                  │
│ ▸ Sent before (2) · not included                                 │
│   1 not found in the current text · 4 private, not shown         │
│ ──────────────────────────────────────────────────────────────── │
│ ☑ Don't send these notes again          4 notes · 2 docs  [Copy] │
└──────────────────────────────────────────────────────────────────┘
```

### List

- **Grouped by document title**, in document tree order, notes in text
  order, as in the Marks view. The folder is shown dim beside the title;
  the full path on hover. Absolute paths appear only in the Text tab,
  where the agent needs them.
- **Rows are the Marks view's rows** (colour bar, quote up to two lines, the
  note) with a checkbox. The document note comes first in its group.
- **Ticked by default**: open (unsent) notes. A document's checkbox ticks
  or unticks all its notes and shows a partial state.
- **Unticking means "not this time"**: the note stays open and is ticked
  again next time.
- **🔒 Only me** on a row (on hover or focus) makes the note private: it
  leaves the list, the counts update, and the toast has **Undo**.
- **Sent before (n)**: sent notes with no answer yet, collapsed and
  unticked. Expand it to send one again, say when the agent skipped it.
  Addressed and resolved notes aren't listed; reopen them to send them
  again.
- **Not listed, counted**: private marks and notes not found in the current
  text. Each count opens the Marks view filtered to them.
- Clicking a row ticks or unticks it; **↗** on the row (hover or focus)
  closes the dialog and goes to the highlight.
- Keyboard: arrows move, Space ticks, `p` makes the note private, Enter
  copies, Escape closes.

### Text

The exact Markdown the agent gets ([review-notes.md](review-notes.md) §1),
read-only, built from the ticked notes. It keeps the old preview's purpose:
agents' chat boxes collapse what's pasted, so this is where the user can
see it. The dialog opens on the tab used last.

### Footer and copying

- **Don't send these notes again**: on by default, remembered. When on,
  copying sets the copied notes to **sent** and records the round; when
  off, it records the round and changes no states. Off is for copying to
  look at the text, or to paste somewhere that isn't the agent.
- The count, then **Copy**. After copying, a toast: "Sent 4 notes ·
  **Undo**". Undo sets them back to open and drops the round.
- With nothing ticked, **Copy** is disabled.

### The shortcut

**⇧⌘C** (direct copy, [review-notes.md](review-notes.md) §5) copies the
dialog's default selection, the open document's unsent notes, and follows
the remembered **Don't send these notes again**. With no unsent notes it
opens the dialog instead of copying nothing.

## As built (2026-11-11)

Released in 0.5.0, with these differences from the design above:

- **No new marks version.** `state`, `private` and `rounds` are optional
  fields of version 1 ([marks.md](marks.md) §2). A released app lists only
  records of its own version, so a version 2 would have hidden these marks
  from outdated installs, not made them read-only. The store keeps fields
  it doesn't know.
- **Rounds**: each copy records a round (the notes it sent, and the
  document version's SHA-1). Only the latest five are kept.
- **Nothing sets addressed yet.** That's the agent's claim, and there's no
  way for an agent to make it so far; the state, icon and filter are in
  place for it.
- **Resolve on a sent note**, besides Mark not sent: since nothing makes a
  note addressed, sent notes would otherwise collect forever.
- **"Sent · Nov 11, 10:02"** in the popover, not a round number: only the
  latest five rounds are kept, so a round number isn't stable.
- **The Marks view's filter** is one menu, as the document list's: a Show
  section (bookmarks, or highlights and notes) in place of **Notes only**,
  and the states, picked to narrow. With none picked, everything but
  resolved notes shows. Notes only also hid highlights without a note,
  which the Private state now covers.

## Later

- **Edit a note in the Send dialog.** Handy just before sending, and it
  edits the mark itself, so [review-notes.md](review-notes.md) §5's reason
  for a read-only preview (edits lost or stored separately) doesn't apply.
  Until then, ↗ goes to the note.
- A dot in the document list on documents with unsent notes, if the Marks
  view's summary isn't enough.
