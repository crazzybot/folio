# Git: branches and worktrees

Status: implemented (2026-11-13). Branches, worktrees and the documents
changed on a branch are desktop only; marks on other branches are kept by
the desktop app and the MCP server.

Specs and ADRs live in repositories, and coding agents write them on
branches, often in worktrees of their own. Folio shows what's on disk; this
tells the reader which branch that is and which documents it changed, lets
them move between worktrees, and keeps marks safe when a branch switch
makes documents disappear.

## Decisions

| Question | Decision |
|---|---|
| How Folio reads git | The `git` command, with `execFile` (no shell), a 5 s timeout and an output limit. Without git the feature is hidden |
| Writes | None. Every command is a query, run with `GIT_OPTIONAL_LOCKS=0` so not even git's index is refreshed |
| Which repositories | The one containing the workspace folder, and nested ones: a folder that holds documents, or is above them, with a `.git` of its own |
| Base branch | Chosen in the branch menu (**Compare With**), else `origin/HEAD` if set, else `main`, else `master`. A choice is kept per repository, by its main checkout, so its worktrees share it; a chosen branch that's since been deleted falls back to the one found |
| Changed on the branch | Committed since the merge base with the base branch, plus uncommitted and untracked changes. On the base branch, only the uncommitted |
| Refresh | When the workspace's Markdown changes, when a repository's git folder (`HEAD`, `index`: a checkout, a commit, staging) or list of worktrees changes (watched apart: the workspace watcher skips `.git`), and when a window is focused |
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
- Off the base branch it adds the base: `feature/x → main`. The base decides
  what A and M mean, and was otherwise only in the menu.
- It's led by the repository's name (`api · feature/x → main`) when the
  workspace holds several repositories or the document is in a nested one.
  The status bar follows the open document, like the breadcrumb, while the
  list can be focused on another repository; the name says which one it
  describes. Following the list instead would give it two sources.
- Clicking it opens a native menu: the repository, **Compare <name> With**
  (named because it applies to every document in that repository; the
  base branch, checked, then **Default Branch** when one was chosen, then
  the local and `origin` branches most recently committed first), its
  **Worktrees** (from `git worktree list --porcelain`, the current one
  checked), and **Copy Branch Name**. A nested repository's folder row has
  the same **Compare <name> With** in its context menu, beside its
  documents. Choosing a worktree opens it as the
  workspace: the same folder inside it when the workspace is a folder of
  the repository, else its root.

## Document list

- **Changed on this branch** in the filter menu (a Git section, beside
  Unread) lists the documents changed on the branch, counted in the focused
  folder. When the list shows documents of one repository, the filter and
  its chip say what they compare with: "Changed since main", or
  "Uncommitted changes" when the branch is its own base (or has none). Unlike Unread it doesn't keep the open document listed: nothing
  about reading it changes whether it changed on the branch. Before the git
  state arrives, or without git, the filter is left out rather than
  emptying the list.
- A letter after a changed document's title: **A** added, **M** modified,
  as in VS Code's explorer, in italics when the document has changes that
  aren't committed (untracked counts). A document added on the branch and
  edited since stays **A**. Deleted documents aren't listed, so they get
  none. The list comes from:

  ```
  git diff --name-status --no-renames -z <merge-base> HEAD -- <workspace>
  git status --porcelain=v1 -z --no-renames --untracked-files=all -- <workspace>
  ```

  run in each repository and limited to the part the workspace shows, then
  to Markdown files. Renames count as an added file (and a deleted one).
- A document's hover card (and the letter's tooltip) says how it changed,
  naming the branch and the base: "Modified on feature/x since main, with
  uncommitted changes", or "Modified, not committed yet" on the base
  branch. It also shows the last commit that touched it: subject, author
  and day (`git log -1`), and "with Claude" when the message has a
  `Co-Authored-By: Claude …` trailer, since whether an agent wrote a change
  is worth knowing when reviewing it. It's
  asked for when the card opens and kept until the git state changes.
- A folder row that's a nested repository's root gets a branch icon when
  that repository isn't on its base branch or is detached, and a worktree
  icon instead when it's a linked worktree. A row can stand for a merged
  chain of folders ("api / docs"); the icon shows when any of them is the
  root. The workspace's own repository has no row: its branch is in the
  status bar.
- Every folder's hover card names the branch of the repository it's in,
  "worktree of …" for a linked worktree, and "compared with main" off the
  base branch.

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
  branch, `worktree list`, the changed documents), the last commit of a
  file, and `GitTracker`, which keeps the state, watches the git folders
  and reports changes. `desktop/src/gitBases.ts` keeps the chosen base
  branches in `git-bases.json` in the app's data folder.
- IPC: `git:state` (the repositories, each with its changed documents by
  workspace location), pushed again as `git:changed`; `git:menu` opens the
  branch menu at a point in the window; `git:last-commit` for a document's
  hover card.
- `frontend/src/git.ts`: which repository a document or folder is in, the
  changes by document ID, and the `useGitState` hook. The filter is in
  `metaFilter.ts` with the others, remembered per workspace.
