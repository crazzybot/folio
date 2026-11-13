# Git: branches and worktrees

Status: implemented (2026-11-13). Branches and worktrees are desktop only;
marks on other branches are kept by the desktop app and the MCP server.

Specs and ADRs live in repositories, and coding agents write them on
branches, often in worktrees of their own. Folio shows what's on disk; this
tells the reader which branch that is, lets them move between worktrees,
and keeps marks safe when a branch switch makes documents disappear.

## Decisions

| Question | Decision |
|---|---|
| How Folio reads git | The `git` command, with `execFile` (no shell), a 5 s timeout and an output limit. Without git the feature is hidden |
| Writes | None. Every command is a query, run with `GIT_OPTIONAL_LOCKS=0` so not even git's index is refreshed |
| Which repositories | The one containing the workspace folder, and nested ones: a folder that holds documents, or is above them, with a `.git` of its own |
| Base branch | `origin/HEAD` if set, else `main`, else `master` |
| Refresh | When the workspace's Markdown changes, when a repository's git folder (`HEAD`) or list of worktrees changes (watched apart: the workspace watcher skips `.git`), and when a window is focused |
| Platforms | Desktop. The browser build and the live demo have no git state. The MCP server uses git only to keep marks on other branches (below) |

Finding git: GUI apps on macOS don't get the shell's `PATH`, so Homebrew's
git is looked for by path. `/usr/bin/git` is a stub that offers to install
the developer tools; it's used only when `xcode-select -p` says they're
installed, so Folio never makes that dialog appear.

## Status bar and branch menu

- The status bar shows, after the gear, the branch of the open document's
  repository (the workspace's, unless the document is in a nested one), or
  the short commit when HEAD is detached, and a worktree icon when it's a
  linked worktree (`--git-dir` differs from `--git-common-dir`).
- Clicking it opens a native menu: the repository and its base branch, its
  **Worktrees** (from `git worktree list --porcelain`, the current one
  checked), and **Copy Branch Name**. Choosing a worktree opens it as the
  workspace: the same folder inside it when the workspace is a folder of
  the repository, else its root.

## Document list

- A folder row that's a nested repository's root gets a branch icon when
  that repository isn't on its base branch or is detached, and a worktree
  icon instead when it's a linked worktree. A row can stand for a merged
  chain of folders ("api / docs"); the icon shows when any of them is the
  root. The workspace's own repository has no row: its branch is in the
  status bar.
- Every folder's hover card names the branch of the repository it's in, and
  "worktree of …" for a linked worktree.

## Marks across branches

Marks are keyed by path, so a document on both branches keeps its marks,
re-anchored against the other branch's text. A document that exists only
on the other branch would be listed under **Missing documents**, and the
content match (marks.md) could move its marks to a different file. So:

- `listMarks` (core) takes an optional `onOtherBranches` hook. The core's
  `filesOnOtherBranches` looks up each missing file's repository and
  checks the local branches, most recently committed first (at most 50),
  with `git ls-tree` at each branch's tip. The desktop app and the MCP
  server both pass it: whichever lists marks first after a branch switch,
  a file renamed on the branch doesn't pull its marks to the old name.
- A file found there keeps its marks where they are: no automatic re-link,
  no suggested document. The Marks view lists it under **On other
  branches** with the branch's name; **Move to…** and **Delete** are still
  there.
- Switching back finds the file again, marks intact.

## Implementation

- `packages/core/src/git.ts`: finding git, running it read-only with a
  queue per repository so its commands run one at a time, `rev-parse` for
  a repository's folders, and `filesOnOtherBranches`.
- `desktop/src/git.ts`: reading a repository (`symbolic-ref`, the base
  branch, `worktree list`), and `GitTracker`, which keeps the state,
  watches the git folders and reports changes.
- IPC: `git:state` (the repositories), pushed again as `git:changed`;
  `git:menu` opens the branch menu at a point in the window.
- `frontend/src/git.ts`: which repository a document or folder is in, and
  the `useGitState` hook.
