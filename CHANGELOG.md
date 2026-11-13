# Changelog

Notable changes to Folio. Versions follow [Semantic Versioning](https://semver.org);
the desktop app and frontend share one version number.

Changes go under **Unreleased** as they're merged; `node scripts/release.mjs`
turns them into the next release's section.

## [Unreleased]

## [0.6.0] — 2026-11-13

### Added

- **Well-known documents** (`README.md`, `AGENTS.md`, `CLAUDE.md`,
  `CHANGELOG.md`…, or any name in capitals like `SPEC.md`) show their name
  before the title in the document list, so an `AGENTS.md` and a `CLAUDE.md`
  with the same title are told apart. A title that only repeats the name
  (`# Changelog`) is shown alone.
- **Replies on notes.** A note's popover, and the note on a document, show
  its replies: a coding agent's, through Folio's MCP server, and your own.
  **Reply** answers it; the note is open again, to go with the next round.
  Replies you haven't read put a dot on the note's margin icon and a
  **New reply** label in the Marks view, and the status bar says "Claude
  Code replied to 3 notes"; click it to go to each in turn.
- **Claude Code plugin.** `/plugin marketplace add crazzybot/folio`, then
  `/plugin install folio@folio`, sets up Folio's MCP server in Claude Code
  and adds **/folio:review**: the agent gets your review notes, revises the
  documents, and answers each note in Folio.
- **Settings → Coding agents** in the desktop app: the two lines that
  install the Claude Code plugin, and the MCP settings for Cursor, Codex and
  other agents, each with a **Copy** button.

## [0.5.0] — 2026-11-12

### Added

- **Sending notes.** Copy review notes opens the **Send dialog**: the notes
  as a list to tick, grouped by document, with the exact Markdown in its
  **Text** tab. Notes not sent yet are ticked; with **Don't send these notes
  again** (on by default) copied notes become **sent** and aren't ticked next
  time, so a second round doesn't repeat the first. Sent notes are offered
  under **Sent before**; **Undo** in the status bar takes a send back.
  `⇧⌘C` / `Ctrl+Shift+C` copies the open document's unsent notes.
- **Private marks.** A highlight without a note stays yours and is never
  sent; **Only me** keeps a note out too, and **Send to agent** sends a bare
  highlight. On a document's note, Only me keeps the comment back (a status
  change is still sent).
- **Note states** in the popover (**Mark not sent**, **Resolve**, **Reopen**)
  and in the margin icon's shape: unsent, sent (with a dashed underline on
  the passage), addressed, resolved (lighter paint), private. The Marks view
  sums up each document ("2 unsent · 1 sent").
- **One filter menu in the Marks view**, like the document list's: show
  bookmarks or highlights and notes (in place of the **Notes only** switch,
  which also hid highlights without a note), and notes by state (resolved
  ones hidden unless picked). The document list's filter and Group by folder
  moved beside its search box, as in the Marks view.
- **Only the open document** in the Marks view's filter menu: the list
  follows the document you open, named in a bar above the filter with ✕ to
  show every document's marks again.

### Removed

- **The self-hosted browser version** (the Python backend and the Docker
  setup). Folio is the desktop app, plus the live demo on the website.
  Self-hosting stays available at the `v0.4.0` tag, and its marks (the
  `marks/` folder in its data volume) can be copied into `~/.folio/marks/`
  to keep them in the desktop app.

## [0.4.0] — 2026-11-09

### Added

