# Agent integration: the MCP server

Status: implemented (2026-11-12): the server (`packages/mcp`), the threads
in the app, the Claude Code plugin and Settings → Coding agents. Builds on
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
  replies, each in a box with its author and time. Messages are light
  Markdown (`MessageText.tsx`): emphasis, lists, code, quotes and tables
  only. Raw HTML is dropped, images show their alt text, links are text with
  the address in the tooltip, and headings read as a bold line; no diagrams,
  math or highlighting. Sanitised as documents are. The user's messages are
  tinted, and the boxes keep a message's bold text from being taken for
  the next author's name, which stays bold.
  **Reply** opens a box under them (`⌘↩` / `Ctrl+Enter` sends); the reply is
  the user's, and the note is open again. Only the MCP server writes an
  agent's replies: the app's IPC always signs them as the user.
- **One conversation**: once a note has replies, the note is the thread's
  first message (its author and creation time) and scrolls with the
  replies. It can't be edited then: the popover drops its note button, and
  the note on the document its **Comment** box (its **Status** stays). The
  store doesn't enforce this: the note on the document's status is saved
  with its text.
- **Editing a reply**: the user's latest reply has **Edit** until someone
  answers it (the store refuses an edit of any other reply). It keeps its
  id, takes the edit's time, and opens the note again so the new wording
  goes with the next round.
- **Deleting a reply**: the user's latest reply has **Delete** while the
  note is open (not sent since: the agent hasn't seen it). A reply that
  reopened a note keeps the state it reopened in `reopened`; deleting the
  reply restores it, so a note the agent addressed is addressed again. The
  bin at the top of the popover still removes the highlight and its thread.
- **New replies**: an agent's or imported reply after the thread's `seen`
  time. Opening the note's popover (or the note on the document) sets
  `seen`. Until then, its margin icon has a dot and its Marks view row a
  **New reply** label.
- **Status bar**: "Claude Code replied to 3 notes" while any note in the
  workspace has new replies; each click goes to the next of them.
- The live demo keeps replies in the page, as its other marks.
- **Settings → Coding agents** (desktop only: the demo's marks are in the
  page, out of an agent's reach): the plugin's two install lines and the
  `mcpServers` JSON for other clients, each with a **Copy** button.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `folio_list_documents` | `folder?`, `status?`, `tag?`, `withOpenNotes?` | Path, title, status, tags, and how many notes wait on the agent (unsent or sent) |
| `folio_get_review_notes` | `paths?` (default: every document with notes to send), `includeSent?`, `includeAddressed?` | The review notes, with each note's id and its replies so far. Records a round |
| `folio_reply` | `noteId` or `path`, `text`, `addressed?` | What happened to the note |
| `folio_wait_for_review` | `since?`, `timeoutSeconds?` | The next notes the user sends from Folio, or none by the timeout; see [review-loop.md](review-loop.md) |

- The notes are formatted by the core (`reviewNotes.ts`), shared with Copy
  review notes. The replies follow the note in both, so a note answered back
  and forth reaches the agent as the whole thread. For the agent, each
  location line also ends with the note's id:

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

## Claude Code plugin

This repository is a Claude Code plugin marketplace with one plugin, so it
installs with two commands and needs no listing elsewhere:

```
/plugin marketplace add crazzybot/folio
/plugin install folio@folio
```

```
.claude-plugin/marketplace.json   the folio marketplace: one plugin, ./plugins/folio
plugins/folio/
  .claude-plugin/plugin.json      name, version
  .mcp.json                       runs: npx -y @crazzybot/folio-mcp
  skills/review/SKILL.md          /folio:review [paths…]
  skills/review-loop/SKILL.md     /folio:review-loop (review-loop.md)
```

- The server is the npm package, not a copy in the plugin: `npx -y` runs the
  latest release, so a server release needs no plugin release. The plugin's
  own version changes when its files do.
- No `--root`: Claude Code starts the server in the project folder, which is
  the root it should see.
- `/folio:review` tells the agent to get the notes (for the given paths, or
  every document with notes to send), revise the documents in their own
  structure and language, answer every note with `folio_reply`, and end
  with a summary that points the user to Folio to resolve them. The tools'
  descriptions say the same; the skill makes it one command.
