# Reading a folder of docs

## The document list

Documents are grouped by folder; the toggle in the sidebar header switches
grouping on and off. Numbered documents such as `0015-hmac.md` show their
number before the title. Well-known documents (`README.md`, `AGENTS.md`,
`CLAUDE.md`, `CHANGELOG.md` and the like, or any name in capitals such as
`SPEC.md`) show their name before the title, so an `AGENTS.md` and a
`CLAUDE.md` with the same title are told apart. A title that only repeats the
name, such as `# Changelog`, is shown alone. Hover a document to see its full
title, location, status, tags and marks.

In the desktop app, right-click a document to open it in your editor (the
menu names it, such as **Open in Visual Studio Code**) or **Reveal in
Finder** (**Show in Folder** on Windows and Linux). A folder's menu has
**Reveal in Finder** too, and **Open Folder as Workspace**.

## Statuses and tags

Folio reads a document's status from front matter `status:`, or a `Status:`
line or `## Status` section at its start. The status replaces the document's
icon in the list. Rejected, deprecated and superseded documents are dimmed.

The funnel button in the sidebar header filters the list by status and tags.
The filters are remembered for each workspace.

<!-- TODO: front matter example, and how "Superseded by" links work -->

## Focus on a folder

To read only part of a large workspace, click the focus button on a folder
row (it appears on hover), or a folder in the breadcrumb. The list, search
and document count narrow to that folder. Clear it with ✕ on the folder bar,
or Escape in the list.

## Search

- **Titles, filenames and headings:** type in the search box. A matching
  heading opens the document at that section.
- **Full text:** click the page icon in the search box (`⇧⌘F` /
  `Ctrl+Shift+F`). Matching lines appear under each document.
- **Within the open document:** `⌘F` / `Ctrl+F`.

## Display options

The ◐ menu in the header sets the appearance (System, Light, Dark), the
document style (Default, Book, Compact), reading width and font size.
