# What is Folio?

Folio is a desktop app for reading and reviewing folders of Markdown:
specs, architecture decision records (ADRs), design proposals and research.
It's the other end of your coding agent's loop: the agent writes the
documents, and you read them, mark them up and send your notes back. It's
free and open source, for macOS, Windows and Linux.

## Who it's for

Folio is for anyone who has to read documents closely rather than write
them:

- **Architects.** A project's `docs/` folder grows faster than anyone reads
  it. Folio shows which decisions are accepted, proposed or superseded, and
  lets you answer the open ones and mark what needs another pass.
- **Product creators.** Review and approve the spec before anything is
  built. With a coding agent, you can take a small project from spec to
  prototype without leaving Folio (below).
- **Developers new to a project.** Read what was decided and why before you
  change the code. See [Getting to know a project's docs](./new-to-a-project).

Folio also reads Obsidian vaults: wiki links, embeds and front matter work
as they do in Obsidian.

## Two ways to use it

- **Review documents.** Read specs, ADRs and research, mark them up, and
  send your notes to the agent that wrote them. Its replies and its own
  questions come back beside the passages they're about. See
  [Reviewing specs with a coding agent](./review-loop).
- **Prototype from the spec.** For a small project or a proof of concept,
  the whole cycle runs through the documents: the agent drafts the spec and
  plan, you decide, it implements the plan, and you change the code by
  changing the spec. See [From spec to prototype](./prototype).

Either way, Folio shows the documents, not the code: code review stays in
your editor or the pull request.

<!-- TODO: a short example of a real review session, with a screenshot -->

## What it does

- Lists every Markdown file in a folder and its sub-folders, with search
  across titles, headings and full text.
- Renders documents properly: tables, task lists, syntax-highlighted code,
  math and Mermaid diagrams.
- Reads each document's status and tags from its front matter or `Status:`
  line, and filters by them.
- Lets you highlight passages, write notes, give a verdict on a whole
  document and bookmark sections, then find every mark in one list.
- Copies your notes as Markdown for a coding agent, each with its file path
  and line, or sends them to the agent, and shows its replies and its own
  questions next to the passages they're about.
- Runs Claude Code in a panel beside your documents (desktop).

## What it doesn't do

- **It never edits your files.** Folio is a reader. Marks are kept in
  Folio's own folder, not in your documents. See the [FAQ](../faq).
- **It isn't an editor.** Use your usual editor to change a document;
  **File → Open in Editor** (`⌘E` / `Ctrl+E`) opens it there, and Folio
  shows the change as you save.
- **It isn't a sync or collaboration service.** Marks stay on your computer.

## Try it before installing

The [live demo](https://crazzybot.github.io/folio/demo/) opens a sample
repository of specs and ADRs in your browser, with nothing to install. Your
highlights and notes stay in that browser.
