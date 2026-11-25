// Deletes Folio's records for a folder in ~/.folio: marks, reads, and the
// workspace's "seen" entry. Folio keys them by the document's real path, so
// a workspace recreated between takes would otherwise get the earlier
// takes' marks back. Quit Folio first, or it may write them back.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

const data = join(homedir(), ".folio");

// The path Folio stores: symlinks resolved (on macOS /tmp is /private/tmp)
export function realFolder(folder) {
  mkdirSync(folder, { recursive: true });
  return realpathSync(folder).normalize("NFC");
}

// Returns how many record files were removed
export function forget(root) {
  const inside = (p) => typeof p === "string" && (p === root || p.startsWith(root + sep));
  let removed = 0;
  for (const kind of ["marks", "reads"]) {
    const folder = join(data, kind);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".json") || name === "workspaces.json") continue;
      const file = join(folder, name);
      try {
        if (inside(JSON.parse(readFileSync(file, "utf8")).path)) {
          rmSync(file);
          removed++;
        }
      } catch {
        // Not a record (or half written): leave it
      }
    }
  }
  const seen = join(data, "reads", "workspaces.json");
  if (existsSync(seen)) {
    const workspaces = JSON.parse(readFileSync(seen, "utf8"));
    for (const w of Object.keys(workspaces)) if (inside(w)) delete workspaces[w];
    writeFileSync(seen, JSON.stringify(workspaces, null, 2) + "\n");
  }
  return removed;
}
