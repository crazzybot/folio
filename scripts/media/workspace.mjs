// Makes a fresh workspace for recording the desktop app with an agent: a
// copy of demo/relay as its own git repository, with the delivery queue
// spec added on a branch so Folio's git view shows it as new there.
//
//   node workspace.mjs [folder]        (default ~/folio-video)
//
// Run it again between takes. Folio keys marks and read history by the
// document's real path, so a recreated folder would get the earlier takes'
// marks back: the script first deletes Folio's records for the folder in
// ~/.folio (marks, reads, and the workspace's "seen" entry). Quit Folio
// before running it, or it may write them back.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(process.argv[2] ?? join(homedir(), "folio-video"));
const SPEC = "docs/specs/delivery-queue.md";
const data = join(homedir(), ".folio");

// The path Folio stores: symlinks resolved (on macOS /tmp is /private/tmp)
function realTarget() {
  mkdirSync(target, { recursive: true });
  return realpathSync(target).normalize("NFC");
}

function forget(root) {
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

const git = (...args) => execFileSync("git", ["-C", target, ...args], { stdio: "inherit" });

const removed = forget(realTarget());
rmSync(target, { recursive: true, force: true });
cpSync(join(repo, "demo/relay"), target, { recursive: true });
git("init", "-q", "-b", "main");
git("add", "-A");
git("reset", "-q", SPEC);
git("commit", "-qm", "Relay docs");
git("switch", "-qc", "spec/delivery-queue");
git("add", "-A");
git("commit", "-qm", "Draft: offline delivery queue spec");
console.log(`${target}: ready on spec/delivery-queue (${removed} old Folio records removed)`);
