// Builds the live demo's data (docs/design/live-demo.md, frontend/src/demo/):
//
//   demo/build/bundle.json   the documents, their Markdown, the attachments,
//                            the seed marks, and the versions read before
//                            the seeded review round
//   demo/build/workspace/…   a copy of the demo repository, for images and
//                            linked files
//
// from demo/relay/ and demo/seed-marks.json. It scans with the desktop app's
// own scanner (run `npm run build:main` first; `npm run demo:bundle` does),
// so titles, headings and ids are what the app would show.
//
// Another folder can be bundled instead, e.g. for the demo recording
// (scripts/media/README.md):
//
//   npm run demo:bundle -- --workspace <dir> [--seed <file>] [--out <dir>]
//
// Paths are relative to where npm was run. With --workspace, there are no
// seed marks unless --seed names a file; --out defaults to demo/build/
// either way (`npm run dev:demo` serves another one with FOLIO_DEMO_DATA).
//
// Fails when a seed mark's quote or heading isn't in its document, so
// editing the demo documents can't silently drop a seed mark; and when a
// version read before the round doesn't differ from the document, or lacks
// a quote noted on it.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(desktop, "..");

const { values: args } = parseArgs({
  options: { workspace: { type: "string" }, seed: { type: "string" }, out: { type: "string" } },
});
// npm runs scripts in desktop/; INIT_CWD is where it was run from
const fromCwd = (path) => resolve(process.env.INIT_CWD ?? process.cwd(), path);
const workspace = args.workspace === undefined ? join(root, "demo", "relay") : fromCwd(args.workspace);
const seedFile =
  args.seed !== undefined ? fromCwd(args.seed) : args.workspace === undefined ? join(root, "demo", "seed-marks.json") : null;
const out = args.out === undefined ? join(root, "demo", "build") : fromCwd(args.out);

const { scanWorkspace, scanAttachments, findDocument } = createRequire(import.meta.url)(
  join(desktop, "dist", "packages", "core", "src", "scanner.js"),
);

