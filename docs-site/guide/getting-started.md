# Getting started

## Install

Download Folio from the [download page](https://crazzybot.github.io/folio/download.html)
or from [GitHub Releases](https://github.com/crazzybot/folio/releases/latest).

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `Folio-<version>-arm64.dmg` | Signed and notarized |
| macOS (Intel) | `Folio-<version>.dmg` | Signed and notarized |
| Windows | `Folio-Setup-<version>.exe` | Not code-signed yet: SmartScreen shows a warning, choose **More info → Run anyway** |
| Linux | `Folio-<version>.AppImage` | `chmod +x` it, then run it |

Folio checks for updates at launch. To check by hand, use **Folio → Check
for Updates…** on macOS, or **Help → Check for Updates…** on Windows and
Linux.

## Open a folder

1. Choose **File → Open Folder…** (`⌘O` / `Ctrl+O`).
2. Pick the folder that holds your documents: a project's `docs/` folder,
   the whole repository, or an Obsidian vault.
3. Folio lists every Markdown file in it, sub-folders included.

<!-- TODO: screenshot of a freshly opened workspace, with the parts labelled -->

Folio remembers the folder, and **File → Open Recent** lists the last 10.
It watches the folder while it's open: save a document in your editor and
Folio shows the change in place, keeping your scroll position. New, renamed
and deleted files show up in the list right away.

## Open files and folders from your system

A folder you open becomes the workspace. A Markdown file opens in place
when it's in the current workspace; otherwise its folder becomes the
workspace.

- **Finder or Explorer:** right-click a `.md` file (or, on macOS, a folder)
  and choose **Open With → Folio**. You can also make Folio the default app
  for Markdown files.
- **Drag and drop:** drop a file or folder onto Folio's window, or onto its
  Dock icon.
- **Command line:** on macOS, choose **Folio → Install 'folio' Command in
  PATH…** once. Then run `folio .`, `folio docs/` or `folio README.md`. On
  Windows and Linux, pass the path to Folio's executable. If Folio is
  already open, the path opens in its window.

## Find your way around

- **Sidebar, left:** the document list, with a search box above it, and the
  **Marks** tab with every highlight, note and bookmark.
- **Document, centre:** the open document, with its status and tags above it.
- **Outline, right:** the open document's headings. The section you're
  reading is highlighted as you scroll.

In a window narrower than 960px, the outline slides in from the right when
you open it. Below 768px, the document list slides in from the left too.

## Next steps

- [Reading a folder of docs](./reading): search, filters and focusing on one
  folder.
- [Highlights, notes and bookmarks](./marking-up): marking what you read.
- [Reviewing specs with a coding agent](./review-loop): sending your notes
  back.
- [Settings](../reference/settings): skipped folders, your editor, custom
  CSS.
