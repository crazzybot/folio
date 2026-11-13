/**
 * git.ts — The git repositories of the open workspace: which branch each is
 * on, its base branch and its worktrees (docs/design/git.md).
 *
 * Folio only reads: git runs read-only through the core's git.ts, which
 * also finds the branch a missing document is on. Without git there's no
 * git state and the UI hides it.
 *
 * The repositories are the one the workspace is in, and nested ones: a
 * folder holding documents, or above them, with a `.git` of its own.
 */

import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import { findGit, gitOrNull, repositoryDirs, samePath } from "../../packages/core/src/git";
import type { RepositoryDirs } from "../../packages/core/src/git";

const DEBOUNCE_MS = 150;

/** A worktree of a repository (`git worktree list`). */
export interface Worktree {
  path: string;
  /** Null when its HEAD is detached. */
  branch: string | null;
  /** The worktree the workspace is in. */
  current: boolean;
}

/** A repository, as the renderer sees it. */
export interface Repository {
  /** Its root's workspace location ("projects/api"); "" for the repository the workspace is in. */
  location: string;
  /** Its root's absolute path. */
  root: string;
  /** Null when HEAD is detached. */
  branch: string | null;
  /** The short commit of HEAD; null before the first commit. */
  head: string | null;
  /** "origin/main", "main" or "master"; null when there's none of those. */
  base: string | null;
  /** For a linked worktree, the path of the main checkout; else null. */
  mainCheckout: string | null;
  /** All the repository's worktrees, the main checkout first. */
  worktrees: Worktree[];
}

export interface GitState {
  repositories: Repository[];
}

// ---------------------------------------------------------------------------
// Reading a repository
// ---------------------------------------------------------------------------

/** `git worktree list --porcelain`'s worktrees, leaving out bare and pruned ones. */
export function parseWorktrees(porcelain: string, currentRoot: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    const lines = block.split("\n");
    const worktreePath = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (worktreePath === undefined || lines.some((line) => line === "bare" || line.startsWith("prunable"))) continue;
    const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? null;
    worktrees.push({
      path: worktreePath,
      branch: ref === null ? null : ref.replace(/^refs\/heads\//, ""),
      current: samePath(worktreePath, currentRoot),
    });
  }
  return worktrees;
}

/** The branch a feature branch is compared with: origin's default branch, else main, else master. */
async function baseBranch(root: string): Promise<string | null> {
  const remote = await gitOrNull(root, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (remote) return remote;
  for (const name of ["main", "master"]) {
    if ((await gitOrNull(root, ["rev-parse", "-q", "--verify", `refs/heads/${name}`])) !== null) return name;
  }
  return null;
}

async function readRepository(dirs: RepositoryDirs, location: string): Promise<Repository> {
  const { root } = dirs;
  const branch = (await gitOrNull(root, ["symbolic-ref", "-q", "--short", "HEAD"])) || null;
  const head = (await gitOrNull(root, ["rev-parse", "-q", "--short", "HEAD"])) || null;
  const base = await baseBranch(root);
  const porcelain = (await gitOrNull(root, ["worktree", "list", "--porcelain"])) ?? "";
  const worktrees = parseWorktrees(porcelain, root);
  // A linked worktree has its own git folder inside the common one's worktrees/
  const linked = !samePath(dirs.gitDir, dirs.commonDir);
  const mainCheckout = linked ? (worktrees[0]?.path ?? path.dirname(dirs.commonDir)) : null;
  return { location, root, branch, head, base, mainCheckout, worktrees };
}

/** Folders `locations` are in, and the folders above them ("a/b/c.md" → "a", "a/b"). */
function foldersOf(locations: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const location of locations) {
    const parts = location.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  return [...folders].sort();
}

/**
 * The repositories of `workspace` and its documents (workspace locations):
 * the one the workspace is in, and those of folders with a `.git`.
 */
async function readState(workspace: string, documents: readonly string[]): Promise<{ state: GitState; dirs: RepositoryDirs[] }> {
  const found: { dirs: RepositoryDirs; location: string }[] = [];
  const own = await repositoryDirs(workspace);
  if (own !== null) found.push({ dirs: own, location: "" });
  for (const folder of foldersOf(documents)) {
    const dir = path.join(workspace, ...folder.split("/"));
    if (!existsSync(path.join(dir, ".git"))) continue;
    const dirs = await repositoryDirs(dir);
    if (dirs !== null && !found.some((entry) => samePath(entry.dirs.root, dirs.root))) found.push({ dirs, location: folder });
  }
  const repositories = await Promise.all(found.map(({ dirs, location }) => readRepository(dirs, location)));
  return { state: { repositories }, dirs: found.map((entry) => entry.dirs) };
}

// ---------------------------------------------------------------------------
// Tracking changes
// ---------------------------------------------------------------------------

/**
 * Keeps the workspace's git state, and calls `onChange` when it changes: on
 * a refresh (the workspace's files changed, the window was focused) and when
 * a repository's HEAD or worktrees change, which the workspace watcher
 * doesn't see (it skips `.git`).
 */
export class GitTracker {
  private state: GitState | null = null;
  private reading: Promise<GitState | null> | null = null;
  private watchers: FSWatcher[] = [];
  private watched = "";
  private timer: NodeJS.Timeout | undefined;
  private workspace: string | null = null;
  private documents: readonly string[] = [];
  // Bumped by each refresh, so a slow older one doesn't win
  private generation = 0;

  constructor(private readonly onChange: (state: GitState | null) => void) {}

  /** The current state, waiting for a refresh in progress; null without git or a repository. */
  current(): Promise<GitState | null> {
    return this.reading ?? Promise.resolve(this.state);
  }

  /** Read the state of `workspace` (null: none open) with its documents' locations. */
  refresh(workspace: string | null, documents: readonly string[]): Promise<GitState | null> {
    if (workspace !== this.workspace) this.state = null;
    this.workspace = workspace;
    this.documents = documents;
    const generation = ++this.generation;
    const reading = this.read(workspace, documents).then((next) => {
      if (generation !== this.generation) return this.reading ?? this.state;
      this.reading = null;
      if (JSON.stringify(next) !== JSON.stringify(this.state)) {
        this.state = next;
        this.onChange(next);
      }
      return next;
    });
    this.reading = reading;
    return reading;
  }

  private async read(workspace: string | null, documents: readonly string[]): Promise<GitState | null> {
    if (workspace === null || (await findGit()) === null) {
      this.watch([]);
      return null;
    }
    const { state, dirs } = await readState(workspace, documents).catch(() => ({ state: { repositories: [] }, dirs: [] }));
    this.watch(dirs);
    return state.repositories.length === 0 ? null : state;
  }

  /** Watch each repository's git folder (HEAD) and list of worktrees, replacing earlier watches. */
  private watch(dirs: readonly RepositoryDirs[]): void {
    const folders = [...new Set(dirs.flatMap((d) => [d.gitDir, path.join(d.commonDir, "worktrees")]))].sort();
    const key = folders.join("\n");
    if (key === this.watched) return;
    this.watched = key;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const folder of folders) {
      try {
        const watcher = watch(folder, () => {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => void this.refresh(this.workspace, this.documents), DEBOUNCE_MS);
        });
        watcher.on("error", () => watcher.close());
        this.watchers.push(watcher);
      } catch {
        // No worktrees folder yet, or an unreadable one: a refresh still catches up
      }
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watch([]);
  }
}
