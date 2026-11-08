# Copy review notes

Status: implemented (phases 1–4).

Turns a document's highlights and notes into Markdown that can be pasted
straight into a coding agent (Claude Code, Cursor, …) as review feedback.
It completes the review flow Folio is pitched for: read the spec, mark it up,
send the notes back to the agent that wrote it, read the next revision.

This is the "Export marks as Markdown" step that marks.md left for later,
shaped for an agent as the reader rather than for the user's own records.

**This first version is copy-only and stateless.** Copying reads the marks
and changes nothing: no record of what was sent or when, and no link to a
commit or a version of the document. Review rounds, with history, diffs and
resolved notes, are a separate and much larger feature (see the end), and a
candidate for a paid tier. Keeping them out is what keeps this one small.

## Decisions

| Question | Decision |
|---|---|
| What's copied | Highlights, with or without a note, in document order. A highlight without a note still matters to the user, so it's copied as `(no comment)`. Not bookmarks: they're for finding your way around, not feedback |
| Where each one is | File path, line number in the source and section, so the agent can go straight to it |
| Path | Absolute in the desktop app, so it's unambiguous wherever the agent runs. Workspace-relative in the browser version |
| Destination | The clipboard. No file, no direct integration with an agent |
| Feedback that's out of date | Highlights not found in the current text are left out, and the preview says how many |
| Instructions to the agent | A short opening line, editable in Settings (empty leaves it out) |
| Preview | A read-only panel with the exact text, before copying. The shortcut copies without it |
| What copying changes | Nothing: marks stay as they are, and nothing about the copy is stored (section 4) |

## 1. Output

One document:

````markdown
Review notes on 0003-event-store.md. Each quote is from the document,
followed by my comment. Please revise the document to address them.

1. /Users/me/projects/app/docs/adr/0003-event-store.md:42 · Decision
   > We will store events in Postgres, one table per aggregate.

   Why not a single events table with an `aggregate_type` column? Explain
   the trade-off.

2. /Users/me/projects/app/docs/adr/0003-event-store.md:57-59 · Decision › Consequences
   > Snapshots are taken every 100 events.

   Where does 100 come from?

3. /Users/me/projects/app/docs/adr/0003-event-store.md:88 · Alternatives considered
   > EventStoreDB was rejected for operational cost.

   (no comment)
````

Several documents: the same opening line ("Review notes on 3 documents."),
then a `## <path>` heading for each document, with notes numbered across all
of them so "note 5" means the same thing to the user and the agent.

- **Location line**: `path:line` (or `path:start-end` when the quote spans
  lines) is the form agents and editors already understand. After `·` comes
  the section: the chain of headings above the passage, joined with `›`. If
  the passage can't be found in the source (section 2), the line number is
  left out and only the path and section remain.
- **Quote**: a blockquote, with each line of the quote prefixed. Quotes over
  400 characters are shortened to their first and last 150, joined with
  `…`. The line number shows where the full passage is.
- **Note**: written as it is, since notes are Markdown, indented to stay
  inside the list item. A highlight without a note gets
  `(no comment)`. Whatever the colour meant to the user means
  nothing to the agent, so colours are left out.
- **Opening line**: the default above. Under **Settings → Review notes**, a
  switch leaves it out, and **Instructions** replaces its wording (empty for
  the default). `{documents}` is replaced with
  the file name, or "3 documents"; the full path is on every note. Leave it empty to start with the first note.

## 2. Finding the line and section

Highlights are anchored to the **rendered** text (marks.md §2), but the agent
works with the **source**. So the line number comes from searching the
document's source for the quote. This uses the same idea as relinking moved
documents in `marks.ts` (`plain()`: Markdown punctuation and whitespace
collapsed), but keeps a map from each character of the collapsed text back
to its offset in the source:

1. Collapse the source and the quote. Find every occurrence of the quote.
2. If there are several, pick the one whose surrounding text best matches the
   highlight's `prefix` and `suffix`, breaking ties by how close its relative
   position is to the highlight's `position.start` within the rendered text.
   This mirrors re-anchoring step 2.
3. Map the match's start and end back to source offsets, then to 1-based
   line numbers.
4. **Section**: the ATX (`#`) and setext headings in the source before that
   line, skipping fenced code blocks. Each heading closes deeper ones, which
   gives the chain, e.g. `Decision › Consequences`. Inline markup is
   stripped from the heading text.

