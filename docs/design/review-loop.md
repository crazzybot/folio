# Review loop: the agent waits for the user's notes

Status: implemented (2026-11-14), on `feat/mcp-wait-for-review`. Builds on
[agent-integration.md](agent-integration.md) and
[sending-notes.md](sending-notes.md).

With the MCP server, the agent fetches notes and answers them in Folio, but
each round still starts in the agent: the user switches to it and asks it
to review. In a review loop the agent waits for notes instead. The user
sends them from Folio, the agent takes them, revises, replies, and waits
again, so a round needs no switch to the agent.

## Decisions

| Question | Decision |
|---|---|
| How the agent waits | A long-polling tool, `folio_wait_for_review`, called again after every round. Works in any MCP client; no push channel needed |
| How notes reach it | **Send** records a round `via: "send"`, as Copy does with `via: "copy"`; the waiting server picks up rounds sent after its `since` |
| How the app knows an agent waits | Each waiting server writes a presence file in the data folder; the app watches the folder |
| Which documents | Only those under the server's root, the folder the agent works in |
| Stopping | The user tells the agent, or the app writes a stop file the wait sees: on **End Review Loop**, and for the sessions it shows when it closes their workspace or quits |
| Telling the user it's taken | The round is marked `picked` when the wait returns it |

## 1. The wait

`folio_wait_for_review(since?, timeoutSeconds?)` (default 240 s, at most
1800):

- `since` absent: now. Notes sent after `since` are the next round's.
- It returns as soon as a round `via: "send"` on a document under the root
  is newer than `since`, with the notes formatted as `folio_get_review_notes`
  gives them, and a new `since`. Rounds are timed to the second, so a round
  in the same second as `since` counts unless this session already had it.
- No notes before the timeout: it returns "no notes yet" with the same
  `since`, and the agent calls again. Timeouts keep each call within what
  clients allow for a tool call.
- It watches the marks folder and checks again every 10 s, for changes the
  watch misses.
- The notes are the ones the round lists, as they are now: resolved and
  private ones are left out.

The Claude Code plugin's `/folio:review-loop` skill
(`plugins/folio/skills/review-loop/SKILL.md`) runs the loop: wait, address,
reply to each note, wait again with the new `since`, until the user stops
it. Other agents follow the tool descriptions.

## 2. Presence

While a session waits or works, its server keeps
`<data folder>/agents/<pid>.json` (`packages/core/src/agents.ts`):

```json
{
  "version": 1,
  "pid": 4242,
  "root": "/Users/me/app",
  "client": "Claude Code",
  "state": "waiting",
  "since": "2026-11-14T10:00:00.000Z",
  "until": "2026-11-14T10:04:00.000Z",
  "updated": "2026-11-14T10:00:00.000Z"
}
```

- `state` is `waiting` during a wait and `working` once it returned notes,
  until the next call. Written whole, with an atomic rename.
- A file says only what the session last wrote, so the reader decides what's
  live: the process still runs, and a wait hasn't passed `until` by more
  than a minute (the agent replies between waits). A session working for
  more than 30 minutes is taken as stopped.
- The client's name comes from the MCP handshake.

## 3. In the app

- **Live** (`LivePill.tsx`): the desktop app watches `agents/`
  (`desktop/src/agents.ts`) and matches sessions to the workspace: a root
  inside it or holding it. Every session shows in one place, the status
  bar's pill, whatever the sidebar shows (folders or not, a search, the
  Marks view). Its menu lists where each session is and what it's doing,
  then End Review Loop for each, and End All Review Loops for several. A
  session's folder row and a focused folder get the dot alone, with the same
  title: a hint of where, not a second control. The dot pulses while an
  agent waits.
- **Send** in the Send dialog: with a session live on the documents, **Send**
  comes first, records the round `via: "send"` with the agent's name, and
  marks the notes sent. **Copy** stays beside it for pasting elsewhere.
