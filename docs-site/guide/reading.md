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

## New and changed documents

Folio remembers which version of each document you last read. A dot after a
document's title means it changed since you read it; a ring means it's new.
Folders show how many unread documents they hold, and the **Documents** tab
shows the total. Hover a document to see since when: "Changed since you read
it on 3 Nov", or "New since you last looked". **Unread** in the filter menu
lists only those documents.

A document counts as read once it has been on screen for 3 seconds, with the
window in front. The first time you open a workspace, everything in it
counts as read, so the list doesn't start out all new. A version you've read
before counts as read when it comes back, so switching git branches doesn't
mark documents unread.

A changed document opens with a banner above it: since when, how many
sections changed, and which ones, each a link to its section. Added sections
are marked "(new)", and removed ones are struck through. The banner stays
until you open another document, even once the document counts as read.
**Mark as Read** is there while it's unread; ✕ closes the banner.

In the desktop app, right-click a document for **Mark as Read** or **Mark as
Unread** (back to the version you read before), or a folder for **Mark All
as Read**. Folio keeps the versions you read in `~/.folio`, compressed, to
compare with.

## Git branches

In the desktop app, when the workspace is in a git repository, the status
bar shows the open document's branch, and the branch it's compared with:
`feature/x → main`. When the workspace holds several repositories, it starts
with the repository's name (`api · feature/x → main`), since the open
document may not be in the repository the list shows.

Click the branch for the repository's worktrees (choose one to open it as
the workspace), **Copy Branch Name**, and **Compare With**, the branch yours
is compared with. Folio picks `origin`'s default branch, else `main` or
`master`; choose another there, and Folio remembers it for the repository.
For a repository inside the workspace, right-click its folder for **Compare
With** too.

Documents changed on your branch show a letter after their title: **A** for
added, **M** for modified. The letter is in italics when the document has
changes that aren't committed yet. Hover a document to see what changed it
("Modified on feature/x since main"), the last commit that touched it, and
"with Claude" when Claude co-wrote it. A folder's hover card names its
branch and what it's compared with.

In a workspace of several repositories, a folder that holds one shows a
branch icon when that repository isn't on its base branch, and a worktree
icon when it's a linked worktree.

The filter menu lists only the changed documents. When the list shows one
repository, the filter says what it compares with: **Changed since main**,
or **Uncommitted changes** on the base branch itself.

Folio only reads git; it never changes anything in the repository.

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
