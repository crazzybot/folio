# Changelog

Notable changes to Folio. Versions follow [Semantic Versioning](https://semver.org);
the desktop app, frontend and backend share one version number.

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

[0.2.0]: https://github.com/crazzybot/markdown-viewer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/crazzybot/markdown-viewer/releases/tag/v0.1.0
