# What is Folio?

Folio is a desktop app for reading and reviewing folders of Markdown: specs,
architecture decision records (ADRs), design proposals, notes and Obsidian
vaults. It's free and open source, for macOS, Windows and Linux.

## Who it's for

Folio is for anyone who has to read documents closely rather than write them:

- **Reviewers of specs and ADRs.** A project's `docs/` folder grows faster
  than anyone reads it. Folio shows which decisions are accepted, proposed or
  superseded, and lets you mark what needs another pass.
- **People working with coding agents.** Agents write specs, plans and
  decisions quickly. Folio is where you read them, mark them up and send your
  notes back. See [Reviewing specs with a coding agent](./review-loop).
- **Obsidian users** who want a reader for their vault: wiki links, embeds
  and front matter work as they do in Obsidian.

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
  and line.

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
