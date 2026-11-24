# Notes from the agent

Status: implemented: the MCP tool, agent notes in the viewer, and where
to find them.
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
- `kind`, and for a decision `options`. Absent `kind`: the user's note,
  as before. Version-1 records keep unknown fields, so no new version.
- The user's pick is their reply, with `choice` (the option's index) on
  it, so it sits in the thread in order. Its text is their comment, or the
  option's when they wrote none. The current pick is the latest reply that
  has one (`pickedOption`); the store takes a `choice` only from the user,
  on a decision, within its options.
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
- The user's reply opens it, as any reply does, a pick included. Open, it
  goes with the next round.
- A comment starts `addressed`: nothing waits on the agent; the user
  resolves it.

## What the agent gets back

Review notes (reviewNotes.ts) word an agent note as the agent's, with a
decision's options numbered; the user's reply that picks one says so:

```
1. /repo/docs/adr.md:7 · Decision · note 1a2b3c4d
   > We will store events in Postgres

   Decision from Claude Code: Postgres or SQLite?

   1. Postgres
   2. SQLite

   My choice: 2. SQLite
   Small enough for one machine.
```

Its other replies are worded as on any note. The agent records the decision in the
document and answers with `folio_reply`, `addressed: true`.

## In the viewer

- The note is the first message of its thread, with the agent's name, and
  can't be edited (the bin still deletes it). **Reply** shows at once: the
  agent spoke last.
- The loop row says **Question from Claude Code** (or Decision, Comment)
  until someone replies, then the usual states.
- A decision's options are buttons under the thread, the pick pressed,
  with **Reply** under them in place of the thread's: the decision has one
  reply box. An option or **Reply** opens it; the answer is a pick, a
  comment, or both, and clicking the picked option takes it out. **Save**,
  or **Send** with an agent Live, adds it as the user's reply, or changes
  their latest one while it's unanswered (`choice: null` takes the pick
  out of it). In the thread, a reply that picks shows the option in bold,
  then the comment. Once the agent has replied, the decision is settled:
  the buttons and its reply box go, and the thread's **Reply** is back.
- The hover card and the inline note name the agent the same way.

## Finding them

An agent's note the user hasn't opened is new, as an agent's reply is
(threads.ts `isNewAgentNote`): its `seen` is absent. Opening its popover
sets `seen`, as it does for new replies. So the existing paths for new
replies carry the questions too:

- The status bar's link (`repliedNotes`): "Claude Code asked 3
  questions" when all the new notes are the agent's own, "Claude Code
  wrote on 4 notes" when replies are mixed in. Each click opens the next.
- The desktop's Dock badge and notification (replyAlerts.ts), with the
  same wording; a click opens the first.
- The margin marker's dot and labels ("a new question"), and **New
  question** in the Marks view.

Besides those:

- The **Documents** list counts each document's open questions (agent
  notes the user hasn't answered: `isOpenQuestion`) in a pill before the
  highlight count.
- The **Marks** view's filter has a **From** section, **The agent's
  notes**, shown while there are any.
