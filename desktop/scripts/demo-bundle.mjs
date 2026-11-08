// Builds the live demo's data (docs/design/live-demo.md, frontend/src/demo/):
//
//   demo/build/bundle.json   the documents, their Markdown, the attachments
//                            and the seed marks
//   demo/build/workspace/…   a copy of the demo repository, for images and
//                            linked files
//
// from demo/relay/ and demo/seed-marks.json. It scans with the desktop app's
// own scanner (run `npm run build:main` first; `npm run demo:bundle` does),
// so titles, headings and ids are what the app would show.
//
// Fails when a seed mark's quote or heading isn't in its document, so
// editing the demo documents can't silently drop a seed mark.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(desktop, "..");
const workspace = join(root, "demo", "relay");
const seedFile = join(root, "demo", "seed-marks.json");
const out = join(root, "demo", "build");

const { scanWorkspace, scanAttachments, findDocument } = createRequire(import.meta.url)(
  join(desktop, "dist", "scanner.js"),
);

// Seed marks carry fixed ids and times, so the bundle only changes when the
// demo does
const SEED_TIME = "2026-11-01T09:00:00Z";
const COLORS = new Set(["yellow", "green", "blue", "pink"]);
const MARKDOWN_SYNTAX = /[*_`[\]#<>|$\\]/;

const seedId = (...parts) => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);

function fail(message) {
  console.error(`demo-bundle: ${message}`);
  process.exit(1);
}

const documents = await scanWorkspace(workspace);
if (documents.length === 0) fail(`no documents in ${workspace}`);
const contents = {};
for (const doc of documents) {
  const found = await findDocument(workspace, doc.id);
  if (found === null) fail(`can't read ${doc.location}`);
  contents[doc.id] = found.content;
}
const attachments = await scanAttachments(workspace);

/** A highlight from its quote: the viewer finds the quote in the rendered text. */
function highlight(location, content, entry, index) {
  const { quote, color, note = null } = entry;
  if (typeof quote !== "string" || quote.trim() === "") fail(`${location}: a highlight needs a quote`);
  if (!COLORS.has(color)) fail(`${location}: "${quote}": color must be one of ${[...COLORS].join(", ")}`);
  if (quote.includes("\n") || MARKDOWN_SYNTAX.test(quote)) {
    fail(`${location}: "${quote}": quotes must be one line of plain text, with no Markdown syntax`);
  }
  if (!content.split(/\r?\n/).some((line) => line.includes(quote))) fail(`${location}: "${quote}" isn't in the document`);
  // No position or surrounding text: the viewer's anchoring finds the quote
  // by its text (frontend/src/anchoring.ts), the first occurrence when there
  // are several
  return {
    id: seedId(location, "highlight", index, quote),
    color,
    note,
    quote: { exact: quote, prefix: "", suffix: "" },
    position: { start: 0, end: quote.length },
    created: SEED_TIME,
    updated: SEED_TIME,
  };
}

/** A bookmark on the document (`heading` null) or on its first heading with that text. */
function bookmark(location, meta, entry, index) {
  const { heading } = entry;
  if (heading === null) return { id: seedId(location, "bookmark", index), heading: null, created: SEED_TIME };
  const at = meta.headings.findIndex((h) => h.text === heading);
  if (at === -1) fail(`${location}: no heading "${heading}"`);
  const { level, text } = meta.headings[at];
  // Which of the same-text, same-level headings, as frontend/src/bookmarks.ts counts them
  const occurrence = meta.headings.slice(0, at).filter((h) => h.level === level && h.text === text).length;
  return { id: seedId(location, "bookmark", index, text), heading: { text, level, occurrence }, created: SEED_TIME };
}

const seed = JSON.parse(readFileSync(seedFile, "utf8"));
const seedMarks = {};
for (const [location, entry] of Object.entries(seed.documents ?? {})) {
  const meta = documents.find((doc) => doc.location === location);
  if (meta === undefined) fail(`seed marks for ${location}, which isn't a demo document`);
  seedMarks[meta.id] = {
    bookmarks: (entry.bookmarks ?? []).map((b, i) => bookmark(location, meta, b, i)),
    highlights: (entry.highlights ?? []).map((h, i) => highlight(location, contents[meta.id], h, i)),
  };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bundle.json"), JSON.stringify({ documents, contents, attachments, seedMarks }) + "\n");
cpSync(workspace, join(out, "workspace"), { recursive: true, filter: (src) => !src.split(/[\\/]/).pop().startsWith(".") });

const marks = Object.values(seedMarks).reduce((n, m) => n + m.bookmarks.length + m.highlights.length, 0);
console.log(`demo-bundle: ${documents.length} documents, ${attachments.length} attachments, ${marks} seed marks → ${out}`);
