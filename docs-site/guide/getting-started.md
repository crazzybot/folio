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

## Find your way around

- **Sidebar, left:** the document list, with a search box above it, and the
  **Marks** tab with every highlight, note and bookmark.
- **Document, centre:** the open document, with its status and tags above it.
- **Outline, right:** the open document's headings. The section you're
  reading is highlighted as you scroll.

## Next steps

- [Reading a folder of docs](./reading): search, filters and focusing on one
  folder.
- [Highlights, notes and bookmarks](./marking-up): marking what you read.
- [Reviewing specs with a coding agent](./review-loop): sending your notes
  back.
