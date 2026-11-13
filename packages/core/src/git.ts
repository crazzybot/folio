/**
 * git.ts — Running git read-only, and finding which branch a missing
 * document is on (docs/design/git.md). Shared by the desktop app, which also
 * shows branches and worktrees (desktop/src/git.ts), and the MCP server, so
 * both keep the marks of a document on another branch where they are.
 *
 * Every command is a query, run with execFile (no shell), a timeout and an
 * output limit, and with GIT_OPTIONAL_LOCKS=0 so not even git's index is
 * refreshed. Commands for one repository run one at a time. Without git
 * (or, on macOS, with only the stub that asks to install the developer
 * tools) nothing is found.
 */

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 4 * 1024 * 1024;
// Branches looked at for a missing file, most recently committed first
const MAX_BRANCHES = 50;

/** A repository's root and git folders, from `git rev-parse`. */
export interface RepositoryDirs {
  root: string;
  /** This worktree's git folder: its HEAD is here. */
  gitDir: string;
  /** Shared by all worktrees: refs and the list of worktrees are here. */
  commonDir: string;
}

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

/** Run `command` and resolve its stdout; rejects when it fails or exits non-zero. */
function exec(command: string, args: readonly string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env: ENV, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

let gitCommand: Promise<string | null> | undefined;

/**
 * The git to run, or null when there's none. GUI apps on macOS don't get the
 * shell's PATH, so Homebrew's git is looked for by path; /usr/bin/git is a
 * stub that offers to install the developer tools unless they're installed.
 */
export function findGit(): Promise<string | null> {
  gitCommand ??= (async () => {
    const candidates =
      process.platform === "darwin" ? ["/opt/homebrew/bin/git", "/usr/local/bin/git", "git"] : ["git"];
    for (const candidate of candidates) {
      if (candidate !== "git" && !existsSync(candidate)) continue;
      if (candidate === "git" && process.platform === "darwin") {
        const tools = await exec("xcode-select", ["-p"]).then(
          () => true,
          () => false,
        );
        if (!tools) continue;
      }
      const works = await exec(candidate, ["--version"]).then(
        () => true,
        () => false,
      );
      if (works) return candidate;
    }
    return null;
  })();
  return gitCommand;
}

// The last command queued for each repository, so the next waits for it
const queues = new Map<string, Promise<unknown>>();

/** Run git in `cwd`, after the commands already queued there; resolves stdout. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const command = await findGit();
  if (command === null) throw new Error("git isn't available");
  const previous = queues.get(cwd) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => exec(command, args, cwd));
  queues.set(cwd, run);
  try {
    return await run;
  } finally {
    if (queues.get(cwd) === run) queues.delete(cwd);
  }
}

/** git's output, trimmed, or null when the command failed (e.g. not a repository, no such ref). */
export function gitOrNull(cwd: string, args: readonly string[]): Promise<string | null> {
  return git(cwd, args).then(
    (out) => out.trim(),
    () => null,
  );
}

/** The repository `dir` is in, or null when it's in none. */
export async function repositoryDirs(dir: string): Promise<RepositoryDirs | null> {
  const out = await gitOrNull(dir, ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"]);
  const [root, gitDir, commonDir] = out?.split("\n") ?? [];
  if (!root || !gitDir || !commonDir) return null;
  // --git-dir and --git-common-dir may be relative to `dir`
  return { root: await realOrResolved(root), gitDir: path.resolve(dir, gitDir), commonDir: path.resolve(dir, commonDir) };
}

/**
 * Of `files` (absolute paths of missing documents), those tracked on another
 * local branch of their repository, with that branch: the most recently
 * committed one that has the file. For `listMarks`' `onOtherBranches`.
 */
export async function filesOnOtherBranches(files: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (files.length === 0 || (await findGit()) === null) return result;

  // Group the files by repository, found from the closest folder that still exists
  const byRoot = new Map<string, string[]>();
  for (const file of files) {
    let dir = path.dirname(file);
    while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const dirs = await repositoryDirs(dir);
    if (dirs === null) continue;
    const relative = path.relative(dirs.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    byRoot.set(dirs.root, [...(byRoot.get(dirs.root) ?? []), file]);
  }

  for (const [root, rootFiles] of byRoot) {
    const current = await gitOrNull(root, ["symbolic-ref", "-q", "HEAD"]);
    const refs =
      (await gitOrNull(root, ["for-each-ref", "--sort=-committerdate", `--count=${MAX_BRANCHES}`, "--format=%(refname)", "refs/heads"]))
        ?.split("\n")
        .filter((ref) => ref !== "" && ref !== current) ?? [];
    // Paths in git's form: relative to the root, with forward slashes
    let left = new Map(rootFiles.map((file) => [path.relative(root, file).split(path.sep).join("/"), file]));
    for (const ref of refs) {
      if (left.size === 0) break;
      const out = await gitOrNull(root, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--name-only", ref, "--", ...left.keys()]);
      if (!out) continue;
      const branch = ref.replace(/^refs\/heads\//, "");
      for (const name of out.split("\0")) {
        const file = left.get(name);
        if (file !== undefined) result.set(file, branch);
      }
      left = new Map([...left].filter(([, file]) => !result.has(file)));
    }
  }
  return result;
}

/** `p` with symlinks resolved (/tmp → /private/tmp), or as given when it doesn't exist. */
async function realOrResolved(p: string): Promise<string> {
  return fs.realpath(p).catch(() => path.resolve(p));
}

/** Whether two paths are the same folder (case aside on macOS and Windows). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" || process.platform === "darwin"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}
