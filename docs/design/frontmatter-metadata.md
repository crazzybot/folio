# Front matter metadata, document numbers and the document list

Status: proposed.

ADRs, specs and notes often carry metadata in their front matter (`status`,
`date`, `tags`…), and numbered documents are known by their number ("ADR
015"). Today Folio reads only `title:` and hides the rest, and the number is
only visible in the hover tooltip. This design shows both, lets the list be
filtered by status and tags, and tidies the list rows to make room.

## Decisions

| Question | Decision |
|---|---|
| Where metadata is read from | YAML front matter; for the status only, the document's first section when the front matter has no `status` |
| Which fields | `status`, `tags`, `date`, decision makers — not arbitrary keys |
| Status in the sidebar | Replaces the Markdown icon with a status glyph (shape + colour) — no pill |
| Tags in the sidebar | On the selected row and in the hover card only — never on every row |
| Status vs tags | Kept visually distinct: status is a glyph + word, tags are `#tag` text |
| Filename in the list | Only its leading number, as a column before the title |
| Filtering | By status and tags, in the first version |
| Folder hints | Removed: no single-document folder collapse in the tree, no hint in the flat list |
| Tooltip | A custom hover card replaces the native `title` tooltip on list rows |

## 1. Metadata

### Fields

Front matter follows [MADR](https://adr.github.io/madr/) where it overlaps
(MADR 3 and 4 keep their metadata in front matter):

```yaml
---
title: Postgres for the delivery queue
status: superseded by ADR-0005
date: 2026-08-12
decision-makers: [Ana, Ben]
tags: [queue, postgres]
---
```

| Key | Read as |
|---|---|
| `status` | Its first word, lowercased, is the status (`superseded by ADR-0005` → `superseded`). The whole value is kept as `statusDetail` when it says more than that word. |
| `tags`, or Obsidian's `tag` | List of tags: lowercased, leading `#` removed, duplicates dropped; at most 20, each at most 40 characters. |
| `date` | String, as written. Shown as is; it is not `created` (the file's creation time). |
| `decision-makers`, or MADR 3's `deciders` | List of names, as written. |

Known statuses, in MADR's order: `proposed`, `accepted`, `rejected`,
`deprecated`, `superseded`. Any other value (`draft`, `wip`…) is kept as it is
and shown as an unknown status — it is not mapped onto a known one.

### Parsing

A small parser for the forms these keys are written in, not a YAML library:
it has to behave the same in the desktop scanner (TS) and the backend scanner
(Python), and a few dozen lines of shared rules are easier to keep in step
than two YAML libraries.

- Only top-level keys (no indentation) of the front matter the scanners
  already find (`FRONT_MATTER` in `scanner.ts`, `_FRONT_MATTER` in
  `scanner.py`).
- Scalars: surrounding quotes removed; an unquoted ` # comment` removed.
- Lists: flow (`[a, "b c"]`), comma-separated (`a, b`) or a block list
  (`- a` lines under a key with no value).
- Anything else (nested maps, multi-line strings) is ignored for that key.
  A document whose front matter can't be read keeps working exactly as
  today.

`splitFrontMatter` grows into returning the parsed fields as well as `title`
and `body`.

### Status in the first section

Many documents write their status in the text rather than in front matter —
this design doc, `marks.md`, the demo ADRs, MADR 2 and adr-tools. When the
front matter has no `status` (or there is no front matter), the status is
looked up in the document's first section:

- **The lead:** the text after the front matter up to the first heading
  below the title (the title being the first heading, when the document
  starts with one).
- **A `Status` section:** when that first heading below the title reads
  `Status` (adr-tools, Nygard), its first paragraph is the value.

In the lead, a line counts when it is `Status:` followed by a value, case
insensitive, optionally as a list item or in bold:

```markdown
Status: accepted · 2026-08-12
* Status: proposed
**Status:** superseded by [ADR-0005](0005-kafka.md)
```

The value is read like front matter's `status`: its first word, lowercased
and without trailing punctuation, is the status (`proposed.` → `proposed`);
the whole value is `statusDetail` when it says more. Lines in fenced code
blocks don't count, and only the first match is used.

Only the status is read from the body. `date`, decision makers and tags come
from front matter only — a `Date:` line or a `Tags:` bullet is left alone.

The body status is shown in the document header too, although the text says
it right below: the header is where it is clickable to filter, and it looks
the same whichever way a document writes its status.

### API

`DocumentMeta` gains an optional field, documented with the others in
README's `GET /api/documents`:

```ts
meta?: {
  status: string | null;        // "accepted", "superseded", "draft"…
  statusDetail: string | null;  // "superseded by ADR-0005"; null when it is just the status
  date: string | null;
  people: string[];             // decision-makers / deciders
  tags: string[];
}
```

`meta` is left out when the document has none of these fields, so plain
workspaces don't grow their listing.

## 2. Document numbers

A document is **numbered** when its filename stem starts with a number:

```
^(?:[A-Za-z]{2,5}[-_ ]?)?(\d+)(?=[-_. ]|$)
```

`0015-hmac.md` → `0015`, `ADR-015-hmac.md` → `015`, `01-intro.md` → `01`.
Not numbered: date-prefixed names (`2026-11-09-notes.md`, the stem starts
with `\d{4}-\d{2}-\d{2}`) and single-letter prefixes (`v2-api.md`).

Worked out in the frontend from `filename`; no scanner or API change.

- **Number column.** The digits, exactly as written, in a muted monospace
  face between the icon and the title. The column is as wide as the longest
  number among its siblings (one folder in the tree; the whole list when
  flat), so titles line up.
- **Title dedupe.** When the title starts with the same number (compared as
  integers), that prefix is hidden in the row: `ADR 0001: Postgres…`,
  `1. Record decisions`, `01 — MSP/HIBC Billing…`. The pattern is an optional
  2–5 letter word, the number, then `:` `.` `-` `–` or `—` and spaces. A
  title that is only the number is left alone. The tab, breadcrumb, document
  header and search keep the full title.
- Ordering needs no change: the tree already sorts numbers naturally.
- Search already matches filenames, so typing `0015` or `15` finds the
  document.

## 3. The document list

### Rows

```
 ✓ 0001  Postgres for the delivery queue      ● 3
 ◐ 0002  At-least-once delivery                 🔖
 ↷ 0003  HMAC signatures                              ← title dimmed
 ⓜ       README
```

A row is: status glyph or Markdown icon · number · title · markers (match
count, bookmark, highlights), as today on the right.

**Status glyph.** For a document with a status, the glyph takes the Markdown
icon's place — the icon is the same on every row, so it costs 22px and says
nothing. Shape and colour both carry the status, so it doesn't rely on colour
alone:

| Status | Glyph | Colour | Title |
|---|---|---|---|
| proposed | half-filled circle | accent | normal |
| accepted | check in a circle | green | normal |
| rejected | cross | muted | dimmed |
| deprecated | dash | muted | dimmed |
| superseded | curved arrow | muted | dimmed |
| anything else | hollow circle | muted | normal |

Clicking the glyph adds that status to the filters (section 4). The status
glyph is on the left and the marks on the right, so the status never sits
beside the yellow highlight dot.

**Width.** At the default 260px sidebar: 32px padding, 22px icon, ~34px for a
four-digit number and ~26px for highlights leave the title ~150px (22–25
characters). The title dedupe usually gives back more than the number column
takes (`ADR 0001: ` is ~70px). Below ~200px a container query reduces the
highlights marker to its dot, without the count; the number never hides.

**Selected row.** Shows the document's tags on a second line in small muted
text (`#queue  #postgres`), ending in `+2` when they don't fit. Clicking a tag
adds it to the filters. Other rows stay one line; their tags are in the hover
card.

**aria-label.** Gains the status and tags:
`Postgres for the delivery queue — docs/adr/0001-postgres.md — accepted — tags queue, postgres — 3 highlights`.

### Folder tree: no single-document collapse

`documentTree.ts` stops replacing a folder that holds one document with that
document plus a folder hint ("README  core / src"). It was confusing: the
document didn't appear where the folder is. A document always sits under its
own folder now, at the cost of one more row and one more indent level for
such folders.

Kept, because they hide nothing:

- a chain of folders with nothing else in them merges into one row
  (`api / v2 / endpoints`);
- when everything sits inside one folder, its contents are the top level.

### Flat list and search results: no folder hint

The folder hint beside the title is removed. In a sidebar of normal width it
was cut down to `a…`, and it took width from titles that are already
truncated. The folder is in the hover card, and for the open document in the
breadcrumb.

### Hover card

A custom tooltip replaces the native `title` tooltip on document and folder
rows (the `title` attributes are removed, so the two never show together).
The native one is one line of plain text, with a slow delay Folio can't set,
and can't show a status glyph or tags.

```
┌──────────────────────────────────────────┐
│ App Gateway Service — Claude Code Setup  │  full title, wrapped, never truncated
│ app-gateway/docs/0015-claude-setup.md    │  location, monospace
│                                          │
│ ↷ Superseded by ADR-0021 · 2026-08-12    │  status (detail when there is one), date
│ Ana, Ben                                 │  decision makers
│ #gateway  #auth  #onboarding             │  tags
│ 🔖 Bookmarked · ● 3 highlights            │  marks
└──────────────────────────────────────────┘
```

Sections without data are left out: a plain note shows its title and
location. A folder row shows its path and `12 documents · 3 with highlights`.

- **Placement:** beside the row, outside the sidebar (over the document),
  kept inside the window. Rendered in a portal so the list's
  `overflow: hidden` doesn't clip it. (The sidebar is always on the left;
  should it ever move, the card moves to its other side.)
- **Timing:** appears after 500ms over a row; once one is showing, moving to
  another row swaps it at once (as macOS tooltips do). Hidden on pointer
  leaving the list, scroll, click or a key press.
- **Keyboard:** the row focused with the arrow keys gets the card after the
  same delay.
- **Not interactive:** `pointer-events: none`, nothing in it to click, so it
  can't take focus or get stuck open.
- **Accessibility:** the card is `aria-hidden`; screen readers get the same
  information from the row's `aria-label`.

## 4. Filtering

**State:** `{ statuses: Set<string>; tags: Set<string> }`, applied in `App`
right after folder focus:

```ts
const listedDocuments = filterByMeta(documentsInFolder(documents, focus), filters);
```

So the tree, flat list, title / heading / full-text search and the status bar
count ("12 of 340 documents") all follow it without changes of their own.

**Matching:** any of the chosen statuses, and any of the chosen tags; status
and tags combine with *and*. Filters, folder focus and the search query all
narrow together.

**Filter button.** A funnel button beside the group-by-folder toggle, shown
only when some document in the workspace has a status or tags. It opens a
menu following `DisplayMenu`'s WAI-ARIA menu button pattern, with checkbox
items (`menuitemcheckbox`):

- **Status:** known statuses in MADR order, then other values A–Z, each with
  its count (`accepted 12`).
- **Tags:** most used first, each with its count; a small search field at the
  top once there are more than 10.

Counts are within the focused folder, and values with no documents there
aren't listed, so the menu never offers an empty list. The button shows the
number of active filters.

**Other ways in:** the status glyph on a row, a tag on the selected row, and
the status or a tag in the document header (section 5) each add a filter.
From the header, a hidden sidebar is shown, as a breadcrumb folder click does.

**Active filters** show as chips under the search box, like the focused
folder's bar: `[✓ accepted ×] [#queue ×]  Clear`. A status chip has its
glyph, a tag chip its `#`.

**No results:** "No documents match these filters" with a Clear filters
button, as for an empty focused folder.

**Remembered** per workspace, like folder focus (a sibling of
`folderFocus.ts`). A remembered value that no document has any more still
shows as a chip, so it can be removed; it is never dropped silently.

Not in the first version: typing `status:accepted` or `#queue` in the search
box. The chips are the source of truth; a query syntax can be added on top of
the same state later.

## 5. Document header

Front matter stays hidden as Markdown, but its metadata is shown as a single
strip above the document's content, in the reading column:

```
↷ Superseded by ADR-0021 · 2026-08-12 · Ana, Ben          #gateway  #auth
```

- Status glyph + word (the detail when there is one), date, decision makers,
  then the tags — status and tags look different, as in the list.
- "Superseded by ADR-0021" links to that document when the detail holds a
  Markdown link, or a number matching a numbered document in the same folder.
- Clicking the status or a tag adds it to the filters.
- Nothing is shown when the document has no `meta`.
- In the reader's style and font size; included when printing.

## 6. Demo

The demo ADRs (`demo/relay/docs/adr/`) write `Status: accepted · …` in the
body, which is read as it is. To show both ways in, one of them moves to
front matter (with tags), and the set gains a superseded and a proposed ADR
so the glyphs and filters have something to show. The demo bundle is built with the desktop scanner, so it
picks up `meta` without changes; demo search tests may need their counts
updated.

## 7. Phases

1. **List cleanup and hover card**: no single-document collapse, no flat-list
   hint, the hover card (title, location, marks). Useful without any
   metadata.
2. **Number column and title dedupe**: frontend only.
3. **Metadata**: both scanners with a shared fixture, API docs, status glyphs,
   tags on the selected row and in the hover card, document header, demo
   ADRs.
4. **Filtering**: filter menu, chips, entry points from rows and header,
   persistence.

## 8. Testing

- Parser: each scalar and list form, quotes, comments, `tag` / `deciders`
  aliases, status normalisation and detail, tag clean-up and limits,
  unreadable values ignored — shared fixtures
  (`tests/fixtures/workspace/docs/front-matter*.md`, `expected-scan.json`)
  in vitest and pytest.
- Body status: each line form (plain, list item, bold), trailing
  punctuation, a `## Status` section, front matter `status` winning over the
  body, front matter without `status` falling back to it, a `Status:` line
  after the first section or in a code block ignored — in the same fixtures.
- Numbers: detection (plain, prefixed, date-prefixed, single-letter prefix,
  no separator) and title dedupe (each separator, mismatched number, title
  that is only the number).
- Tree: a single-document folder now nests its document; folder chains and
  the single top folder still compact.
- Filtering: status only, tags only, both; combined with folder focus and
  search; counts within the focused folder; a remembered value that no longer
  exists.
- Hover card: delay and instant swap, staying inside the window, keyboard
  focus, no native tooltip alongside it.
