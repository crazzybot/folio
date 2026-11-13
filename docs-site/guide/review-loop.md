# Reviewing specs with a coding agent

Coding agents write specs, plans and decisions faster than anyone can read
them. Folio is the other end of that loop: the agent edits the files, you
read and mark them up in Folio, and your notes go back to the agent.

```
 agent writes / revises ──► Folio: read, mark up, decide
          ▲                              │
          └─────── review notes ◄────────┘
```

## A review round

1. **Open the folder** the agent writes to, and focus on the part you're
   reviewing.
2. **Read and mark up.** Highlight what's unclear or wrong and write a note
   on it. Give the document a status to ask for, such as `accepted`.
3. **Send your notes.** The header's clipboard button opens the Send dialog,
   with the notes not sent yet ticked. Copy them and paste them into the
   agent (Claude Code, Cursor or any other).
4. **Read the revision.** Folio shows the agent's edits as it saves them,
   and your marks follow the text.

<!-- TODO: a worked example: a spec, two notes, the copied text, the revision -->

## Connect the agent

Instead of copying and pasting, the agent can get your notes itself, through
Folio's MCP server, and answer each one in Folio. In Claude Code, install
Folio's plugin:

```
/plugin marketplace add crazzybot/folio
/plugin install folio@folio
```

Then run `/folio:review` in the project. The agent gets the notes you haven't
sent yet, revises the documents, and answers each note: what it changed, or
why not, or a question. Name documents to review only those:
`/folio:review docs/spec.md`.

Other agents (Cursor, Codex and any other MCP client) run the server with
`npx -y @crazzybot/folio-mcp`; see its
[setup](https://www.npmjs.com/package/@crazzybot/folio-mcp). It needs
Node 20.19 or later. The server reads your documents and never writes to
them; the agent edits them with its own tools.

## What the agent receives

The copied text is Markdown. Each note has the document's file path and line
(`/path/to/spec.md:42`), its section, the quoted passage and your note.
Highlights without a note, and notes marked **Only me**, are never sent.

`⇧⌘C` / `Ctrl+Shift+C` copies the unsent notes without opening the dialog.
**Settings → Review notes** changes the instructions at the top of the text.

## Sent notes

**Don't send these notes again**, on by default, marks the copied notes as
sent, so the next copy only has new ones. **Undo** in the status bar takes it
back.

<!-- TODO: tips for agent prompts that make good use of the notes -->