- **Document status, dates, decision makers and tags**, read from front
  matter (`status:`, `date:`, `decision-makers:` / `deciders:`, `tags:`) or
  from a `Status:` line or `## Status` section at the start of a document,
  as ADR templates write them. A document's status replaces its icon in the
  list (accepted or implemented, proposed, rejected, deprecated, superseded
  or other), and rejected, deprecated and superseded titles are dimmed. A
  line above the document shows them all, and "Superseded by ADR-0005"
  links to that document. (#80)
- **Filter by status and tags**: the funnel button in the sidebar header
  lists the statuses and tags in the workspace or focused folder, with
  counts. Chosen filters show as removable chips under the search box,
  narrow the list, search and the document count, and are remembered per
  workspace. (#80)
- **Numbered documents** (`0015-hmac.md`, `ADR-015-hmac.md`) show their
  number before the title, and a title that repeats it (`ADR 0015: …`) is
  shown without it. (#80)
- **Hover cards** in the document list and the Marks view: a document's full
  title, location, status, date, decision makers, tags and marks; a
  folder's document count; a highlight's passage and note in full. Arrow
  keys show them too. (#80)
- **Notes on a document as a whole**: the note button beside the bookmark,
  or clicking the document's status, opens an editor for an overall comment
  and a status to ask for (`accepted`, `rejected` or any word). The note
  shows above the document, with "✓ Now accepted" once the document has
  that status, and first under the document in the Marks view. Folio still
  never edits the document: **Copy review notes** starts with the status
  change, naming the line it's written on, and the comment, for the agent
  that wrote it to make the change. (#81, #83)
- **Notes from the margin**: hovering a heading, paragraph, list item,
  table or code block shows a note button in the right margin, which
  highlights the section and opens its note. (#83)
- **Narrow windows and phones**: below 960px wide the outline slides in as a
  drawer from the right, and below 768px the document list slides in from
  the left too, instead of taking room from the document. A drawer closes
  once used, on a tap outside it or on Escape. (#82)

### Changed

- Highlights no longer overlap: selecting text that's already highlighted,
  or `⇧⌘H` on it, opens that highlight instead. Its popover is wider when it
  has a note, and opens above the highlight when there's no room below. (#83)
- A folder holding a single document stays a folder in the tree, rather
  than being replaced by the document. (#80)
- **Group by folder** and the outline button show when they're on. (#80)

### Fixed

- Adding a note near the bottom of the window no longer scrolls the
  document away. (#83)
- Page height follows mobile browsers' toolbars, so the status bar stays on
  screen. (#82)

## [0.3.2] — 2026-11-08

### Fixed

- **Check for Updates…** tries once more when GitHub can't be reached, and
  if it still can't, says so in plain words instead of showing only an error
  code such as `net::ERR_TIMED_OUT`.
- Updates download in full straight away. They used to try fetching only the
  changed parts first, which GitHub's download server refuses, so every
  update made a failed attempt before the full download.

## [0.3.1] — 2026-11-08

### Fixed

- The license notices of the open-source software Folio includes now ship
  with it: **Help → Third-Party Licenses** in the desktop app, **Settings →
  Third-party licenses** in the browser version. They were missing because
  bundling drops the notices from the code. (#74)

## [0.3.0] — 2026-11-08

### Added

- **Copy review notes**: a document's highlights and notes as Markdown to
  paste into a coding agent such as Claude Code or Cursor. Each note has the
  file's path and line, the section it's in, the quote and your comment (or
  `(no comment)`). The header button shows a preview of the exact text
  first; `⇧⌘C` / `Ctrl+Shift+C` (**Edit → Copy Review Notes**) copies
  straight away. In the Marks view, copy one document's notes or everything
  the view shows (filter and **Notes only** apply). The opening instructions
  for the agent can be changed or turned off in **Settings → Review notes**.
  Copying changes no marks. (#62)

### Changed

- The project moved to [github.com/crazzybot/folio](https://github.com/crazzybot/folio).
  Updates now come from there; earlier versions find them through GitHub's
  redirect from the old address. (#65)

## [0.2.0] — 2026-11-07

### Added

- **Folder focus**: narrow the list, search and document count to one folder —
  the focus button on a folder row, a folder in the breadcrumb, or right-click
  a folder in the desktop app. Links and images still resolve across the whole
  workspace. Remembered per workspace; clear it with ✕ or Escape. The desktop
  app's folder menu also has **Open Folder as Workspace**. (#53)
- **Highlights and notes**: select text and pick one of four colours, or
  **Add note**. `⇧⌘H` / `Ctrl+Shift+H` highlights in the last colour. The list
  and outline show how many highlights each document and section has. (#54, #55)
- **Bookmarks** for a document (`⌘D` / `Ctrl+D`) or one of its sections. (#55)
- **Marks view**: the sidebar's **Marks** tab lists every highlight, note and
  bookmark in the workspace or focused folder, with a filter and a
  **Notes only** switch. (#55)
- **Moved and deleted documents** keep their marks: a file moved or renamed
  without edits takes its marks with it; otherwise they're listed under
  **Missing documents**, with a suggested match, **Move to…** or **Delete**. (#58)

Marks are kept in `~/.folio` (`%USERPROFILE%\.folio` on Windows), never in your
files, and the same file has the same marks whichever folder you open. The
browser version stores them in `MARKDOWN_DATA_DIR`; Docker Compose puts it on
the `folio-data` volume.

### Fixed

- The highlight popover stays inside the viewer. (#56)
- Document titles are taken from HTML headings too. (#52)

### Changed

- KaTeX loads only for documents that may contain math, so other documents
  open faster. (#50)
- Built with React 19, Vite 8, TypeScript 6 and ESLint 10. (#44, #45, #48, #51)

## [0.1.0] — 2026-11-06

First release: signed and notarized macOS builds (Apple Silicon and Intel),
Windows and Linux builds, and in-app updates.

[0.6.0]: https://github.com/crazzybot/folio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/crazzybot/folio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/crazzybot/folio/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/crazzybot/folio/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/crazzybot/folio/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/crazzybot/folio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/crazzybot/folio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/crazzybot/folio/releases/tag/v0.1.0
