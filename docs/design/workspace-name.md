# Workspace name in the status bar

Status: implemented (2026-11-25).

Folio doesn't show which folder is open. The window title has it
(`folio — Folio`), but on macOS the title bar is hidden (`hiddenInset`, the
window buttons sit in the app's header row), so the name shows only in the
**Window** menu, Mission Control and the Dock's menu. Windows and Linux keep
the native title bar, so the name is there. VS Code puts the workspace name
in the middle of its title bar; in Folio that row holds the sidebar's tabs on
the left and the document's breadcrumb and actions on the right, with no room
in the middle.

The open document's path is shown twice: as the breadcrumb in the header,
and as plain text in the status bar. This design gives the status bar's
place to the workspace name. The status bar is always on screen, whether the
sidebar is shown, hidden (⌘B / Ctrl+B) or a drawer, and the breadcrumb keeps
the document's path.

## Decisions

| Question | Decision |
|---|---|
| Where the name goes | The status bar, on the left: after **Settings**, before the branch. It replaces the document's location there |
| What it shows | A folder icon and the workspace folder's name. Its tooltip is the full path |
| The document's path | The breadcrumb only. Its file item's tooltip already has the full location, and folders it shortens to "…" have theirs |
| Clicking the name | A menu with the workspace's actions at the top and the recent folders below them, so switching takes one click. See [The menu](#the-menu) |
| With the branch | Side by side, they read as the project and its branch: **▢ folio  ⎇ main**. The branch names its repository only when that isn't the workspace's (`gitRepoNamed`, unchanged) |
| A folder focus | Unchanged: the sidebar's focus bar says what the list shows; the status bar names the workspace |
| No workspace | Nothing there. Folio asks for a folder at launch when none is set, so this is only the moment before one is chosen |
| The live demo | **relay**, with no menu (as the focus bar's ⋯ is desktop only) |
| A narrow window | The name shortens with an ellipsis before the branch does; the folder icon stays |

## The status bar

Today:

```
│ ⚙  ⎇ main  ● Live   docs/specs/relay-protocol.md          message │
```

With the workspace name:

```
│ ⚙  ▢ folio  ⎇ main  ● Live                                message │
```

The item is a button styled as the branch is (`statusBranch`): no border,
the hover background, the menu opening above it.

## The menu

```
Open Folder…
Reveal in Finder
Copy Path
─────────────────────
Recent
~/work/specs
~/Documents/obsidian-vault
~/Development/relay
```

- The top part acts on the open workspace: **Open Folder…** (⌘O / Ctrl+O, as
  in the File menu), **Reveal in Finder** (**Show in Folder** on Windows and
  Linux) and **Copy Path**.
- Below it, a disabled **Recent** heading, then the recently opened folders
  inline, not in a submenu: the other folders of File → **Open Recent**, most
  recent first, up to its 10. The open workspace isn't listed. Each item is
  labelled as there (`folderLabel()`: its path, with the home folder as `~`).
  Choosing one opens it, as from the File menu.
- With no other recent folders, the heading and the list are left out.
  **Clear Recently Opened** stays in File → **Open Recent** only: it's rarely
  needed.

## Alternatives

| Where | Why not |
|---|---|
| A bar at the top of the sidebar, merged with the focus bar | Hidden with the sidebar, and it costs list height at all times |
| The breadcrumb's first item | Takes the header's width from the document's own path, which matters more while reading |
| The tab row, after the tabs | The row shares the title bar with the window buttons and has room for one more short tab at most |
| The middle of the header, as VS Code | The breadcrumb and the document's actions fill it |

The status bar is a less common place for a workspace name than the title
bar. JetBrains IDEs and Zed put the project at the title bar's left, beside
the branch; Folio's status bar has the branch, so the name goes beside it
there.

## Implementation

- `frontend/src/App.tsx`: the workspace item in the footer, in place of the
  `statusLocation` span. It gets the name from the data source's
  `workspace()`: the basename of `window.markdownApi.workspacePath` in the
  desktop app, and `workspaceName` in the demo bundle (the bundled folder's
  name, written by `demo-bundle.mjs`).
- `desktop/src/main.ts`: a `workspace:show-menu` handler, as the branch's
  `git.showMenu`: `chooseWorkspace`, Reveal, a copy of `settings.workspace`,
  then the recent folders inline under a **Recent** heading: `recentMenu()`'s
  folder items, without its Clear item. Preload exposes it.
- Labels: the item is labelled `Workspace: <name>`. `scripts/media/` doesn't
  use the status bar's location; check it still doesn't.

Checks: a frontend test for the item and its tooltip; the demo at 375 and
320 px, where the status bar is narrowest. User docs: the page that
describes the status bar (`docs-site/`). A bullet in `CHANGELOG.md`.
