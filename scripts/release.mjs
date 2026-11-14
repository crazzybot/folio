#!/usr/bin/env node
// Prepares a release, or checks that the version is the same everywhere.
//
//   node scripts/release.mjs 0.4.0          # or: patch | minor | major
//   node scripts/release.mjs --check
//
// Preparing (from a clean, up-to-date main):
//   1. sets the version in desktop/package.json and frontend/package.json,
//      and updates their lock files;
//   2. turns CHANGELOG.md's "## [Unreleased]" notes into the release's
//      section, dated today, under a new empty "## [Unreleased]", and adds
//      the release's compare link;
//   3. commits all that as "chore: release X.Y.Z" on a new branch,
//      release-X.Y.Z.
// Merging, tagging and publishing stay manual (docs/releasing.md).
//
// --check (CI) fails unless both files and their lock files agree.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = "https://github.com/crazzybot/folio";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const path = (file) => join(ROOT, file);
const read = (file) => readFileSync(path(file), "utf8");

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args, cwd = ROOT) {
  return execFileSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" }).trim();
}

// ─── Where the version is ────────────────────────────────────────────────────

/** Each place the version is kept, and how to read it. */
const SOURCES = [
  { file: "desktop/package.json", read: (text) => JSON.parse(text).version },
  { file: "frontend/package.json", read: (text) => JSON.parse(text).version },
];

/** The lock files, which repeat the version; updated by their tools, only checked here. */
const LOCKS = [
  { file: "desktop/package-lock.json", read: (text) => JSON.parse(text).version },
  { file: "frontend/package-lock.json", read: (text) => JSON.parse(text).version },
];

/** The version in each file, by file. */
function versions(entries) {
  return entries.map(({ file, read: parse }) => ({ file, version: parse(read(file)) ?? null }));
}

function check() {
  const found = versions([...SOURCES, ...LOCKS]);
  const distinct = new Set(found.map((f) => f.version));
  if (distinct.size !== 1 || distinct.has(null)) {
    console.error("release: the version differs between files:\n");
    for (const { file, version } of found) console.error(`  ${version ?? "(not found)"}\t${file}`);
    console.error("\nSet it in all of them with: node scripts/release.mjs <version>");
    process.exit(1);
  }
  console.log(`Version ${[...distinct][0]} everywhere.`);
}

// ─── Preparing a release ─────────────────────────────────────────────────────

function parse(version) {
  const m = SEMVER.exec(version);
  return m ? m.slice(1).map(Number) : null;
}

/** The version asked for: X.Y.Z, or patch / minor / major from `current`. */
function nextVersion(current, asked) {
  const [major, minor, patch] = parse(current);
  if (asked === "patch") return `${major}.${minor}.${patch + 1}`;
  if (asked === "minor") return `${major}.${minor + 1}.0`;
  if (asked === "major") return `${major + 1}.0.0`;
  if (parse(asked) === null) fail(`"${asked}" isn't a version (X.Y.Z) or patch, minor, major`);
  return asked;
}

function isNewer(next, current) {
  const [a, b] = [parse(next), parse(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
}

/** CHANGELOG.md with the Unreleased notes released as `version`. */
function releaseChangelog(text, version, previous) {
  const heading = /^## \[Unreleased\][^\n]*\n/m.exec(text);
  if (heading === null) fail('CHANGELOG.md has no "## [Unreleased]" section to release');
  const start = heading.index + heading[0].length;
  const next = text.slice(start).search(/^## \[/m);
  const end = next === -1 ? text.length : start + next;
  const notes = text.slice(start, end).trim();
  if (notes === "") fail('CHANGELOG.md\'s "## [Unreleased]" section is empty: add the release notes there first');

  const released =
    text.slice(0, heading.index) +
    `## [Unreleased]\n\n## [${version}] — ${today()}\n\n${notes}\n\n` +
    text.slice(end);
  const link = `[${version}]: ${REPO_URL}/compare/v${previous}...v${version}\n`;
  const firstLink = released.search(/^\[\d+\.\d+\.\d+\]: /m);
  return firstLink === -1 ? `${released.trimEnd()}\n\n${link}` : released.slice(0, firstLink) + link + released.slice(firstLink);
}

function prepare(asked) {
  if (run("git", ["status", "--porcelain"]) !== "") fail("the working tree has changes: commit or stash them first");
  const branch = run("git", ["branch", "--show-current"]);
  if (branch !== "main") fail(`on "${branch}": start from an up-to-date main`);

  const current = versions(SOURCES);
  const previous = current[0].version;
  if (current.some((c) => c.version !== previous)) fail("the version already differs between files; see --check");
  const version = nextVersion(previous, asked);
  if (!isNewer(version, previous)) fail(`${version} isn't newer than the current ${previous}`);
  const releaseBranch = `release-${version}`;

  // Everything that can fail is checked before anything is written
  const changelog = releaseChangelog(read("CHANGELOG.md"), version, previous);

  for (const file of ["desktop/package.json", "frontend/package.json"]) {
    writeFileSync(path(file), read(file).replace(`"version": "${previous}"`, `"version": "${version}"`));
  }
  writeFileSync(path("CHANGELOG.md"), changelog);

  console.log("Updating lock files…");
  for (const dir of ["desktop", "frontend"]) {
    run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], path(dir));
  }
  check();

  run("git", ["switch", "--create", releaseBranch]);
  run("git", ["add", ...SOURCES.map((s) => s.file), ...LOCKS.map((l) => l.file), "CHANGELOG.md"]);
  run("git", ["commit", "--quiet", "--message", `chore: release ${version}`]);

  console.log(`
Committed "chore: release ${version}" on ${releaseBranch}. Next:
  1. Review it (git show), push the branch and merge it to main.
  2. Tag the merge commit and push the tag:
       git tag v${version} && git push origin v${version}
  3. Publish the draft release the release workflow creates, with the
     CHANGELOG.md entry as its notes.`);
}

// ─── Command line ────────────────────────────────────────────────────────────

const [arg] = process.argv.slice(2);
if (arg === "--check") check();
else if (arg === undefined || arg === "--help" || arg === "-h") {
  console.log("Usage: node scripts/release.mjs <X.Y.Z | patch | minor | major>\n       node scripts/release.mjs --check");
  process.exit(arg === undefined ? 1 : 0);
} else prepare(arg);
