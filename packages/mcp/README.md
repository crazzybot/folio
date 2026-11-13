# Folio MCP server

Gives a coding agent the review notes you left in
[Folio](https://crazzybot.github.io/folio/) on your project's Markdown
documents, and keeps its replies, so you see in Folio which notes it
addressed.

The agent edits the documents with its own tools. The server never writes
to them: it only reads them, and keeps notes and replies in `~/.folio`, as
the app does. It works whether or not Folio is open.

## Setup

Claude Code, with Folio's plugin, which adds a `/folio:review` command:

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

## Tools

- `folio_list_documents`: the Markdown documents under the project, with
  their status, tags and how many notes wait on the agent.
- `folio_get_review_notes`: the notes you haven't sent yet, as Folio's
  **Copy review notes** words them, with each note's id. They're marked sent.
- `folio_reply`: answer a note, and say whether it's addressed. You resolve
  or reopen it in Folio.

## Options

```
folio-mcp [--root <folder>] [--data-dir <folder>]
```

- `--root`: the documents' folder. Default: the folder the agent starts it
  in. Documents outside it are refused.
- `--data-dir`: where Folio keeps marks. Default: `~/.folio`.

Requires Node 20.19 or later. MIT licensed.
