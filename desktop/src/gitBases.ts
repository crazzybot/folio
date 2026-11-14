/**
 * gitBases.ts — The branch each repository is compared with, when the user
 * chose one in the branch menu (Compare With). Kept by the repository's main
 * checkout, so its worktrees share the choice, in git-bases.json: app state,
 * like recent.json, not a preference to edit by hand.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// Repositories forgotten first when there are more, oldest choice first
const MAX_REPOSITORIES = 100;

let bases: Map<string, string> | null = null;

function basesPath(): string {
  return path.join(app.getPath("userData"), "git-bases.json");
}

function load(): Map<string, string> {
  if (bases !== null) return bases;
  bases = new Map();
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(basesPath(), "utf8"));
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [repo, base] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof base === "string" && base !== "") bases.set(repo, base);
      }
    }
  } catch {
    // Missing or unreadable: none chosen
  }
  return bases;
}

/** The branch chosen for the repository at `mainCheckout`, or null to use the one found. */
export function chosenBase(mainCheckout: string): string | null {
  return load().get(mainCheckout) ?? null;
}

/** Remember `base` for the repository (null: forget the choice and use the one found). */
export function chooseBase(mainCheckout: string, base: string | null): void {
  const map = load();
  map.delete(mainCheckout);
  if (base !== null) map.set(mainCheckout, base);
  while (map.size > MAX_REPOSITORIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  try {
    fs.mkdirSync(path.dirname(basesPath()), { recursive: true });
    fs.writeFileSync(basesPath(), JSON.stringify(Object.fromEntries(map), null, 2) + "\n");
  } catch {
    // Not remembered after a restart this time
  }
}
