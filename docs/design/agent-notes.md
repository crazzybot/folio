# Notes from the agent

Status: implemented: the MCP tool, and agent notes in the viewer.
Builds on [agent-integration.md](agent-integration.md) (threads, replies),
[placing-notes.md](placing-notes.md) (the agent's passage) and
[note-lifecycle.md](note-lifecycle.md).

In a review loop the user writes notes and the agent answers them. The
agent has questions too, and asks them in its terminal, away from the text.
Here the agent writes notes in Folio instead: each question on the passage
it's about, answered next to it. Marks live in the data folder, not in the
documents, so an agent writing them breaks no rule.

## The tool

`folio_add_notes(path, notes)`, in the MCP server. Each note has:

- `passage`: the text it's on, copied from the document's source.
- `text`: the question or comment, in Markdown.
- `kind`: `question` (an answer in words), `decision` (a pick of 2–4
  `options`, one line each, up to 200 characters), or `comment`
  (information; no answer needed).

Up to 20 notes per call. Every passage is looked for in the file with
`findPassage` (sourceMap.ts), as a reply's `passage` is; if one isn't
found, or a note is malformed, nothing is saved and the tool says which
note. The tool's description asks for questions about the content, not for
permission to act: tool approvals stay in the agent.

## The data

An agent note is a highlight (markTypes.ts) with:

- `author: {kind: "agent", name}`, as on the agent's replies.
- `kind`, and for a decision `options`; `choice` once the user picks (the
  option's index). Absent `kind`: the user's note, as before. Version-1
  records keep unknown fields, so no new version.
- `color: "blue"`. The user can change it.
- `passage: {exact, at, first: true}`. A highlight's anchor is in the
  rendered text, which only the viewer has, so the server can't make one.
  Until the viewer finds the passage, `quote.exact` is the passage and
  `position` its offsets in the source: a hint for which occurrence, as
  `findPassage`'s `near`. The viewer finds a pending passage first and
  takes it as the quote, as it does for a reply (placing-notes.md); with
  `first`, nothing is recorded as `replaced`. A passage the viewer can't
  find shows under **Not found in the current text**.

## States

The existing loop (note-lifecycle.md) covers it, with one change:
`answeredBy` counts the note's own author when it has no replies.

- A question or decision starts `sent`, the agent's word last: it waits
  on the user, as a question in an agent's reply does. It isn't sent, and
  doesn't count as waiting on the agent in `folio_list_documents`.
- The user's reply opens it, as any reply does. Picking an option sets
  `choice` and opens it too. Open, it goes with the next round.
- A comment starts `addressed`: nothing waits on the agent; the user
  resolves it.

## What the agent gets back

Review notes (reviewNotes.ts) word an agent note as the agent's, with a
decision's options numbered and the user's pick:

```
1. /repo/docs/adr.md:7 · Decision · note 1a2b3c4d
   > We will store events in Postgres

   Decision from Claude Code: Postgres or SQLite?

   1. Postgres
   2. SQLite

   My choice: 2. SQLite
```

Then the replies, as on any note. The agent records the decision in the
document and answers with `folio_reply`, `addressed: true`.

## In the viewer

- The note is the first message of its thread, with the agent's name, and
  can't be edited (the bin still deletes it). **Reply** shows at once: the
  agent spoke last.
- The loop row says **Question from Claude Code** (or Decision, Comment)
  until someone replies, then the usual states.
- A decision's options are buttons under the thread, the pick pressed.
- The hover card and the inline note name the agent the same way.
