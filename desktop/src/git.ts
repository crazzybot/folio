/**
 * git.ts — The git repositories of the open workspace: which branch each is
 * on, its base branch, its worktrees and the documents changed on the
 * branch (docs/design/git.md).
 *
 * Folio only reads: git runs read-only through the core's git.ts, which
 * also finds the branch a missing document is on. Without git there's no
 * git state and the UI hides it.
 *
 * The repositories are the one the workspace is in, and nested ones: a
 * folder holding documents, or above them, with a `.git` of its own.
 */

import { existsSync, promises as fs, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import { findGit, git, gitOrNull, repositoryDirs, samePath } from "../../packages/core/src/git";
import type { RepositoryDirs } from "../../packages/core/src/git";

const DEBOUNCE_MS = 150;
// What the document list counts as Markdown (the scanner's extensions)
const MARKDOWN = /\.(md|markdown)$/i;

/** A worktree of a repository (`git worktree list`). */
export interface Worktree {
  path: string;
  /** Null when its HEAD is detached. */
  branch: string | null;
  /** The worktree the workspace is in. */
  current: boolean;
}

/** A document changed on the branch: since the merge base with the base branch, or not committed yet. */
export interface Change {
  /** Its workspace location ("docs/spec.md"). */
  location: string;
  /** Added or modified, like VS Code's explorer letters. */
  status: "A" | "M";
  /** Whether it has changes that aren't committed (untracked counts). */
  uncommitted: boolean;
}

/** The last commit that touched a document, for its hover card. */
export interface LastCommit {
  subject: string;
  author: string;
  /** ISO 8601. */
  date: string;
  /** Whether its message has a `Co-Authored-By: Claude` trailer. */
  withClaude: boolean;
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
  /**
   * The branch it's compared with: the one chosen in the branch menu, else
   * "origin/main", "main" or "master"; null when there's none of those.
   */
  base: string | null;
  /** Whether `base` was chosen in the branch menu rather than found. */
  baseChosen: boolean;
  /** For a linked worktree, the path of the main checkout; else null. */
  mainCheckout: string | null;
  /** All the repository's worktrees, the main checkout first. */
  worktrees: Worktree[];
  /** Markdown documents in the workspace changed on the branch, by location. */
  changes: Change[];
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

/**
 * `git status --porcelain=v1 -z` and `git diff --name-status -z` entries:
 * each changed path with its letter, leaving out deleted files (they aren't
 * in the list to mark). Untracked and newly added files are "A".
 */
export function parseStatus(out: string): Map<string, "A" | "M"> {
  const files = new Map<string, "A" | "M">();
  for (const entry of out.split("\0")) {
    if (entry.length < 4 || entry[2] !== " ") continue;
    const code = entry.slice(0, 2);
    if (code.includes("D")) continue;
    files.set(entry.slice(3), code === "??" || code.includes("A") ? "A" : "M");
  }
  return files;
}

/** `git diff --name-status -z`'s pairs (status, path) as a map, deleted files left out. */
export function parseNameStatus(out: string): Map<string, "A" | "M"> {
  const files = new Map<string, "A" | "M">();
  const fields = out.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const code = fields[i] ?? "";
    const file = fields[i + 1] ?? "";
    if (code === "" || file === "" || code.startsWith("D")) continue;
    files.set(file, code.startsWith("A") ? "A" : "M");
  }
  return files;
}

/**
 * The Markdown documents under `workspace` (its real path) changed on the
 * branch: committed since the merge base with `base`, plus uncommitted and
 * untracked ones. On the base branch, or with none, only the uncommitted.
 * A document added on the branch and edited since stays "A", and is uncommitted.
 */
async function branchChanges(root: string, base: string | null, workspace: string): Promise<Change[]> {
  // Only the part of the repository the workspace shows (all of it for a nested one)
  const inside = path.relative(root, workspace);
  const scope = inside === "" || inside.startsWith("..") || path.isAbsolute(inside) ? "." : inside.split(path.sep).join("/");
  // Untrimmed: a status line can start with a space (" M a.md")
  const list = (args: string[]) => git(root, ["--literal-pathspecs", ...args, "--", scope]).catch(() => "");
  const mergeBase = base === null ? null : await gitOrNull(root, ["merge-base", "HEAD", base]);
  const committed = mergeBase
    ? parseNameStatus(await list(["diff", "--name-status", "--no-renames", "-z", mergeBase, "HEAD"]))
    : new Map<string, "A" | "M">();
  const uncommitted = parseStatus(await list(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]));

  const changes: Change[] = [];
  for (const file of new Set([...committed.keys(), ...uncommitted.keys()])) {
    if (!MARKDOWN.test(file)) continue;
    const location = path.relative(workspace, path.join(root, file));
    if (location.startsWith("..") || path.isAbsolute(location)) continue;
    const status = committed.get(file) ?? uncommitted.get(file) ?? "M";
    changes.push({ location: location.split(path.sep).join("/"), status, uncommitted: uncommitted.has(file) });
  }
  return changes.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
}

