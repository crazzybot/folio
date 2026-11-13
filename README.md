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
  <img src="site/img/app-light.webp" alt="Folio showing a docs folder of ADRs and specs, each with its status, beside a proposed ADR with a highlight and a review note">
</p>

Open a folder and Folio lists every Markdown file in it, lets you search titles,
headings and full text, and renders documents with syntax highlighting, math,
Mermaid diagrams and Obsidian-style links. It reads each document's status and
tags from its front matter or `Status:` line, so you see at a glance which
decisions are accepted, proposed or superseded, and can filter by them.
Highlight passages, write notes on them, give your verdict on a whole document
and bookmark sections as you read, then find every mark again in one list.
It never edits your files: marks are kept in Folio's own folder.

Folio is made for the documents you have to read closely, such as the specs,
architecture decision records and design proposals that pile up in every
project, more and more of them written by coding agents. Open a project's docs
folder, focus on the part you're reviewing, and mark what needs another pass.

Think of a newspaper: coding agents are the reporters, filing specs, plans and
decisions faster than anyone can read them, and you're the editor, who reads
each draft, marks it up, sends it back for another pass and decides what runs.
Folio is the editor's desk, the other end of the agent's loop:

```
 agent writes / revises ──► Folio: read, mark up, decide
          ▲                              │
          └─────── review notes ◄────────┘
```

The agent edits the files; Folio only reads them, and your notes go back to
the agent with **Copy review notes**.

