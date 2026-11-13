# Inline notes

Status: implemented (2026-11-11), released in 0.5.0. Builds on
[marks.md](marks.md) §4, and shows the note states of
[sending-notes.md](sending-notes.md).

Today a note is read by clicking its highlight or its margin icon, or by
hovering the icon. That's fine for one note, and slow for the moments when
the notes are the point: re-reading a document with one's notes before
sending them, or reading the agent's revision against them. Inline notes
show every note in the text, under the passage it's about, smaller and
dimmer than the document.

## Decisions

| Question | Decision |
|---|---|
| On or off | A view option, **Notes: In margin \| Inline**, inline by default (decided 2026-11-11), remembered globally |
| Where a note goes | After the smallest block that holds the end of its passage, never inside a sentence (§1) |
| Several notes in one block | Numbered in the order of their passages. Nothing is added inside the text: hovering a note shows its passage (§2, §4) |
| Tables | A full-width row under the commented cell's row; after the table when that isn't possible (§3) |
| Which marks | Highlights with a note. Bare highlights have nothing to show |
| Editing | Clicking a note opens the popover, as clicking the highlight does. No editing in place |
| Hover tooltip on the passage | Not built: the pointer rests on text all the time while reading and selecting, and hovering the margin icon already shows the note |

## 1. Placement

A note goes after the smallest block that holds the **end** of its
passage:

| Passage in | Note goes |
|---|---|
| Paragraph, heading, code block | After it |
| List item | After the item's own text, before a nested list |
| Blockquote | Inside the quote, after the paragraph |
| Table cell | A row under the cell's row (§3) |
| Collapsed `<details>`, diagram, math | Nowhere: the margin icon stays |

- Inserting notes into a sentence would break the paragraph the user is
  reading; after the block, the passage reads as written.
- A passage across several blocks puts its note after the last.
- Highlights not found in the current text have no place and aren't shown;
  the Marks view lists them, as today.

## 2. What a note shows

```
  We will store events in Postgres, one table per aggregate.
  Snapshots are taken every 100 events.
  │ ¹ Why not a single events table? Explain the trade-off.        ✓
  │ ² Where does 100 come from?                                       ↗
```

- Smaller and dimmer than the text, with a thin rule on the left in the
  highlight's colour.
- The note's text (Markdown, as in the popover) and its state icon
  ([sending-notes.md](sending-notes.md) §2).
- **Numbering**: only when a block has two or more notes; a lone note sits
  under its passage and needs none. Numbers restart in each block:
  document-wide ones would shift whenever a note is added above, and would
  be confused with the numbers in the copied text. Order by where each
  passage ends. Highlights never overlap (selecting highlighted text opens
  its popover instead), so each passage has one note.
- The passages carry no marker: the order of the notes follows the order
  of the passages, and each note's rule has its highlight's colour.
- Hovering a note underlines its passage; hovering a passage lights up its
  note.
- Clicking a note opens the highlight's popover (state, resolve, lock).
- **Replies** ([agent-integration.md](agent-integration.md)): one line
  under the note, "↳ 3 replies · latest from Claude Code, 10:02", with a
  **New** label while some are unread. Not the thread itself: agents'
  replies run to paragraphs, and a few turns would push the text apart;
  the thread is in the popover. The time is the clock's, not "5 min ago",
  as the line isn't redrawn while it's shown.
- Private notes are shown too, without a state icon: inline notes are for
  the reader, not only the agent loop.

## 3. Tables

A note inside the cell would widen its column and heighten its row, so the
whole table shifts when notes are switched on, and cells are often too
narrow for prose. After the table, a note on a row near the top of a long
table is far from its cell.

- So a note goes in an **inserted row** under the row holding the
  commented cell: one cell spanning every column, so column widths don't
  change. Each note is labelled with its column: "*Cost:* where does this
  estimate come from?"
- A passage over several rows puts its note under the last one.
- Where a row can't be inserted cleanly (an HTML table with `rowspan`),
  notes go after the table, labelled with row and column: "Row *Postgres*,
  column *Cost*". The row is named by its first cell.
- The inserted row has its own style: the note style, the colour rule, no
  zebra striping, no hover row highlight.

## 4. Rendering

- Notes are elements with `data-marks-skip`, so the rendered
  text that highlights anchor to (`textModel.ts`) doesn't change when they
  appear.
- Highlights are painted with the Custom Highlight API, so there's no
  element to hang a note on. A note's block is found from its range's end
  container, walking up to the nearest block (or `tr`).
- **Nothing inside the text** (decided 2026-11-11, after phase 3). The
  first version put a numbered marker after each passage, which meant
  splitting React's text nodes. React writes new text into the node it
  made, so after a split the old text after the marker stayed behind and
  showed twice; avoiding that took a MutationObserver that removed and
  placed the notes again on every change, an exact undo that merged split
  text back and moved live ranges by hand, and a check for text React had
  rewritten (spike, below). Notes now only go beside React's elements,
  which React tolerates, and its text nodes are never touched. Hovering
  links a note to its passage instead.
- React may still add, remove or replace blocks under the notes (a reload,
  KaTeX loading): a MutationObserver on added and removed elements places
  them again, so a note doesn't stay beside the wrong block.
- Placement is also redone when a mark changes or a record changes from
  outside.
