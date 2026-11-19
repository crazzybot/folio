# Placing notes after edits

Status: in-progress: phase 1 of 3 (the section fallback). Builds on
[marks.md](marks.md) (anchoring) and [review-loop.md](review-loop.md).

In a review loop the agent rewrites the passages the user commented on.
Anchoring ([marks.md](marks.md), "Anchoring highlights") finds a passage
that moved or changed a little, but not one that was rewritten or removed.
Then the note becomes an orphan and goes to "Not found in the current
text" above the document. The conversation is no longer next to the text
it's about, and the strip fills up with every round.

This design adds fallbacks for when the text can't be found. A note goes
to "Not found" only when all of them fail.

## Decisions

| Question | Decision |
|---|---|
| What's tried, in order | The text (as now), the agent's new passage, a comparison with the version sent, the section, then "Not found" |
| Which marks | Highlights with a margin marker: a note, or sent to the agent without one. A bare highlight has nothing to show at a heading |
| How the section is kept | On the highlight: the headings it's under, outermost first, identified as bookmarks are (text, level, occurrence) |
| A note on a heading | A marker in the margin beside the heading, not a highlight on the heading's text. Its popover shows the old passage struck through |
| What's written back | The section, whenever the passage is found. Positions aren't, until phase 2 |
| Sending | A note placed at its section can be sent: the agent gets its section in place of a line |

## 1. The order of fallbacks

1. **The text**: anchoring's three steps (position, quote, the text between
   the saved surroundings).
2. **The agent's passage** (phase 2): the text the agent says replaced the
   quote.
3. **The version sent** (phase 3): the passage's place carried over from
   the version the note was sent on to the current one.
4. **The section** (phase 1): the nearest heading of the passage's section
   that's still in the document.
5. **Not found**: as today.

## 2. Phase 1: the section

### What's stored

`Highlight.section?: BookmarkHeading[]`: the headings above the passage,
outermost first (`[{ "text": "Design", "level": 2, "occurrence": 0 }, …]`).
It's absent for a passage before the first heading, and for highlights made
before this field existed, until they're painted.

- Set when the highlight is made, from the rendered document.
- Kept up to date: each time the viewer finds the passage in the text and its
  section differs from the stored one (absent, or the heading was renamed),
  it saves the new one. So notes made before this change get a section the
  first time they're shown. Writing it doesn't change `updated` or the
  note's state.
- Version-1 records keep fields they don't know (marks.md), so an older
  app keeps the section as it is.

### Finding it again

From the innermost heading out: the first one the document still has, by
text, level and occurrence. If none matches exactly but exactly one heading
has the same text and level, that one is used (an earlier heading of the same
name was removed, which shifts the occurrence numbers). If no heading in the
path is left, the note is "Not found".

### How it shows

- **Marker**: the note's icon in the right margin, level with the heading,
  with a dashed outline. Several notes on one heading sit one under another.
- **Popover**: opens beside the heading, as a highlight's does, with a line
  above the thread: "The passage isn't in the text any more" and the old
  quote struck through. Otherwise it's the usual popover: thread, replies,
  Resolve, Only me.
- **Not counted as not found**: the header's "N notes not found", the strip
  above the document and the Send dialog's count leave these notes out.
  The Marks view and hover card say "Passage not found · on *Heading*".
- **Outline**: counted under their heading.
- **Opening from the Marks view or the status bar**: scrolls to the
  heading and opens the popover there.

### What the agent gets

Review notes ([review-notes.md](review-notes.md)) locate each quote in the
source. When the quote isn't found and the note has a section, the location
line gives the section, so the agent knows where the note was:

```
1. docs/spec.md · Design › Storage (passage not found) · note 1a2b3c4d
```

## 3. Phase 2: the agent's passage

`folio_reply` gets an optional `passage`: the text that now stands where the
quoted text was, copied exactly from the file. Folio uses it only if it's in
the document's rendered text (a passage that's not there is ignored and the
next fallback is tried). Then the highlight's quote and position become the
new passage's, and the old quote is kept (`replaced: { exact, by, at }`) for
the thread to show it struck through above the new one. The tool
description asks for it when an edit replaced the quoted text.

## 4. Phase 3: the version sent

Each round keeps the SHA-1 of the version it was sent on, and the
snapshot store keeps that version's text. Comparing the rendered text of that
version with the current one carries the passage's start and end over to the
current text. If the span is empty (the passage was deleted), the section
fallback is next. This covers an agent that doesn't give a passage, and
edits made by hand. Highlights placed this way are marked "Moved after
edit" until the user resolves or reopens the note.

## Not done

- **Fuzzier matching** (diff-match-patch's `match_main`): it helps a little
  with small edits but not with rewritten text.
- **Several passages for one note**: the agent picks the main one and says
  so in its reply.
