// Makes a fresh workspace for recording the desktop app with an agent: a
// copy of demo/relay as its own git repository, with the delivery queue
// spec added on a branch so Folio's git view shows it as new there.
//
//   node workspace.mjs [folder]        (default ~/folio-video)
//
// Run it again between takes. It first deletes Folio's records for the
// folder (see records.mjs). Quit Folio before running it.
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { forget, realFolder } from "./records.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(process.argv[2] ?? join(homedir(), "folio-video"));
const SPEC = "docs/specs/delivery-queue.md";

const git = (...args) => execFileSync("git", ["-C", target, ...args], { stdio: "inherit" });

const removed = forget(realFolder(target));
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