// Seed marks carry fixed ids and times, so the bundle only changes when the
// demo does
const SEED_TIME = "2026-11-01T09:00:00Z";
const COLORS = new Set(["yellow", "green", "blue", "pink"]);
const MARKDOWN_SYNTAX = /[*_`[\]#<>|$\\]/;

const seedId = (...parts) => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 16);
const sha1 = (text) => createHash("sha1").update(text, "utf8").digest("hex");
// Notes in the seeded round: sent, and either still waiting or answered
const ROUND_STATES = new Set(["sent", "addressed"]);

function fail(message) {
  console.error(`demo-bundle: ${message}`);
  process.exit(1);
}

/** Whether `path` is `dir` or inside it. */
function within(path, dir) {
  const rel = relative(dir, path);
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

// The output folder is replaced: only ever an earlier bundle, never the
// workspace or a folder that has other things in it
if (within(out, workspace) || within(workspace, out)) fail(`--out (${out}) and the workspace (${workspace}) overlap`);
if (existsSync(out) && readdirSync(out).length > 0 && !existsSync(join(out, "bundle.json"))) {
  fail(`${out} isn't empty and has no bundle.json: not replacing it`);
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
function highlight(location, content, entry, index, round) {
  const { quote, color, note = null, state, replies = [] } = entry;
  if (typeof quote !== "string" || quote.trim() === "") fail(`${location}: a highlight needs a quote`);
  if (!COLORS.has(color)) fail(`${location}: "${quote}": color must be one of ${[...COLORS].join(", ")}`);
  if (quote.includes("\n") || MARKDOWN_SYNTAX.test(quote)) {
    fail(`${location}: "${quote}": quotes must be one line of plain text, with no Markdown syntax`);
  }
  if (!content.split(/\r?\n/).some((line) => line.includes(quote))) fail(`${location}: "${quote}" isn't in the document`);
  if (state !== undefined && (!ROUND_STATES.has(state) || round === null || note === null)) {
    fail(`${location}: "${quote}": only a note can have a state, "sent" or "addressed", and only with a "round"`);
  }
  if (replies.length > 0 && state === undefined) fail(`${location}: "${quote}": replies need the note to be in the round`);
  const id = seedId(location, "highlight", index, quote);
  // No position or surrounding text: the viewer's anchoring finds the quote
  // by its text (frontend/src/anchoring.ts), the first occurrence when there
  // are several
  return {
    id,
    color,
    note,
    quote: { exact: quote, prefix: "", suffix: "" },
    position: { start: 0, end: quote.length },
    created: SEED_TIME,
    updated: SEED_TIME,
    ...(state === undefined ? {} : { state }),
    // The agent's answers, simulated: never seen, so they show as new
    ...(replies.length === 0
      ? {}
      : {
          replies: replies.map((reply, j) => {
            if (typeof reply.text !== "string" || typeof reply.at !== "string") fail(`${location}: "${quote}": a reply needs text and at`);
            return { id: seedId(id, "reply", j), author: { kind: "agent", name: round.agent }, text: reply.text, at: reply.at };
          }),
        }),
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

const seed = seedFile === null ? {} : JSON.parse(readFileSync(seedFile, "utf8"));
const round = seed.round ?? null;
if (round !== null && (typeof round.at !== "string" || typeof round.agent !== "string")) fail(`"round" needs at and agent`);

// The versions read before the round: by document id, their text and when
// (the round's time: they were read, then the notes on them were sent)
const readVersions = {};
for (const [location, file] of Object.entries(seed.readVersions ?? {})) {
  const meta = documents.find((doc) => doc.location === location);
  if (meta === undefined) fail(`a read version of ${location}, which isn't a demo document`);
  const path = resolve(dirname(seedFile), file);
  if (!existsSync(path)) fail(`${location}: its read version ${file} doesn't exist`);
  const text = readFileSync(path, "utf8");
  if (text === contents[meta.id]) fail(`${location}: its read version is the same as the document`);
  if (round === null) fail(`read versions need a "round"`);
  readVersions[meta.id] = { text, at: round.at };
}

const seedMarks = {};
for (const [location, entry] of Object.entries(seed.documents ?? {})) {
  const meta = documents.find((doc) => doc.location === location);
  if (meta === undefined) fail(`seed marks for ${location}, which isn't a demo document`);
  const highlights = (entry.highlights ?? []).map((h, i) => highlight(location, contents[meta.id], h, i, round));
  const read = readVersions[meta.id]?.text;
  // Notes were made on the version read: their quotes must be there too
  for (const h of highlights) {
    if (read !== undefined && !read.includes(h.quote.exact)) fail(`${location}: "${h.quote.exact}" isn't in its read version`);
  }
  const sent = highlights.filter((h) => h.state !== undefined);
  seedMarks[meta.id] = {
    bookmarks: (entry.bookmarks ?? []).map((b, i) => bookmark(location, meta, b, i)),
    highlights,
    // The round these notes went out in, with the version sent: the one read before it
    ...(sent.length === 0
      ? {}
      : {
          rounds: [
            {
              id: seedId(location, "round", round.at),
              at: round.at,
              via: "mcp",
              client: round.agent,
              sha1: sha1(read ?? contents[meta.id]),
              notes: sent.map((h) => h.id),
            },
          ],
        }),
  };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bundle.json"), JSON.stringify({ documents, contents, attachments, seedMarks, readVersions }) + "\n");
cpSync(workspace, join(out, "workspace"), { recursive: true, filter: (src) => !src.split(/[\\/]/).pop().startsWith(".") });

const marks = Object.values(seedMarks).reduce((n, m) => n + m.bookmarks.length + m.highlights.length, 0);
console.log(`demo-bundle: ${documents.length} documents, ${attachments.length} attachments, ${marks} seed marks → ${out}`);
