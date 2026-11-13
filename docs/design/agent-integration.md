# Agent integration: the MCP server

Status: in progress (2026-11-12). The server (`packages/mcp`) and the
threads in the app are implemented. Builds on
[review-notes.md](review-notes.md) and [sending-notes.md](sending-notes.md).

With Copy review notes, the user pastes notes into the agent, and nothing
comes back except the revised file. The MCP server closes the loop: the
agent fetches the notes itself, revises the documents, and answers each note
in Folio, where the user sees which were addressed and resolves them.

Folio still never edits documents. The agent does, with its own tools;
Folio only gives it the notes and stores its replies.

## Decisions

| Question | Decision |
|---|---|
| How agents reach Folio | An MCP server over stdio, so it works with any agent that speaks MCP |
| Where it runs | A standalone Node script, `@crazzybot/folio-mcp` on npm, reading and writing `~/.folio` through the core. Works whether or not the app is open |
| Which documents the agent sees | Those under its root: the agent's working directory, or `--root`. Paths in and out are absolute; anything outside the root is refused |
| What the agent can change | Reply to a note, and say a note is addressed. It can't create, edit, resolve or delete marks, and there's no tool that writes documents |
| Who resolves | The user. A model shouldn't close a reviewer's comment |
| What a fetch sends | What Copy review notes would: open, non-private notes, in its words. Fetching makes them sent and records a round, as copying does |

## Threads

Marks gain optional fields, still version 1 ([marks.md](marks.md)): a
note's `author`, `replies` and `seen`. An agent's replies are signed with
the MCP client's name ("claude-code" → "Claude Code"). A reply marked
addressed sets the note to `addressed`; any other reply, the agent's
question or the user's answer, sets it back to open so it goes with the
next round.

## In the app

- **Highlight popover and the note on a document**: the note, then its
  replies, each with its author and time (plain text, never rendered).
  **Reply** opens a box under them (`⌘↩` / `Ctrl+Enter` sends); the reply is
  the user's, and the note is open again. Only the MCP server writes an
  agent's replies: the app's IPC always signs them as the user.
- **New replies**: an agent's or imported reply after the thread's `seen`
  time. Opening the note's popover (or the note on the document) sets
  `seen`. Until then, its margin icon has a dot and its Marks view row a
  **New reply** label.
- **Status bar**: "Claude Code replied to 3 notes" while any note in the
  workspace has new replies; each click goes to the next of them.
- The live demo keeps replies in the page, as its other marks.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `folio_list_documents` | `folder?`, `status?`, `tag?`, `withOpenNotes?` | Path, title, status, tags, and how many notes wait on the agent (unsent or sent) |
| `folio_get_review_notes` | `paths?` (default: every document with notes to send), `includeSent?`, `includeAddressed?` | The review notes, with each note's id and its replies so far. Records a round |
| `folio_reply` | `noteId` or `path`, `text`, `addressed?` | What happened to the note |

- The notes are formatted by the core (`reviewNotes.ts`), shared with Copy
  review notes. For the agent, each location line ends with the note's id,
  and the replies follow the note:

  ```
  2. /Users/me/app/docs/adr/0003-event-store.md:57-59 · Decision › Consequences · note a1b2c3d4

     > Snapshots are taken every 100 events.

     Why 100?

     Reply from Claude Code: Which load test should I cite?

     My reply: The one from October.
  ```

- A note id is the highlight id's first 8 hex digits; more are accepted. The
  note on a document as a whole is answered by the document's path.
- Sent notes are left out unless `includeSent`, addressed ones unless
  `includeAddressed`, so a second fetch doesn't redo work. Resolved and
  private notes never go.
- Refusals (a path outside the root, an unknown note) come back as tool
  errors the agent can read, not failed calls.
- The tool descriptions are the agent's instructions: edit the documents
  itself, keep their structure, reply to every note it acted on.

## Server

- `packages/mcp`, bundled by esbuild with the core and the MCP SDK into one
  file, so `npx` installs nothing else.
- Reads the app's `settings.json` (in Electron's data folder for Folio) for
  skipped folders, scan depth and the opening line (`reviewIntroOn`,
  `reviewIntro`: **Settings → Review notes**, which the desktop app keeps
  there); defaults when the app was never run.
- Writes go through the core's store: read–modify–write with atomic rename,
  as the app does, so the app and the server can write at the same time.
- The agent starts the server once per session. The scan is cached and
  dropped when a Markdown file or folder under the root changes (recursive
  `fs.watch`); where that isn't available, every call scans.