/** The branch chosen to compare a repository with, by its main checkout's path; null for the one found. */
export type ChosenBase = (mainCheckout: string) => string | null;

async function readRepository(dirs: RepositoryDirs, location: string, workspace: string, chosenBase: ChosenBase): Promise<Repository> {
  const { root } = dirs;
  const branch = (await gitOrNull(root, ["symbolic-ref", "-q", "--short", "HEAD"])) || null;
  const head = (await gitOrNull(root, ["rev-parse", "-q", "--short", "HEAD"])) || null;
  const porcelain = (await gitOrNull(root, ["worktree", "list", "--porcelain"])) ?? "";
  const worktrees = parseWorktrees(porcelain, root);
  // A linked worktree has its own git folder inside the common one's worktrees/
  const linked = !samePath(dirs.gitDir, dirs.commonDir);
  const mainCheckout = linked ? (worktrees[0]?.path ?? path.dirname(dirs.commonDir)) : null;
  // A chosen branch that's since been deleted falls back to the one found
  const chosen = chosenBase(mainCheckout ?? root);
  const chosenExists = chosen !== null && (await gitOrNull(root, ["rev-parse", "-q", "--verify", `${chosen}^{commit}`])) !== null;
  const base = chosenExists ? chosen : await baseBranch(root);
  const changes = await branchChanges(root, base, workspace);
  return { location, root, branch, head, base, baseChosen: chosenExists, mainCheckout, worktrees, changes };
}

/** Local branches and origin's, most recently committed first: what a repository can be compared with. */
export async function branchesOf(root: string): Promise<string[]> {
  const out = await gitOrNull(root, [
    "for-each-ref",
    "--sort=-committerdate",
    "--count=30",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes/origin",
  ]);
  return (out ?? "").split("\n").filter((name) => name !== "" && name !== "origin/HEAD" && name !== "origin");
}

/** The last commit that touched `file` (absolute), or null when none did or it isn't in a repository. */
export async function lastCommit(file: string): Promise<LastCommit | null> {
  if ((await findGit()) === null) return null;
  const dir = path.dirname(file);
  const format = "%s%x00%an%x00%aI%x00%(trailers:key=Co-authored-by,valueonly,separator=%x01)";
  const out = await gitOrNull(dir, ["--literal-pathspecs", "log", "-1", `--format=${format}`, "--", path.basename(file)]);
  if (!out) return null;
  const [subject = "", author = "", date = "", coAuthors = ""] = out.split("\0");
  return { subject, author, date, withClaude: coAuthors.split("\x01").some((name) => /^claude\b/i.test(name.trim())) };
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
async function readState(
  workspace: string,
  documents: readonly string[],
  chosenBase: ChosenBase,
): Promise<{ state: GitState; dirs: RepositoryDirs[] }> {
  // Repository roots are real paths (/tmp → /private/tmp): locations are worked out against the same
  const real = await fs.realpath(workspace).catch(() => workspace);
  const found: { dirs: RepositoryDirs; location: string }[] = [];
  const own = await repositoryDirs(workspace);
  if (own !== null) found.push({ dirs: own, location: "" });
  for (const folder of foldersOf(documents)) {
    const dir = path.join(workspace, ...folder.split("/"));
    if (!existsSync(path.join(dir, ".git"))) continue;
    const dirs = await repositoryDirs(dir);
    if (dirs !== null && !found.some((entry) => samePath(entry.dirs.root, dirs.root))) found.push({ dirs, location: folder });
  }
  const repositories = await Promise.all(found.map(({ dirs, location }) => readRepository(dirs, location, real, chosenBase)));
  return { state: { repositories }, dirs: found.map((entry) => entry.dirs) };
}

// ---------------------------------------------------------------------------
// Tracking changes
// ---------------------------------------------------------------------------

/**
 * Keeps the workspace's git state, and calls `onChange` when it changes: on
 * a refresh (the workspace's files changed, the window was focused) and when
 * a repository's git folder or worktrees change, which the workspace watcher
 * doesn't see (it skips `.git`). A commit, staging and checkout all write to
 * the git folder (`HEAD`, `index`).
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

  constructor(
    private readonly onChange: (state: GitState | null) => void,
    private readonly chosenBase: ChosenBase = () => null,
  ) {}

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
    const { state, dirs } = await readState(workspace, documents, this.chosenBase).catch(() => ({ state: { repositories: [] }, dirs: [] }));
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

  /** Read the state again for the same workspace, e.g. after the base branch was chosen. */
  reread(): Promise<GitState | null> {
    return this.refresh(this.workspace, this.documents);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watch([]);
  }
}
