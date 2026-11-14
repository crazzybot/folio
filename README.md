<p align="center">
  <img src="desktop/build/icon.png" width="96" height="96" alt="">
</p>

<h1 align="center">Folio</h1>

<p align="center">
  Read, search and review folders of Markdown — specs, ADRs, notes and Obsidian vaults.<br>
  For macOS, Windows and Linux.
</p>

<p align="center">
  <a href="https://github.com/crazzybot/folio/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/crazzybot/folio"></a>
  <a href="https://github.com/crazzybot/folio/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/crazzybot/folio/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/crazzybot/folio"></a>
</p>

<p align="center">
  <img src="site/img/app-light.webp" alt="Folio showing a docs folder of ADRs and specs, each with its status, beside a proposed ADR that changed since it was read, with a highlight, a review note and the coding agent's reply">
</p>

Folio is a desktop app for reading and reviewing folders of Markdown: the
specs, architecture decision records and design notes that pile up in every
project, more and more of them written by coding agents. Open a project's
docs folder, see where each document stands, mark what needs another pass,
and send your notes back to the agent.

Think of a newspaper: coding agents are the reporters, filing drafts faster
than anyone can read them, and you're the editor, who reads each one, marks
it up, sends it back and decides what runs. Folio is the editor's desk:

```
 agent writes / revises ──► Folio: what changed? read, mark up
          ▲                                   │
          └────── notes, replies ◄────────────┘
```

The agent edits the files. Folio only reads them: your highlights, notes and
read history are kept in its own folder, `~/.folio`.

**Try it in your browser:** the [live demo](https://crazzybot.github.io/folio/demo/)
opens a sample repository of specs and ADRs, with nothing to install.

## Download

Get the latest version from the [download page](https://crazzybot.github.io/folio/download.html)
or from [GitHub Releases](https://github.com/crazzybot/folio/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Folio-<version>-arm64.dmg` — signed and notarized |
| macOS (Intel) | `Folio-<version>.dmg` — signed and notarized |
| Windows | `Folio-Setup-<version>.exe` — not code-signed yet, so SmartScreen shows a warning: choose **More info → Run anyway** |
| Linux | `Folio-<version>.AppImage` — `chmod +x` it, then run it |

The app checks for updates at launch (**Folio → Check for Updates…**).

## Features

- **See where every document stands.** Statuses and tags from front matter
  or a `Status:` line, as icons in a folder tree, with filters.
- **Mark it up.** Highlights, notes, bookmarks, and a verdict on a whole
  document ("accept once retries are capped"). Every mark in one list.
- **Send your review to a coding agent.** Copy your notes as Markdown with
  file paths and lines, or let the agent fetch them through Folio's MCP
  server and reply to each one in Folio.
- **See what changed since you read it.** New and changed documents are
  marked, and a changed document names the sections that changed.
- **Git-aware.** What changed on your branch, compared with the base branch,
  and the last commit of each document, with worktrees.
- **Search** titles, headings and full text, or focus on one folder.
- **Reads what you write:** GitHub Flavored Markdown, Obsidian links and
  embeds, math, and Mermaid diagrams in light and dark themes, in three
  document styles, to print or PDF.

The [user guide](https://crazzybot.github.io/folio/docs/) covers every
feature, the [settings](https://crazzybot.github.io/folio/docs/reference/settings)
and the [keyboard shortcuts](https://crazzybot.github.io/folio/docs/reference/shortcuts).
What's new in each version is in the [changelog](CHANGELOG.md).

## Use it with Claude Code

Install the plugin in Claude Code:

```
/plugin marketplace add crazzybot/folio
/plugin install folio@folio
```

Then `/folio:review` has the agent get your review notes, revise the
documents and answer each note in Folio. Other agents (Cursor, Codex…) use
the MCP server directly: see [packages/mcp](packages/mcp/README.md).
**Settings → Coding agents** in the app has both setups.

## Privacy and security

Folio never writes to your documents, has no account, and sends no
analytics. It goes online only to check for updates and to load web images
in a document. Markdown is treated as untrusted: HTML is sanitized, and only
safe file types are served. See [SECURITY.md](SECURITY.md) for the details
and how to report a vulnerability.

## Building from source

You need Node.js 20.19 or later and npm 10.

```bash
git clone https://github.com/crazzybot/folio.git
cd folio/desktop
npm install
npm start
```

`npm start` builds the frontend and the main process and launches the app.
Pick the repository's `workspace/` folder when it asks for one.
[docs/development.md](docs/development.md) covers live reload, the live
demo, the project structure and the checks; [docs/releasing.md](docs/releasing.md)
how releases are made.

## Contributing

Bug reports, ideas and pull requests are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and conventions. This
project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Alexei Pogrebtsov

Folio includes open-source software under its own licenses. Their notices
are in **Help → Third-Party Licenses** in the app, and **Settings →
Third-party licenses** in the live demo.