If there's no match, the line number and section are left out and the quote
and note are kept. This happens when the quote spans table cells, a link's
URL sits between its words, or the text comes from HTML. The quote is enough
for the agent to search for.

This works for every document from its source alone, so documents that aren't
open (copying from the Marks view) need no rendering. It's a pure function
(`reviewNotes.ts`: `locateInSource`, `formatReviewNotes`) tested on strings,
like `anchoring.ts`.

**Out-of-date highlights.** For the open document, the viewer already knows
which highlights it couldn't place (`located`). Those are left out, and the
preview (or the status-bar message) says so. For other documents a quote that isn't found in the
source can't be told apart from a markup mismatch, so it's kept without a
line number.

## 3. Path

**Desktop: the absolute path.** The workspace isn't always the repository the
agent runs in. It may be a parent folder such as `~/projects`, a repo's
`docs/` folder, or one package of a monorepo, while the IDE has several
repositories open. Any relative path would have to guess the agent's working
folder and would sometimes be wrong. An absolute path is never ambiguous, and
Claude Code and Cursor open it directly. Finding the repository root isn't
needed, and neither is a new API: the frontend joins the workspace path it
already has (`workspacePath`) with the document's `location`, using the
platform's separator.

**Browser: the workspace-relative `location`.** The server's absolute paths
mean nothing on the reader's machine, and it shouldn't reveal them.

The cost: an absolute path shows the user's home folder in the pasted text.
That's fine for a local agent, but worth knowing before pasting into a shared
chat. A setting to choose relative paths can come later if people ask.

## 4. Stateless by design

Questions that come up as soon as notes are sent, and the answer in this
version:

- **What happens to the marks after copying?** Nothing. Copying is like a
  code block's Copy button. After the agent revises the document, highlights
  re-anchor as usual (marks.md §2). Passages the agent rewrote or removed
  show as *not found in the current text* in the Marks view, where the user
  deletes them as today. That doubles as a rough "addressed" signal for free
  (tried on this document: a note on the UI section showed as not found once
  the section was rewritten). It's only rough: *not found* means the passage
  changed, not that the note was dealt with. A reworded sentence whose note
  was ignored shows as not found, and a note addressed in another section
  stays placed. The user still reads the revision; a diff per round (Later)
  would show what changed under each note.
- **Only the marks added since the last copy?** No, there's no "last copy".
  It copies what the user chooses: one document, or what the Marks view
  shows. To send a subset, filter first.
- **Record when the document was read, or against which commit?** Not here.
  That's "changed since I last read it" (product-direction.md, gap 1), which
  needs snapshots or commits, and diffs.
- **Which repository is the path relative to?** None (section 3).

Each of these is a reasonable question for review rounds, and they're
answered together there (Later). Answering any one of them here would bring
in stored state, and the rest would follow.

## 5. UI

### Entry points

Each one opens the preview (below) with its notes:

- **Viewer header**: a **Copy review notes** button beside the bookmark
  button, shown when the open document has highlights. It shows the open
  document's notes.
- **Marks view**:
  - A copy button on each document row (on hover or keyboard focus) shows
    that document's notes.
  - **Copy all** in the filter row shows **what the view shows**: the
    focused folder, the filter and **Notes only** all apply. This is how to
    send a selection: filter it, then copy.
  - Missing documents are never included.
  - With nothing to copy (everything filtered out), the button is disabled.
- **Desktop**: **Edit → Copy Review Notes** (`⇧⌘C` / `Ctrl+Shift+C`)
  copies the open document's notes **straight away, without the preview**,
  for when the output is trusted. This shortcut is free in the menus and
  matches `⇧⌘H` (highlight) and `⇧⌘F` (search document text). DevTools'
  element picker uses it only while DevTools has focus.
- **Browser**: the same shortcut, handled by the page. Browsers whose
  DevTools use it (Chrome, Firefox) may take it first; the header button
  always works.

### Preview

Agents' chat boxes hide what's pasted (Claude Code collapses it to
`[Pasted text #1 +40 lines]`), so the preview is the only place the user
sees what the agent gets. It also explains the format the first time.

```
┌ Review notes · 0003-event-store.md ─────────────────────────────┐
│ 4 notes · 1 without a line number · 1 out of date, left out    │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Review notes on 0003-event-store.md. Each quote is from    │ │
│ │ the document, followed by my comment. Please revise …      │ │
│ │                                                            │ │
│ │ 1. /Users/me/projects/app/docs/adr/0003-event-store.md:42  │ │
│ │    · Decision                                              │ │
│ │    > We will store events in Postgres, one table per …     │ │
│ │ …                                                          │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                        [Cancel]  [Copy]        │
└────────────────────────────────────────────────────────────────┘
```