- **Excluded from the document's text**: `user-select: none`, so selecting
  and copying the document skips notes; find in document skips them
  (`findMatches` in searchHighlight.ts skips `data-marks-skip`, as
  textModel.ts does; the Marks view's filter searches note text); printing and export leave them
  out unless the option is on when printing.
- **Switching** keeps the passage at the top of the view in place, so the
  text doesn't jump under the reader.

### Spike (2026-11-11)

With markers in the text, since removed (§4); kept for the reasoning.

`frontend/src/inlineNotes.ts` (placement, insertion, exact removal, the
observer) and a harness page (since removed; `inlineNotes.test.ts` covers it), run in
Chrome: react-markdown renders a document with a paragraph holding two
highlights, a list item with a nested list, a quote, a Markdown table, an
HTML table with `rowspan` and a closed `<details>`, and the highlights are
painted as MarksLayer does. Results:

| Case | Result |
|---|---|
| Placement | As §1 and §3: numbered notes under the paragraph; the list item's note before its nested list; the quote's inside the quote; a spanning row under the table row; after the `rowspan` table; none in the closed `<details>` |
| Highlights | Ranges still cover their quotes after markers are inserted, and stay painted. The text model is unchanged |
| Re-render without changes | React doesn't touch the document; nothing moves |
| The noted text edited, a paragraph inserted above, the noted paragraph removed | The text is exactly what React alone renders; notes placed again |
| Notes turned off | The document's HTML is identical to React's own render |
| A paragraph with inline markup, its text changed, no observer | **The text after the marker shows twice**, for good: React updates text nodes in place |
| The same with the observer | Doubled within the update, correct before the browser paints |

An element whose only child is text is updated by React with
`textContent`, which wipes markers rather than doubling text; the observer
places them again too.

Left for phase 2:

- **Cost**: every change to the document's DOM (a diagram drawn, KaTeX
  loaded) places all notes again. Measured (below).
- **Adjacent highlights**: a highlight that starts exactly where a marker
  goes has its range start before the marker, so the marker is painted in
  that highlight's colour. Cosmetic; gone with the markers.
- **A note's content** is plain text in the spike. Markdown and state
  icons are rendered by React into the inserted elements (portals),
  which the observer already ignores.
- **Paint timing**: the viewer paints highlights in an effect after the
  render, so after a reload notes are placed once with old ranges and once
  more when the new ones are painted. Paint in a layout effect, or place
  notes only after painting.

### Performance (2026-11-11)

A benchmark page (since removed), in headless Chrome on an Apple M1:
documents generated with a heading, two paragraphs, a list and a table per
section, notes spread over paragraphs, inline code, lists and tables
(markers in most blocks, before they were removed). Medians of seven
runs, layout included:

| Document | Notes | Place | Remove | Again after an outside change |
|---|---|---|---|---|
| 11k characters | 20 | 1.5 ms | 0.5 ms | 1 ms |
| 57k | 100 | 4.7 ms | 1.8 ms | 4 ms |
| 57k | 500 | 18 ms | 14 ms | 28 ms |
| 233k | 400 | 15 ms | 13 ms | 21 ms |
| 233k | 2000 | 87 ms | 195 ms | 265 ms |

- Up to a few hundred notes, placing them is within a frame or two.
- The growth past that is the browser's: Chrome updates every live `Range`
  in the document on each DOM change, so N notes (N highlight ranges, about
  N splits and merges) cost about N². Measured alone: 2000 text splits take
  1.3 ms with no live ranges, 54 ms with 2000; merging them back 1.2 ms and
  89 ms. Removing the module's own quadratic work (`remove` checking every
  range against every split; `owns` scanning every inserted element)
  changed the numbers by under 10%.
- Avoiding it would mean painting with `StaticRange`s and locating
  highlights again after every change, a redesign not worth it for
  documents with thousands of notes.
- If it shows up in real use: skip placing again for changes that touch
  none of the notes' nodes (a Mermaid SVG drawn into its own container),
  which today trigger it like any other change.

## 5. UI

- **Notes: In margin | Inline**, a group in the header's display options
  menu (`folio.notePlace`). **View → Toggle Inline Notes** on desktop and
  `⌥⌘N` / `Ctrl+Alt+N` switch it; the key is free in the menus and
  matched by `code`, since ⌥N is a dead key on macOS.
- The margin icons stay in inline mode: they show state at a glance while
  scrolling.
- Hovering a passage with a note (either mode) brightens its margin icon,
  so it's clear which icon belongs to which passage. That's the only hover
  effect on the passage itself.
- Hovering a note, its passage or its icon underlines the passage
  (`::highlight(folio-mark-hover)`) and lights up the others.
- Clicking a note opens the highlight's popover there.

## Phases

1. Spike: a marker inserted into a paragraph with highlights repainted;
   placement of a block's notes. Done (§4, Spike).
2. Inline notes for paragraphs, headings, lists, quotes and code blocks,
   with numbering, hover linking, the toggle and the scroll anchor. Done
   (2026-11-11): `MarksLayer` places them with `watchInlineNotes`; tried
   in the browser demo for placement, find, hover, click, editing a note,
   switching documents, and turning them off (the document's HTML is
   React's again). Near the end of a short document, turning notes off
   can't keep the text in place: the document gets shorter than the
   scroll position.
3. Tables: the inserted row, the fallback after the table. Done with 2.
   Column labels read KaTeX math by its rendered text.
   Tests: `inlineNotes.test.ts` (jsdom): placement in every kind of block,
   numbering, labels, the text, its nodes and the ranges kept, exact
   removal, notes placed again when React adds or removes blocks.
4. State icons in the note: done with sending notes
   ([sending-notes.md](sending-notes.md)), in the same release.

## Later

- **A notes column** beside the text on wide windows, Google Docs style
  ([marks.md](marks.md) lists margin notes as not in the first version): the text never
  reflows and notes sit level with their passages, at the cost of laying
  out notes that collide. A third option, **Beside**, falling back to
  inline when the window is narrow.
- Inline notes shown only for a state (say, only unsent and addressed)
  while working through a round.
