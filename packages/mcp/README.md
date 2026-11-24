# Folio MCP server

Gives a coding agent the review notes you left in
[Folio](https://crazzybot.github.io/folio/) on your project's Markdown
documents, and keeps its replies, so you see in Folio which notes it
addressed.

The agent edits the documents with its own tools. The server never writes
to them: it only reads them, and keeps notes and replies in `~/.folio`, as
the app does. It works whether or not Folio is open.

## Setup

Claude Code, with Folio's plugin, which adds the `/folio:review` and
`/folio:review-loop` commands:

```
/plugin marketplace add crazzybot/folio
/plugin install folio@folio
```

Or the server alone:

```bash
claude mcp add folio -- npx -y @crazzybot/folio-mcp
```

Other MCP clients:

```json
{
  "mcpServers": {
    "folio": { "command": "npx", "args": ["-y", "@crazzybot/folio-mcp"] }
  }
}
```

Then ask the agent to address your Folio review notes.

## Review in a loop

Rather than asking after each round, leave the agent waiting for your notes:
`/folio:review-loop` in Claude Code, or ask any other agent to wait for your
review with `folio_wait_for_review` and keep going until you stop it. In
Folio, **Send** in the **Send review notes** dialog, or **Save and Send** on
a note, hands your notes straight to it. The agent addresses them, answers
each one, and waits for the next round.

While it waits, Folio's desktop app shows a **Live** pill on the agent's
folder. **End Review Loop** there tells the agent to stop waiting, and so
does quitting Folio or opening another workspace.

## Tools

- `folio_list_documents`: the Markdown documents under the project, with
  their status, tags and how many notes wait on the agent.
- `folio_get_review_notes`: the notes you haven't sent yet, as Folio's
  **Copy review notes** words them, with each note's id. They're marked sent.
- `folio_reply`: answer a note, and say whether it's addressed. You resolve
  or reopen it in Folio. When the edit replaced the quoted text, the agent
  gives the new text as `passage`, and Folio highlights it in its place.
- `folio_add_notes`: put the agent's questions on the passages they're
  about, as notes you answer in Folio. A `question` takes an answer in
  words, a `decision` 2 to 4 options you pick from, and a `comment` needs
  no answer. Each passage is copied from the file; if one isn't there,
  nothing is saved. Up to 20 notes at a time.
- `folio_wait_for_review`: wait until you send notes from Folio, then get
  them as `folio_get_review_notes` does. Without notes by the timeout
  (`timeoutSeconds`, default 240), it returns, and the agent calls again
  with the `since` it gave.

## Options

```
folio-mcp [--root <folder>] [--data-dir <folder>]
```

- `--root`: the documents' folder. Default: the folder the agent starts it
  in. Documents outside it are refused.
- `--data-dir`: where Folio keeps marks. Default: `~/.folio`.

Requires Node 20.19 or later. MIT licensed.