- **A modal panel** over the viewer, like the Settings panel.
- **The summary line** counts the notes, the notes without a line number,
  and the out-of-date notes left out. This takes the place of a status-bar
  message that would be gone in two seconds. Clicking "1 out of date" opens
  the Marks view at that document, where those notes are listed.
- **The exact text that will be pasted**, as raw Markdown in monospace, not
  rendered: the raw text is what the agent reads, and the user should see
  that. It scrolls when long.
- **Read-only.** Editing the text here would make it differ from the marks,
  and the edits would be lost or would have to be stored (section 4). To
  change a note, close the panel and edit the note. Clicking a note in the
  preview closes the panel and goes to its highlight.
- **Copy** has focus: Enter copies and closes the panel, and the button's
  icon briefly turns into a check first, as code blocks' Copy button does.
  Escape or **Cancel** closes the panel without copying.
- **No options.** What's copied is decided by where the preview was opened
  from and by the Marks view's filter. Options (leaving out highlights
  without notes, relative paths) can come later if people ask for them.

The shortcut's direct copy confirms with a short status-bar message
instead: "Copied 4 notes on 0003-event-store.md", plus "· 1 out of date,
left out" when anything was left out.

`formatReviewNotes` returns the text and, for each note, its highlight id
and the range of output lines it fills. The preview needs these to make each
note clickable, and the summary line needs the counts.

### Clipboard in the browser

`navigator.clipboard` needs a secure context (HTTPS or `localhost`). A
self-hosted server on plain HTTP doesn't have one. There, **Copy** selects
all the text in the preview and says "Press ⌘C to copy" (`Ctrl+C` on
Windows and Linux), so no separate dialog is needed. With no secure
context, the shortcut opens the preview instead of copying directly. The
desktop app uses `navigator.clipboard` too: its pages may write to the
clipboard (as code blocks' Copy does), so it always works there.

## 6. Phases

1. `reviewNotes.ts`: locate in source, format, and tests on strings.
2. Preview panel, viewer header button, Edit menu item with direct copy,
   browser fallback.
3. Marks view: copy per document and Copy all.
4. Settings: the opening line.

Phases 1–2 alone are enough to ship and demo the full flow. All of it is
frontend and desktop menu work: no store, API or backend changes.

## 7. Testing

- Locating: a quote on one line or across lines; duplicates told apart by
  prefix and suffix; emphasis, code spans and links inside the quote; a
  heading-like line inside a code fence that isn't a section; setext
  headings; not found (table cells, HTML).
- Formatting: notes numbered across documents, multi-line quotes and notes
  indented correctly, long quotes shortened, a highlight without a note,
  no opening line when it's empty.
- Paths: absolute on macOS, Linux and Windows (separators, a drive letter);
  workspace-relative in the browser.
- Copying changes nothing: the marks are the same before and after.
- Preview: the line ranges of each note match the text, so clicking a note
  goes to the right highlight; the summary counts match what's copied.
- Round trip, by hand: paste the output into Claude Code and Cursor and check
  that they find and address every note.

## Later: review rounds

The stateful workflow around copying, and a candidate for a paid tier: it's
real ongoing work, and it matters most to people who review agent output
every day. Designed together, since each part depends on the others:

- **Rounds**: what was sent and when, with the document's version (content
  hash, or the commit when the file is in a repository).
- **Changes since the last round**: a diff of the revised document, together
  with "changed since I last read it" (product-direction.md, gap 1).
- **Note status**: open, sent, addressed, with addressed notes archived
  rather than deleted. Copy only the notes not sent yet.
- **Shared marks** across a team, later still.

Free and independent of rounds:

- **Remove all not-found marks of a document**: one action on the document
  in the Marks view (asking first) instead of ✕ on each. After an agent's
  revision there are often several.
- **Note before quote for not-found marks**: in a not-found entry, show the
  note first and the struck-through quote under it. The note is what the
  user checks against the new text; the old quote is only context.
- **Copy for a pull request**: GitHub suggestion or review-comment format.
- **Send directly** to an agent (for example a Claude Code session) rather
  than through the clipboard.