**Try it in your browser:** the [live demo](https://crazzybot.github.io/folio/demo/)
opens a sample repository of specs and ADRs, with nothing to install. Your
highlights and notes stay in your browser.

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

- Recursive workspace scan — supports sub-folders
- Documents grouped by folder (toggle in the sidebar header, remembered): only folders that hold documents, folder-only chains merged ("api / v2"); the open document's folders expand. Numbered documents (`0015-hmac.md`, `ADR-015-hmac.md`) show their number before the title, and a title that starts with the same number (`ADR 0015: …`) is shown without it. Well-known documents (`README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`…, or any name in capitals like `SPEC.md`) show their name there instead, unless the title only repeats it. A document's status — front matter `status:`, or a `Status:` line or `## Status` section at its start — replaces its icon (accepted or implemented, proposed, rejected, deprecated, superseded or other); rejected, deprecated and superseded titles are dimmed. The hover card adds status, date, decision makers and tags. Above a document with any of these, a line shows them, with "Superseded by ADR-0005" linking to that document. The funnel button in the sidebar header filters the list by status and tags (with counts; any chosen status, and any chosen tag); the filters show as removable chips under the search box, are remembered per workspace, and narrow search and the document count too. Clicking the status above the document opens the note on the document, to suggest another status. Hovering a document or folder (or reaching it with the arrow keys) shows a card with its full title and location, or a folder's document count, and its marks; in the Marks view, a highlight's card shows its passage and note in full. Full keyboard navigation: ↑ ↓ Home End, → ← to expand / collapse, Enter to open, ↓ from the search box into the list
- Focus on a folder: the focus button on a folder row (it appears on hover), a folder in the breadcrumb, or right-click a folder in the desktop app. The list, search and document count narrow to that folder; links and images still resolve across the whole workspace. Clear it with ✕ on the folder bar or Escape in the list; it's remembered per workspace. The desktop app's folder menu also has **Open Folder as Workspace**
- Highlights and notes: select text and pick one of four colours from the toolbar above it (or `⇧⌘H` / `Ctrl+Shift+H` for the last colour), or **Add note** to highlight it and write a note. Click a highlight to change its colour, write or edit its note, or remove it; highlights with a note show an icon in the margin. Hovering a section (heading, paragraph, list item, table, code block) shows a note button in the margin that highlights the whole section and opens its note. Highlights don't overlap: selecting text that is already highlighted opens that highlight instead. Documents with highlights show a count in the list, and the outline shows how many each section has
- Send review notes: the header's clipboard button opens the Send dialog, a list of the open document's notes to tick (the ones not sent yet are ticked), with the exact text in its Text tab. Copying with **Don't send these notes again** (on by default) marks the copied notes as sent, so the next copy doesn't repeat them; **Undo** in the status bar takes it back. Highlights without a note, and notes locked with **Only me**, are private and never sent. The text has the open document's note on the document as a whole (its status change, with the line the status is on, and overall comment — a change the document already has is left out) and its highlights and notes as Markdown for a coding agent (Claude Code, Cursor, …) — each with its file path and line (`/path/to/spec.md:42`), section, quote and note, or `(no comment)` — and copies it. `⇧⌘C` / `Ctrl+Shift+C` (**Edit → Copy Review Notes**) copies the unsent notes without the dialog. Highlights no longer found in the document are left out. In the Marks view, the button on a document's row copies its notes, and the one beside the filter sends the notes the view shows (the focused folder, the filter box and the filter menu apply). Paths are absolute in the desktop app and workspace-relative in the live demo. **Settings → Review notes** changes or turns off the opening instructions for the agent
- Notes on a document as a whole: the header's note button (beside the bookmark) opens an editor for an overall comment and a status to ask for (`accepted`, `rejected`, or any word). The note shows above the document — with "✓ Now accepted · Clear request" once the document has that status — first under the document in the Marks view, and in the hover cards
- Bookmarks: bookmark the document with the header's bookmark button (`⌘D` / `Ctrl+D`), or a section with the button that appears beside a heading on hover
- Marks view (the sidebar's **Marks** tab): the marks of every document in the workspace (or the focused folder), grouped by document — its bookmarked sections by heading, then its highlights and notes — with a filter box and a filter menu (the funnel): show only bookmarks, or only highlights and notes, and notes by state (Open, Sent, Addressed, Resolved, Private; resolved ones are hidden unless picked). **Only the open document** narrows the list to the document you're reading and follows you to the next one; a bar above the filter names it, with ✕ to show every document again. A ★ on a document's row means the document itself is bookmarked. Click one to go to it; Back returns. Highlights whose text was since deleted from the document are shown as not found, and can be removed there. The open document's bookmarked sections show a bookmark icon in its outline
- Marks are kept in `~/.folio` (`%USERPROFILE%\.folio` on Windows), never in your files, and follow the text when the document is edited. The same file has the same marks whichever folder you open
- Moved and deleted documents: marks follow a file moved or renamed without edits by themselves. Otherwise its marks are listed under **Missing documents** in the Marks view, with a suggested document when one with the same name holds most of them, **Move to…** any document, or **Delete** (after asking). Nothing is deleted on its own
- Instant search across titles, filenames and headings — a matching heading opens the document at that section
- Outline of the open document's headings beside it (header toggle, remembered): the section being read is highlighted as you scroll, and clicking a heading jumps there (Back returns). In windows narrower than 960px it slides in from the right as a drawer, and below 768px the document list slides in from the left too; one drawer is open at a time, and it closes once used, on a tap outside it or on Escape
- Find in the open document (`⌘F` / `Ctrl+F`): matches highlighted with a "3 of 12" count; Enter / Shift+Enter, `⌘G` / `⇧⌘G` or F3 / Shift+F3 step through them, Escape closes
- Full-text search on demand (the page icon in the search box, `⇧⌘F` / `Ctrl+Shift+F`, remembered): matching lines appear under each document, and opening one highlights every match in the viewer and scrolls to it
- Resizable / collapsible sidebar (mouse drag, keyboard arrows, `⌘B`)
- VS Code-style light and dark themes with breadcrumb header and status bar
- Display options menu in the header (◐): appearance (System, Light, Dark), document style (Default; Book — serif, airy; Compact — dense), reading width (Narrow, Medium, Wide, Full) and font size (Small, Medium, Large, Extra large). Styles apply to print and PDF too
- Settings panel (`⌘,` / `Ctrl+,`, or the gear in the status bar) for everything above; in the desktop app also the workspace folder, skipped folders, scan depth and editor, kept in sync with `settings.json`
- Custom CSS (desktop): **View → Edit Custom CSS…** opens `custom.css` (created from a commented template), applied on top of the chosen style and reloaded as you save; target the document with `.folio-document`
- GFM support: tables, task lists, strikethrough
- Obsidian vaults: `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `[[#Heading]]` links (resolved by file name anywhere in the workspace, nearest first) and `![[image.png|300]]` image embeds; YAML front matter is hidden, and its `title:` names the document
- Math with KaTeX: `$E=mc^2$` inline (GitHub's rules, so prices like "$5 and $10" stay text), `$$…$$` and ```` ```math ```` blocks
- Mermaid diagrams from ```` ```mermaid ```` blocks, drawn in the current light / dark theme (Mermaid loads only when a document has one). A diagram that sets its own colours (`rect rgb(…)`, `fill:`) or theme (`%%{init: {"theme": …}}%%`) is drawn for the background it was written for, on a card of that background, so its text stays readable in either theme. Hover a diagram and click its expand button (or double-click it) to open it in the whole window, under a title bar with its caption (the diagram's `title`, or the nearest heading) that still drags the window: zoom with the toolbar, ⌘ / Ctrl + scroll, a trackpad pinch or `+` / `-`; pan by dragging, scrolling or with the arrow keys; `0` fits and recentres, `1` shows actual size, Escape closes
- Images from the workspace (`![](img/diagram.png)`, relative to the document) and the web
- Copy button on code blocks (on hover or keyboard focus)
- Links to other files (`[data](report.pdf)`) open in their app on the desktop, or in a new tab in the live demo — documents, data, office files, images and media only; links to scripts, executables, HTML and the like are shown as unavailable
- Syntax-highlighted fenced code blocks (Python, JS/TS, JSON, Bash, CSS, HTML, YAML, Markdown)

---

## Building from source

You only need this to work on Folio; to just use the app,
[download it](#download). Contributions are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md).

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 20.19 (CI uses 24) |
| npm | 10 |

### Quick start

```bash
git clone https://github.com/crazzybot/folio.git
cd folio/desktop
npm install
npm start
```

`npm start` builds the frontend and the main process and launches the app.
Pick the repository's `workspace/` folder when it asks for one: it holds two
sample documents (`welcome.md` and `samples/code-demo.md`).

To work on the frontend in a browser without the desktop app, run the live
demo locally: `npm run demo:bundle` in `desktop/`, then `npm run dev:demo`
in `frontend/`.

> **Self-hosting:** up to version 0.4.0 Folio also ran in the browser from
> a self-hosted server (Python backend and Docker). It was dropped after
> 0.4.0; the [`v0.4.0` tag](https://github.com/crazzybot/folio/tree/v0.4.0)
> has it and its instructions. Its marks (the `marks/` folder in its data
> volume) use the same format as the desktop app's `~/.folio/marks/`, so
> they can be copied across.

---

## Desktop app (Electron)

The `desktop/` package wraps the React frontend in an Electron app. The
workspace scanner and the marks store (`packages/core/`) run in the main
process, reached from the UI over IPC.

```bash
cd desktop
npm install

npm start            # build frontend + main process, launch the app
npm run dist:mac     # package → release/*.dmg and *.zip (also dist:win, dist:linux)
```

On first launch the app asks for a folder of Markdown files; the choice is
remembered. Change it with **File → Open Folder…** (`⌘O`).

The folder is watched while the app is open: saving a document in your editor
updates it in place (keeping your scroll position), and added, renamed or
deleted files show up in the document list right away. Folders in `skipDirs`
are ignored.

**Opening files and folders from the system** — a Markdown file opens in
place when it belongs to the current workspace (so Back returns to where you
were); otherwise its folder becomes the workspace. A folder becomes the
workspace. Any of these work:

- **Finder / Explorer** — Folio registers for `.md` and `.markdown` (and, on
  macOS, folders) as an alternative app: use **Open With → Folio**, or make it
  the default for Markdown files.
- **Drag and drop** a file or folder onto the window (or the Dock icon).
- **Command line** — on macOS, run **Folio → Install 'folio' Command in
  PATH…** once (it writes `/usr/local/bin/folio`, asking for your password if
  needed), then `folio .`, `folio docs/` or `folio README.md`. On Windows and
  Linux, pass the path to the executable. Launching again while Folio is open
  hands the path to the running window.

| Menu item | Shortcut | |
|---|---|---|
| Open Folder… | `⌘O` | Pick the workspace folder |
| Open Recent | | The last 10 workspace folders (missing ones are dropped); **Clear Recently Opened** forgets all but the current one |
| Settings… | `⌘,` | Open the settings panel (also the gear at the start of the status bar): appearance, document style, width, font size, sidebar and outline, and in the desktop app the workspace folder, skipped folders, scan depth, editor and custom CSS. **Open settings.json** at its foot opens the file itself |
| Edit → Copy, Select All | `⌘C`, `⌘A` | The usual; Undo / Cut / Paste aren't shown (there's nothing to edit) but still work in text fields |
| Edit → Find…, Find Next, Find Previous | `⌘F`, `⌘G`, `⇧⌘G` (`Ctrl+F`, `F3`, `Shift+F3`) | Find in the open document |
| Edit → Search Document Text… | `⇧⌘F` | Search all documents' text from the sidebar |
| Open in Editor | `⌘E` | Open the shown document in your editor (also the pencil button in the header); the menu names the editor |
| Reveal in Finder / Show in Folder | `⌥⌘R` / `Shift+Alt+R` | Show the document's file in Finder / Explorer / the file manager |
| Print… | `⌘P` | System print dialog (print layout, no sidebar) |
| Export as PDF… | `⇧⌘E` | Save the current document as a PDF |
| View → Edit Custom CSS… | | Open `custom.css` in the app's data folder in your editor, creating it from a template; saved changes apply immediately |
| View → Appearance | | System (follow the OS), Light or Dark; saved as `theme` in `settings.json`. The header's display options menu (◐) sets the same value |
| Go → Back / Forward | `⌘[` / `⌘]` (`Alt+←` / `Alt+→` on Windows and Linux) | Step through visited documents and headings; also the header's arrow buttons and the mouse's back/forward buttons. History starts afresh when you switch workspace |

**Remembered between launches** — the window's size, position and maximized
state (`window-state.json`; an off-screen position falls back to the
default), and view preferences: sidebar width, folder tree and expanded
folders, outline, reading width, font size, text-search toggle
(`view-state.json`). Both live in the app's data folder next to
`settings.json` and aren't meant for hand-editing. In the live demo, view
preferences are kept in `localStorage`.

**Settings** — `settings.json` (in the app's data folder, e.g.
`~/Library/Application Support/Folio/` on macOS) is applied as
soon as you save it:

```json
{
  "workspace": "/Users/me/notes",
  "skipDirs": [".git", "node_modules", ".venv", "venv", "__pycache__", ".cache", ".local", "…"],
  "maxDepth": null,
  "theme": "system",
  "editor": null
}
```

`skipDirs` are folder names skipped wherever they appear. The default covers
version control, dependencies, virtual environments, caches and tool data:
`.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.cache`, `.local`,
`.tox`, `.nox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.next`,
`.nuxt`, `.svelte-kit`, `.yarn`, `bower_components`, `.terraform`, `Pods`,
`.gradle` (not `dist`, `build`, `vendor` or `target`, which some projects use
for real documentation — add them if yours don't). A list left at an earlier
default is upgraded to this one; a customised list is kept as it is. `maxDepth` caps how
many folder levels below the workspace are scanned (`docs/guide.md` is depth
1, `null` = unlimited). `theme` is `"system"`, `"light"` or `"dark"`. `editor` chooses
the editor for **Open in Editor**: on macOS an app name (`"Visual Studio
Code"`, `"Cursor"`, `"Typora"`…), elsewhere a command on the `PATH`
(`"code"`, `"subl"`…). Left `null`, macOS uses the first of VS Code, Cursor,
Zed, Windsurf, Sublime Text, BBEdit, Nova, Typora, iA Writer and MarkText
that's installed (else the default text editor), and Windows / Linux use the
default app for Markdown files. In the live demo
the appearance, reading width and font size chosen in the display options
menu are remembered in `localStorage`; in the desktop app the reading width
and font size are too.

**Live-reload development** — run the Vite dev server (`npm run dev` in
`frontend/`, port 3000), then `npm run dev` in `desktop/`.

> **Note:** builds are unsigned unless a valid "Developer ID Application"
> certificate is in the keychain. If you launch Electron from a process that
> sets `ELECTRON_RUN_AS_NODE=1` (some editor extensions do), unset it first.

---

## Releasing the desktop app

Releases are built by GitHub Actions (`.github/workflows/release.yml`) and
published as GitHub Releases, where installed copies of Folio look for
updates (**Folio → Check for Updates…**, also checked quietly at launch).

1. With the release notes under `## [Unreleased]` in `CHANGELOG.md`, run from
   a clean, up-to-date `main`:
   ```bash
   node scripts/release.mjs patch   # or minor, major, or a version: 0.4.0
   ```
   It sets the version in `desktop/package.json` and `frontend/package.json`,
   updates their lock files, dates the changelog section, and commits it
   all on a `release-X.Y.Z` branch. Review it, push it and merge it to `main`.
   CI checks that every file has the same version
   (`node scripts/release.mjs --check`).
2. Tag that commit and push the tag:
   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```
3. The workflow checks the tag matches the version, creates a **draft**
   release with generated notes, and uploads:
   - macOS: `Folio-0.2.0-arm64.dmg` (Apple Silicon) and `Folio-0.2.0.dmg`
     (Intel), plus a `.zip` of each for the updater, signed with the
     Developer ID certificate and notarized
   - Windows: `Folio-Setup-0.2.0.exe` (unsigned for now — SmartScreen warns)
   - Linux: an AppImage
   - `latest*.yml` files the updater reads
4. Review the draft on GitHub (replace the generated notes with the version's
   `CHANGELOG.md` entry), then **Publish** it. Installed
   apps see the update from then on.

Signing and notarization use secrets in the repository's `release`
environment (tags `v*` only): `CSC_LINK` (the Developer ID `.p12`,
base64-encoded), `CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8` (the App Store
Connect API key's `.p8` text), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
`.github/workflows/ci.yml` lints, type-checks and tests every push to `main`
and every pull request.

---

## Project structure

```
folio/
├── README.md
├── workspace/                    # two sample documents to try the app on
├── demo/                         # the live demo's sample repository and seed marks
├── tests/fixtures/               # workspace, expected scan and marks for the tests
│
├── packages/core/                # shared by the app and the MCP server
│   └── src/
│       ├── marks.ts              # highlights, notes and bookmarks in ~/.folio
│       ├── markTypes.ts          # the marks' data types, for the browser too
│       ├── reviewNotes.ts        # notes as Markdown for an agent (Copy review notes)
│       ├── scanner.ts            # workspace scanner, ID generation, title extraction
│       ├── settings.ts           # the scan settings other processes read from settings.json
│       └── sourceMap.ts          # where a highlighted quote is in the Markdown source
│
├── packages/mcp/                 # the MCP server (@crazzybot/folio-mcp): review notes for coding agents
│   ├── build.mjs                 # bundles it with the core into dist/folio-mcp.mjs
│   └── src/
│       ├── folio.ts              # what the tools do: documents, notes, replies
│       ├── server.ts             # the three MCP tools and their descriptions
│       └── index.ts              # the folio-mcp command, over stdio
│
├── desktop/
│   ├── package.json              # Electron + electron-builder config
│   ├── scripts/copy-renderer.mjs # copies frontend/dist → desktop/renderer
│   └── src/
│       ├── cli.ts                # macOS: installs the `folio` shell command
│       ├── images.ts             # serves workspace images under app://bundle/@workspace/
│       ├── main.ts               # window, app:// scheme, IPC, menu, PDF export
│       ├── marks.ts              # highlights, notes and bookmarks in ~/.folio
│       ├── openPaths.ts          # paths from the command line, Open With and drops
│       ├── preload.ts            # exposes window.markdownApi
│       ├── recent.ts             # recently opened workspace folders (recent.json)
│       ├── search.ts             # full-text search
│       ├── settings.ts           # settings.json
│       └── watcher.ts            # watches the workspace and ~/.folio/marks for live reload
│
└── frontend/
    ├── package.json              # Vite + React + TypeScript
    ├── vite.config.ts            # manual chunk splitting, the demo build
    ├── tsconfig.json             # strict mode + noUncheckedIndexedAccess
    ├── index.html
    └── src/
        ├── main.tsx              # React root
        ├── types.ts              # DocumentMeta, DocumentContent, marks
        ├── api.ts                # data access: the IPC bridge, or the demo's bundle
        ├── desktop.d.ts          # window.markdownApi type
        ├── demo/                 # the live demo's data source, in the page
        ├── index.css             # design tokens (CSS custom properties)
        ├── App.tsx               # layout, drag-resize, data fetching
        └── components/           # document list, viewer, marks, settings…
```

---

## Development scripts

### Frontend

```bash
cd frontend

npm run dev          # Vite dev server at http://localhost:3000, for the desktop app's live reload
npm run dev:demo     # the live demo at http://localhost:3000 (after npm run demo:bundle in desktop/)
npm run build        # type-check + production bundle → dist/
npm run build:demo   # the live demo → dist-demo/
npm run lint         # ESLint (TypeScript + React hooks rules), no warnings allowed
npm test             # Vitest: links, wiki links, math dollars, diagram themes
```

### Desktop

```bash
cd desktop

npm test             # Vitest: search, images, paths, file watchers
```

### Core

```bash
cd packages/core

npm test             # Vitest: scanner, marks store, locating quotes in the source
```

### MCP server

```bash
cd packages/mcp

npm test             # Vitest: the tools, over a temporary workspace and data folder
npm run build        # bundle → dist/folio-mcp.mjs
node dist/folio-mcp.mjs --root ../../workspace   # serve over stdio, as an agent starts it
```

### Tests

`tests/fixtures/workspace/` is a small workspace for the core and desktop tests, and
`tests/fixtures/expected-scan.json` is what scanning it must produce
(document IDs, titles, headings, images). Document IDs are part of deep
links, so change the expected output only deliberately, when the scanning
rules change.

---

## Security

Markdown files are treated as untrusted — a workspace may contain cloned
repositories or vendored packages.

- **Rendering** — raw HTML in documents is filtered through GitHub's
  allow-list (`rehype-sanitize`): no scripts, event handlers, styles, frames,
  forms, `<meta>`/`<base>` or `javascript:` URLs. A Content-Security-Policy
  (set by the desktop app's `app://` handler) is the second layer.
- **Files** — only `.md`/`.markdown` files inside the workspace are served,
  by ID rather than path; symlinks pointing outside the workspace are ignored.
  Images and linked files are served by path, but only allowlisted types
  (images; documents, data, office files and media — never HTML, scripts,
  executables, launchers, archives or macro-enabled Office files) inside the
  workspace and outside skipped folders, with a sandboxing CSP so nothing
  served can run scripts. The desktop app opens linked files in their default
  app under the same allowlist, checked again after resolving symlinks.
- **Highlights** — kept in `~/.folio`, never in the workspace, which Folio
  still never writes to. A damaged marks file, or one written by a newer
  Folio, is left untouched.
- **Desktop** — context isolation and sandboxing, IPC limited to the app's own
  page, external links opened only for `http(s)`/`mailto`, all permission
  requests denied, and Electron fuses (no `ELECTRON_RUN_AS_NODE`,
  `NODE_OPTIONS` or `--inspect`; ASAR integrity checks) in packaged builds.

---

Found a vulnerability? Please report it privately, as described in
[SECURITY.md](SECURITY.md).

---

## Contributing

Bug reports, ideas and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks and conventions. This
project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

[MIT](LICENSE) © 2026 Alexei Pogrebtsov

Folio includes open-source software under its own licenses. Every build
writes their notices to `third-party-licenses.txt` next to the app (desktop:
**Help → Third-Party Licenses**; live demo: **Settings →
Third-party licenses**), from the packages actually in the build
(`frontend/scripts/licenses.mjs`). CI fails when a production dependency's
license isn't on the allow-list there (`frontend/scripts/check-licenses.mjs`).
