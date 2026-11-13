/**
 * git.ts — Which git repository a document or folder is in, and how its
 * branch is shown: the status bar, folder rows and their hover cards. The
 * state comes from the desktop app (desktop/src/git.ts); the browser and the
 * live demo have none.
 */

import { useEffect, useState } from "react";
import type { GitRepository, GitState } from "./types";

/** The repository `location` (a document's or folder's) is in: the deepest one holding it. */
export function repositoryOf(state: GitState | null, location: string): GitRepository | null {
  let found: GitRepository | null = null;
  for (const repo of state?.repositories ?? []) {
    const holds = repo.location === "" || location === repo.location || location.startsWith(repo.location + "/");
    if (holds && (found === null || repo.location.length > found.location.length)) found = repo;
  }
  return found;
}

/**
 * The nested repository whose root a folder row shows. A row can stand for
 * a chain of folders ("projects / api", `folders` long): any of them counts.
 */
export function repositoryAtFolder(state: GitState | null, folderKey: string, folders = 1): GitRepository | null {
  const parts = folderKey.split("/");
  const chain = new Set<string>();
  for (let n = Math.max(1, parts.length - folders + 1); n <= parts.length; n++) chain.add(parts.slice(0, n).join("/"));
  return state?.repositories.find((repo) => repo.location !== "" && chain.has(repo.location)) ?? null;
}

/** The branch, or the short commit when HEAD is detached. */
export function branchLabel(repo: GitRepository): string {
  return repo.branch ?? repo.head ?? "HEAD";
}

/** Whether the repository is on its base branch (true when it has none to compare with). */
export function isOnBase(repo: GitRepository): boolean {
  if (repo.base === null) return true;
  return repo.branch !== null && (repo.base === repo.branch || repo.base === `origin/${repo.branch}`);
}

/** "On branch feature/x", "Detached at 1a2b3c4". */
export function branchSentence(repo: GitRepository): string {
  return repo.branch !== null ? `On branch ${repo.branch}` : `Detached at ${repo.head ?? "HEAD"}`;
}

/** The last folder of a path ("/Users/me/code/folio" → "folio"). */
export function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
}

/** The workspace's git state, kept up to date; null outside the desktop app, without git or a repository. */
export function useGitState(): GitState | null {
  const [state, setState] = useState<GitState | null>(null);
  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    let live = true;
    api.git.state().then(
      (initial) => {
        if (live) setState(initial);
      },
      () => {},
    );
    const unsubscribe = api.git.onChange(setState);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}