- **Send**: in a highlight's note editor, the reply box and the note on
  the document, with a session live on the document. It saves, and sends
  that one note in a round of its own. On the note on the document it's
  enabled while the note has changes or hasn't been sent. It was **Save and
  Send**, beside a primary **Save**; with an agent live, sending is what
  the user came to do, so **Send** is the primary button and **Save**,
  which keeps the note for the next round, the secondary one.
- **End Review Loop**: in the status bar pill's menu, and in a folder's
  context menu. It writes `agents/<pid>.stop`. The session's next check returns
  "ended", which tells the agent not to call again, and removes both files.
  The app hides a session with a stop file at once.
- **Opening another workspace** writes the same file, with `reason:
  "closed"`, for each session the app showed that the new workspace doesn't
  overlap: the app no longer shows it, so it can't send it notes. A session
  the new workspace still covers (a parent folder, or one inside the
  session's) keeps its loop. The wait returns "closed".
- **Quitting the app** does the same with `reason: "quit"` for each session
  it shows, synchronously in `before-quit`. The wait returns "quit", and the
  agent tells the user the loop ended because Folio was closed. Closing the
  window on macOS leaves the app running on the same workspace, so loops go
  on. A crash writes nothing; those sessions wait until the user stops them.

## 4. Picked up

A round `via: "send"` sits in the marks record until a wait returns it.
Then the server calls `MarksStore.markPicked`, which sets the round's
`picked` time once. The app shows the note as taken: "Sent · Claude Code has
it" in the popover's bottom row and on the note on the document, and "Claude
Code is working on it" in the Marks view (`pickedUpBy` in
`frontend/src/sending.ts`). A round `via: "mcp"` is the agent's own fetch,
so it counts as picked up when it's recorded.

## 5. Replies while the user is elsewhere

`desktop/src/replyAlerts.ts`, run when marks change:

- The Dock badge (`app.setBadgeCount`) counts the workspace's notes with
  agent replies the user hasn't seen (the thread's `seen`, as in
  `frontend/src/threads.ts`).
- New ones get a system notification while Folio isn't the focused app:
  "Claude Code replied to 4 notes". Clicking it focuses the window and sends
  `replies:show`; the window opens the first note with new replies, as the
  status bar's **Claude Code replied to …** link does.

## 6. The note dialogs

The loop made the note on the document's dialog and a highlight's popover
work the same way:

- Both end with a row: the note's state with its icon (**Not sent**,
  **Sent**, **Addressed**, **Resolved**) and what can be done about it, and
  the **Only me** lock on the right. The document note's lock is saved with
  the note, so it's part of what **Save** saves.
- The document note's dialog is 420 px wide, as a highlight's popover with
  a note.
- **Save** is enabled once something changed; in the reply box, once the
  reply isn't empty or differs from the one being edited. The reply box's
  button says **Save** in every mode: without a Live agent, a reply goes
  with the next round, so nothing is sent yet.
- While the user writes a reply, the dialog's own buttons are hidden; the
  reply box has its own.
- A thread opens scrolled to its latest message, and scrolls down when a
  reply arrives.
- **Send** leaves the dialog open, so the exchange reads as a chat. Below
  the thread, a row follows the agent (`agentProgress` in
  `frontend/src/sending.ts`), for a note whose last round went `via:
  "send"` and that's still sent and unanswered: a pulsing dot while the
  round isn't `picked`, chat dots once it is, and "Claude Code's review loop
  ended before it replied" once no session is live on the document. The
  answer replaces the row when it arrives. A copied or fetched note has no
  row: no loop to wait on.
- A popover a note was sent from stays open when a reload loses its
  highlight (the agent rewrote the passage without saying what replaced
  it): it keeps its place rather than closing as the reply arrives.
- Both have a **×** to close them, which does what a click elsewhere does:
  a highlight's note being written is kept, the document note's changes
  are saved. Closing was only a click elsewhere, which users had to guess.
