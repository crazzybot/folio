# Changelog

Notable changes to Folio. Versions follow [Semantic Versioning](https://semver.org);
the desktop app and frontend share one version number.

Changes go under **Unreleased** as they're merged; `node scripts/release.mjs`
turns them into the next release's section.

## [Unreleased]

### Added

- **Questions from the agent:** a coding agent can put its questions on the
  passages they're about, as notes, with Folio's MCP server
  (`folio_add_notes`). A decision shows its options as buttons: pick one
  or not, write a reply if you like, and **Save** or **Send** it. The
  agent can also ask you to choose in a reply, on any note.
- Folio's Claude Code plugin has `/folio:draft`: the agent writes the
  documents you ask for and puts every open question on its passage, then
  waits for your review. `/folio:review` and `/folio:review-loop` ask their
  questions the same way.
- New questions from the agent show in the status bar ("Claude Code asked
  3 questions": click to open each in turn), on the Dock icon and in a
  notification. The **Documents** list counts the questions waiting on you,
  and the **Marks** view's filter has **The agent's notes**.

### Fixed

- The window no longer goes blank when the agent replies to a note whose
  popover is open, as after **Send** in a review loop.

## [0.11.0] — 2026-11-23

### Added

- **Agent panel:** Claude Code in a terminal below your documents, started
  in the workspace. Open it with **View → Toggle Agent Panel** (⌘J /
  Ctrl+J) or the status bar's terminal button, or start it in one folder
  with **Open Agent Here** in the folder's menu. Hiding the panel keeps the
  session running; **Restart** starts a new one.
- The agent panel offers the review loop's command (`/folio:review-loop`)
  to copy and paste into the session; Folio never types into it. Its
  header then shows when Claude is waiting for your notes or working on
  them. On Windows, this needs Folio's MCP server 0.4.2 or later.
- When Claude Code isn't installed, or your shell can't find `claude`, the
  agent panel says so and links to its install guide.

### Changed

- **Send** (was **Save and Send**) keeps a note's popover open, with the
  note on the document, as in a chat: it shows the note waiting for the
  agent, then the agent working on it, and its reply as soon as it comes.
  With an agent Live, **Send** is the main button and **Save** keeps the
  note for the next round.
- A note's popover and the note on the document have a **×** to close
  them, as a click elsewhere does.
- **Live** has one place: the status bar's pill shows every agent waiting
  for your notes, whatever the sidebar shows, and its menu ends each loop,
  or all of them. A folder an agent works in gets a green dot instead of a
  pill of its own.
- The status bar is a little taller (28 px), with 16 px icons on its
  buttons, as in VS Code.
- The highlight counts in the **Documents** list and the outline leave out
  resolved notes, as the **Marks** view does. A document's hover card
  still mentions them.

### Fixed

- **Resolve**, **Unresolve** and **Mark not sent** in a highlight's popover
  now close it, as they do on the document's note.
- The find bar (⌘F / Ctrl+F) is no longer hidden under the document's
  summary pinned to the top of the view.
- When you answer the agent's question and it records your answer in the
  document, it now marks the note **Addressed**, and its reply says what
  it changed. It no longer says "resolved", which only you do in Folio.
- Interrupting the agent while it waits for your notes (Esc in Claude Code)
  now ends the review loop in Folio at once: the **Live** pill goes away,
  instead of staying for up to five minutes. Needs Folio's MCP server
  0.4.1 or later.
- With a folder focused, the Marks view's **Missing documents** lists only
  that folder's, like the rest of the view. A line under them says how
  many are in other folders, with **Show All Documents**.

## [0.10.0] — 2026-11-19

### Added

- **Notes stay in their section.** When an edit rewrites or removes the
  passage a note is on, the note moves beside the heading of the section
  the passage was in, instead of going under **Not found in the current
  text**. Its popover shows the old passage struck through. Review notes
  tell the agent which section such a note is in.
- **The agent can say what replaced a passage.** `folio_reply` takes the
  new text as `passage`. Folio highlights it in place of the old one and
  shows the old text under **Before the edit** in the note's popover.

### Changed

- **What changed stays in sight.** Above a document, under its status, your
  note on it, the sections that changed since you read it, and the notes no
  longer found in its text each have a card. Notes not found are listed
  one per line, with the start of each note. Once you scroll past it, a summary line stays
  at the top of the view: the status, your note's icon, the changed
  sections and how many notes weren't found. Click the arrow at its end to
  see the whole header there.
- A resolved note on the document is no longer shown above it. It stays in
  the **Marks** view. **Clear request** is gone: a status you asked for and
  the document now has is no longer sent anyway.
- The note-on-the-document button is a page with a speech bubble, so it no
  longer looks like the **Send review notes** button beside it.
- New replies stand out in the status bar: in "Claude Code replied to 3
  notes", the count is a blue pill.
- Once a document has the status your note asked for, its header no longer
  says "✓ Now accepted": the status has a **New** label until you open the
  note.
- **Clearer note actions.** **Reply** shows only under the agent's answer;
  until it answers, you edit your note or your latest reply. To take up an
  addressed or answered note again, reply: **Reopen** is gone, and so is
  **Mark not sent** on an answered note. **Unresolve** puts a resolved note
  back where it was, **Addressed** for example, instead of making it **Not
  sent**.

### Fixed

- Quitting Folio ends the review loop: an agent waiting for your notes stops
  and tells you Folio was closed. Opening a workspace that doesn't hold the
  agent's folder ends it too. Before, the agent kept waiting for notes that
  could no longer come.
- In the note on a document, the **Status** list no longer starts with "No
  change (now accepted)". The document's own status is in its place,
  marked **(current)**: pick it to leave the status as it is.
- Editing a sent note makes it **Not sent** again, so the new wording goes
  with the next round. Before, it stayed **Sent**, and an agent that already
  had it never saw the change. The same goes for the comment or the status
  asked for in the note on a document.

- Clicking the note on a document in the **Marks** view goes to the top of
  the document and opens the note.
- New replies to the note on a document show a dot on its icon above the
  text, and on the note button in the header.

## [0.9.1] — 2026-11-18

### Changed

- **Clearer statuses.** Folio knows three more statuses: `draft`,
  `in-progress` and `deferred`. `implemented` has its own icon, so it's no
  longer shown as `accepted`. `proposed` is now a circle with a dot, and the
  half-filled circle means `in-progress`. Common other words, such as
  `approved`, `done` or `on hold`, take the matching icon and are shown as
  written.

## [0.9.0] — 2026-11-16

### Added

- **Notes on deleted passages.** When a highlighted passage is no longer in
  the document, for example because your agent removed it as you asked, the
  highlight is listed above the text under **Not found in the current
  text**. Click it to read the conversation, reply, resolve or remove it.
  Clicking it in the **Marks** view, or the status bar's **… replied to**
  link, opens it there too. Before, its replies couldn't be read.

### Fixed

- **Notes the agent answered.** When your agent replies to a note without
  changing the document, with a question or why it left the text as it
  was, the note now shows **Answered by Claude Code**, with **Resolve**.
  Before, it said **Not sent**, and the next round sent it to the agent
  again. Your reply sends it again, as before.

## [0.8.0] — 2026-11-15

### Added

- **Review loop with your agent.** Ask your agent to wait for your review
  (`/folio:review-loop` in Claude Code) and it waits for notes from Folio.
  In the **Send review notes** dialog, **Send** hands the ticked notes
  straight to it; there's nothing to paste. The agent addresses them,
  replies to each in Folio, then waits for the next round. Folio's MCP
  server has a new tool for this, `folio_wait_for_review`. It only takes
  notes on documents in the folder the agent works in.

- **Live** (desktop). A green **Live** pill shows where an agent is
  waiting for your notes: on its folder in the document list, on a
  focused folder, or in the status bar when it works on the whole
  workspace. The **Send review notes** dialog shows it too, and names the
  agent the notes go to; **Copy** is still there for pasting elsewhere.
  **End Review Loop**, in the folder's context menu or on the status bar's
  pill, tells the agent to stop waiting.

- **Picked up.** Once the agent takes notes you sent, they show it: "Sent ·
  Claude Code has it" in the note's popover and on the note on the
  document, and "Claude Code is working on it" in the Marks view. Until
  then they're still waiting for the agent.

- **Save and Send** (desktop). With an agent Live on the document, the
  note editor and the reply box have **Save and Send** (`⇧⌘↩` /
  `Ctrl+Shift+Enter`): that one note goes to the agent at once, without the
  **Send review notes** dialog.

- **Know when the agent replied** (desktop). While you're in another app,
  a system notification says when an agent answers your notes ("Claude
  Code replied to 4 notes"); click it to come back to Folio with the first
  of those notes open. The Dock icon shows how many notes have replies you
  haven't read yet. In the status bar, **Claude Code replied to …** opens
  the next one: a highlight's note with its thread, or the note on the
  document.

- **Edit or delete your reply.** Your latest reply to a note has an
  **Edit** link until someone answers it. The note opens again, so the new
  wording goes with the next round. Until it's sent, it has **Delete** too:
  the note goes back to how it was before, **Addressed** for example.

### Changed

- **A note with replies reads as one conversation.** The note is the
  thread's first message and scrolls with the replies, instead of staying
  on top. What was answered can't be edited: only your latest reply, until
  someone answers it.
- **Conversations open at the latest message**, and scroll down when a
  reply comes in.
- **The note on the document works like a highlight's note.** Its dialog
  is wider, and **Only me** is a lock at the bottom, beside where the note
  is in the review loop (**Not sent**, **Sent**, **Addressed**,
  **Resolved**). Highlights show **Not sent** too. **Save** waits until
  you change something; **Save and Send** until there's something to send.
  The reply box's button says **Save** whether an agent is Live or not.
- **Replies show their formatting.** Messages in a note's thread render
  their Markdown (bold, lists, code, quotes), each in its own box. Links
  and images aren't opened or loaded.

### Fixed

- The **Send review notes** dialog gives a note's replies too, so the agent
  gets the whole thread after you answer it, not just the first comment.
  In the **List** view, a note with replies says so under it, such as
  "↳ 3 replies · latest from Claude Code, 10:02".

- A task list item with more than one paragraph, or a code block, shows its
  content stacked under the checkbox. Before, each part was squeezed into a
  narrow column side by side.

## [0.7.0] — 2026-11-14

### Added

- **Changed on this branch** (desktop). Documents changed on your git
  branch show **A** (added) or **M** (modified) after their title, in
  italics when the change isn't all committed. **Changed on this branch**
  in the filter menu lists only those. A document's hover card shows the
  last commit that touched it, and "with Claude" when Claude co-wrote it.
  The branch menu's **Compare With** chooses the branch yours is compared
  with, remembered for each repository; a nested repository's folder has it
  in its context menu too. The status bar, the hover cards and the filter
  name that branch ("feature/x → main", "Changed since main"), and the
  status bar names the repository when the workspace holds several.

- **Open and reveal files from the document list** (desktop). Right-click
  a document for **Open in Editor**, named after your editor (**Open in
  Visual Studio Code**), and **Reveal in Finder** (**Show in Folder** on
  Windows and Linux). Right-click a folder for **Reveal in Finder** too.

- **What changed since you read it.** A changed document opens with a
  banner above it: since when, and which sections changed, were added or
  were removed, each a link to its section. **Mark as Read** is there while
  it's unread, and the banner stays until you open another document. Folio
  keeps the version you last read (in `~/.folio/snapshots`, compressed) to
  compare with, and deletes versions nothing points at any more when it
  starts.
- **New and changed documents.** A dot after a document's title shows it
  changed since you read it, and a ring shows it's new. Folders show how
  many unread documents they hold, and the **Documents** tab shows the
  total. **Unread** in the filter menu lists only those. A document counts
  as read once it has been on screen for 3 seconds. In the desktop app,
  right-click a document for **Mark as Read** or **Mark as Unread**, or a
  folder for **Mark All as Read**. The first time you open a workspace,
  everything in it counts as read. A version you've read before counts as
  read when it comes back, so switching git branches doesn't mark
  documents unread.
- **Git branches and worktrees** (desktop). The status bar shows the branch
  of the open document's repository, or the commit when it's detached, and
  a worktree icon in a linked worktree. Click it for the repository's
  worktrees, to open one as the workspace, and **Copy Branch Name**. In a
  workspace of several repositories, a folder that holds one shows a branch
  icon when that repository is off its main branch, and a folder's hover
  card names the branch it's on. Folio only reads git; it never changes
  anything.
- **Marks of documents on another branch** are kept apart. After switching
  branches, a document that exists only on another branch is listed under
  **On other branches** in the Marks view, not **Missing documents**: its
  marks aren't moved or matched to another document, and they're back when
  you switch back. Folio's MCP server leaves them alone too.
- **Replies under inline notes.** With notes shown in the text (`⌥⌘N` /
  `Ctrl+Alt+N`), a note with replies has a line under it: how many, and
  who wrote the latest and when, with a **New** label when there are
  replies you haven't read. Click it to read the thread.
- **Images open in the whole window**, like Mermaid diagrams: hover an
  image and click its expand button, or double-click it, to zoom and pan.
  The title bar shows the document's title and the image's alt text.
  Small images, such as badges, and images inside links don't open.

### Changed

- In a note's replies, the author's name (**You**, **Claude Code**) is
  bold, so each turn of the conversation stands out.

- A folder's hover card shows its branch as a pill, with a worktree icon
  in a linked worktree. A document's hover card sets its change on the
  branch apart, with the **A** or **M** badge in the list's colours.

- **Settings → Review notes** is kept in `settings.json` in the desktop app
  (`reviewIntroOn`, `reviewIntro`), so Folio's MCP server starts the notes
  it gives an agent the same way. What you set in an earlier version is
  moved there.

### Fixed

- Headings with the same text (an **Added** under each release) are told
  apart: the outline highlights only the one you're reading, and clicking
  one goes to it. As on GitHub, repeats get numbered anchors (`#added-1`).

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

[0.11.0]: https://github.com/crazzybot/folio/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/crazzybot/folio/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/crazzybot/folio/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/crazzybot/folio/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/crazzybot/folio/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/crazzybot/folio/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/crazzybot/folio/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/crazzybot/folio/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/crazzybot/folio/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/crazzybot/folio/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/crazzybot/folio/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/crazzybot/folio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/crazzybot/folio/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/crazzybot/folio/releases/tag/v0.1.0
