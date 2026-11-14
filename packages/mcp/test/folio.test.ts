import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { requestStop, stopRequested } from "../../core/src/agents";
import { MarksStore, newRoundId, realPath } from "../../core/src/marks";
import type { Highlight } from "../../core/src/marks";
import { agentName, Folio, FolioError } from "../src/folio";

const ADR = `# Event store

Status: proposed

## Decision

We will store events in Postgres, one table per aggregate.
`;

let root: string;
let dataDir: string;
let store: MarksStore;
let folio: Folio;
let settings: Record<string, unknown>;

const adr = () => path.join(root, "docs", "adr.md");
const file = (location: string) => path.join(realPath(root), ...location.split("/"));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "folio-mcp-root-"));
  dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-mcp-data-"));
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "node_modules"));
  writeFileSync(adr(), ADR);
  writeFileSync(path.join(root, "README.md"), "---\ntags: [intro]\n---\n# Readme\n\nHello.\n");
  writeFileSync(path.join(root, "node_modules", "dep.md"), "# Not listed\n");
  store = new MarksStore(dataDir);
  settings = {};
  folio = new Folio({ root, dataDir, settings: () => settings, watch: false });
});

async function note(text: string | null, extra: Record<string, unknown> = {}): Promise<Highlight> {
  const exact = "one table per aggregate";
  const start = ADR.indexOf(exact);
  const added = await store.addHighlight(adr(), {
    color: "yellow",
    note: text,
    quote: { exact, prefix: "", suffix: "" },
    position: { start, end: start + exact.length },
  });
  return Object.keys(extra).length === 0 ? added : store.updateHighlight(adr(), added.id, extra);
}

const records = () => store.records().then((all) => all.map(([, record]) => record));

describe("listDocuments", () => {
  it("lists the documents under the root, skipping the default folders", async () => {
    await note("Why?");
    const listed = await folio.listDocuments();
    expect(listed).toEqual([
      { path: file("README.md"), title: "Readme", status: null, tags: ["intro"], openNotes: 0 },
      { path: file("docs/adr.md"), title: "Event store", status: "proposed", tags: [], openNotes: 1 },
    ]);
  });

  it("filters", async () => {
    await note("Why?");
    const paths = async (filter: Parameters<Folio["listDocuments"]>[0]) => (await folio.listDocuments(filter)).map((d) => d.path);
    expect(await paths({ withOpenNotes: true })).toEqual([file("docs/adr.md")]);
    expect(await paths({ folder: "docs" })).toEqual([file("docs/adr.md")]);
    expect(await paths({ folder: path.join(root, "docs") })).toEqual([file("docs/adr.md")]);
    expect(await paths({ status: "Proposed" })).toEqual([file("docs/adr.md")]);
    expect(await paths({ tag: "#intro" })).toEqual([file("README.md")]);
  });

  it("follows the app's scan settings", async () => {
    settings = { skipDirs: ["docs"] };
    expect((await folio.listDocuments()).map((d) => d.path)).toEqual([file("README.md"), file("node_modules/dep.md")]);
  });

  it("refuses a folder outside the root", async () => {
    await expect(folio.listDocuments({ folder: os.tmpdir() })).rejects.toBeInstanceOf(FolioError);
    await expect(folio.listDocuments({ folder: "../elsewhere" })).rejects.toBeInstanceOf(FolioError);
  });
});

describe("reviewNotes", () => {
  it("gives the notes with their ids, marks them sent and records a round", async () => {
    const h = await note("Why not a single table?");
    await note(null); // a highlight without a note: private
    const result = await folio.reviewNotes({}, "Claude Code");
    expect(result?.text).toContain(`1. ${file("docs/adr.md")}:7 · Event store › Decision · note ${h.id.slice(0, 8)}`);
    expect(result?.text).toContain("Why not a single table?");
    expect([result?.notes, result?.documents]).toEqual([1, 1]);

    const [record] = await records();
    expect(record?.highlights.find((x) => x.id === h.id)?.state).toBe("sent");
    expect(record?.rounds?.map((r) => [r.via, r.client, r.notes])).toEqual([["mcp", "Claude Code", [h.id]]]);

    // Sent: not again, unless asked
    expect(await folio.reviewNotes({}, "Claude Code")).toBeNull();
    expect((await folio.reviewNotes({ includeSent: true }, "Claude Code"))?.notes).toBe(1);
  });

  it("leaves out addressed, resolved and private notes", async () => {
    await note("Done?", { state: "addressed" });
    await note("Closed", { state: "resolved" });
    await note("Mine", { private: true });
    expect(await folio.reviewNotes({}, "Codex")).toBeNull();
    expect((await folio.reviewNotes({ includeAddressed: true }, "Codex"))?.notes).toBe(1);
  });

  it("sends a status change with the document's note", async () => {
    await store.setNote(adr(), { text: null, requestedStatus: "accepted" });
    const result = await folio.reviewNotes({ paths: ["docs/adr.md"] }, "Claude Code");
    expect(result?.text).toContain('Status: change it to "accepted". It is "proposed" now, on line 3');
    const [record] = await records();
    expect(record?.documentNote?.state).toBe("sent");
  });

  it("uses the app's opening line", async () => {
    await note("Why?");
    settings = { reviewIntro: "Notes on {documents}:" };
    expect((await folio.reviewNotes({}, "Claude Code"))?.text.split("\n")[0]).toBe("Notes on adr.md:");
  });

  it("starts without an opening line when it's turned off", async () => {
    await note("Why?");
    settings = { reviewIntroOn: false, reviewIntro: "Notes on {documents}:" };
    expect((await folio.reviewNotes({}, "Claude Code"))?.text.startsWith("1. ")).toBe(true);
  });

  it("refuses paths it doesn't list", async () => {
    await expect(folio.reviewNotes({ paths: ["docs/missing.md"] }, "Claude Code")).rejects.toThrow("missing.md");
    await expect(folio.reviewNotes({ paths: ["/etc/hosts"] }, "Claude Code")).rejects.toBeInstanceOf(FolioError);
  });
});

describe("waitForReview", () => {
  /** What Send in the Send dialog records, with an agent in a review loop; or (via copy) Copy. */
  const send = (file: string, highlightIds: string[], via: "send" | "copy" = "send") =>
    store.send(file, {
      roundId: newRoundId(),
      highlightIds,
      documentNote: false,
      markSent: true,
      via,
      ...(via === "send" ? { client: "Claude Code" } : {}),
    });
  /** A wait that isn't stopped: its notes, or null at the timeout. */
  const wait = async (request: Parameters<Folio["waitForReview"]>[0]) => {
    const result = await folio.waitForReview(request, "Claude Code");
    if (result === "stopped") throw new Error("Stopped");
    return result;
  };
  const presence = () => JSON.parse(readFileSync(path.join(dataDir, "agents", `${process.pid}.json`), "utf8")) as Record<string, unknown>;

  it("waits for notes the user sends, and tells the app it's waiting", async () => {
    const h = await note("Why not a single table?");
    const since = new Date().toISOString();
    const waiting = wait({ since, timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(presence()).toMatchObject({ root: realPath(root), client: "Claude Code", state: "waiting", since });

    await send(adr(), [h.id]);
    const sent = await waiting;
    expect(sent?.text).toContain(`note ${h.id.slice(0, 8)}`);
    expect([sent?.notes, sent?.documents]).toEqual([1, 1]);
    expect(Date.parse(sent?.since ?? "")).toBeGreaterThanOrEqual(Date.parse(since) - 1000);
    expect(presence()).toMatchObject({ state: "working", since: sent?.since });
    // No round of its own: the app recorded it
    expect((await records())[0]?.rounds).toHaveLength(1);

    folio.leave();
    expect(() => presence()).toThrow();
  });

  it("only takes notes sent after since, by the user, on documents under the root", async () => {
    const h = await note("Why?");
    await send(adr(), [h.id]);
    const later = new Date(Date.now() + 2_000).toISOString();
    expect(await folio.waitForReview({ since: later, timeoutMs: 300 }, "Claude Code")).toBeNull();

    // An agent's own fetch is a round too, but not one the user sent
    const now = (await records())[0]?.rounds?.[0]?.at ?? "";
    expect(await folio.reviewNotes({ includeSent: true }, "Claude Code")).not.toBeNull();
    const delivered = await wait({ since: now, timeoutMs: 300 });
    expect(delivered?.notes).toBe(1); // the send, in the same second as since
    expect(await folio.waitForReview({ since: now, timeoutMs: 300 }, "Claude Code")).toBeNull(); // given once

    // A document in another repo, sent while this session waits
    const other = mkdtempSync(path.join(os.tmpdir(), "folio-mcp-other-"));
    writeFileSync(path.join(other, "spec.md"), "# Spec\n\nElsewhere.\n");
    const elsewhere = await store.addHighlight(path.join(other, "spec.md"), {
      color: "yellow",
      note: "Not for this session",
      quote: { exact: "Elsewhere", prefix: "", suffix: "" },
      position: { start: 8, end: 17 },
    });
    const waiting = folio.waitForReview({ since: new Date().toISOString(), timeoutMs: 1_000 }, "Claude Code");
    await send(path.join(other, "spec.md"), [elsewhere.id]);
    expect(await waiting).toBeNull();
  });

  it("leaves out notes copied to paste elsewhere", async () => {
    const h = await note("For a colleague");
    const waiting = wait({ since: new Date().toISOString(), timeoutMs: 1_000 });
    await send(adr(), [h.id], "copy");
    expect(await waiting).toBeNull();
  });

  it("ends the loop when the user asks in the app, waiting or not", async () => {
    const waiting = folio.waitForReview({ timeoutMs: 5_000 }, "Claude Code");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await requestStop(dataDir, process.pid);
    expect(await waiting).toBe("stopped");
    expect(() => presence()).toThrow();

    // Asked while the agent worked on notes: the next wait ends at once
    await requestStop(dataDir, process.pid);
    expect(await folio.waitForReview({ timeoutMs: 5_000 }, "Claude Code")).toBe("stopped");
    expect(await stopRequested(dataDir, process.pid)).toBe(false);
  });

  it("stops when the call is cancelled, and refuses a since that isn't a time", async () => {
    const abort = new AbortController();
    const waiting = folio.waitForReview({ timeoutMs: 60_000, signal: abort.signal }, "Claude Code");
    abort.abort();
    expect(await waiting).toBeNull();
    await expect(folio.waitForReview({ since: "yesterday", timeoutMs: 1_000 }, "Claude Code")).rejects.toBeInstanceOf(FolioError);
  });
});

describe("reply", () => {
  it("answers a note by its short id and marks it addressed", async () => {
    const h = await note("Why?");
    await folio.reviewNotes({}, "Claude Code");
    const said = await folio.reply({ noteId: h.id.slice(0, 8), text: "Switched to one table.", addressed: true }, "Claude Code");
    expect(said).toContain("addressed");
    const saved = (await records())[0]?.highlights.find((x) => x.id === h.id);
    expect(saved?.state).toBe("addressed");
    expect(saved?.replies?.map((r) => [r.author, r.text])).toEqual([
      [{ kind: "agent", name: "Claude Code" }, "Switched to one table."],
    ]);
    // The document itself is never written
    expect(readFileSync(adr(), "utf8")).toBe(ADR);
  });

  it("leaves a note open for a question", async () => {
    const h = await note("Why?");
    await folio.reviewNotes({}, "Claude Code");
    expect(await folio.reply({ noteId: h.id, text: "Which table?" }, "Claude Code")).toContain("open");
    expect((await records())[0]?.highlights.find((x) => x.id === h.id)?.state).toBeUndefined();
  });

  it("answers the note on a document as a whole by its path", async () => {
    await store.setNote(adr(), { text: "Overall fine.", requestedStatus: null });
    await folio.reply({ path: adr(), text: "Thanks.", addressed: true }, "Claude Code");
    expect((await records())[0]?.documentNote?.replies?.[0]?.text).toBe("Thanks.");
  });

  it("refuses an unknown or malformed note", async () => {
    await note("Why?");
    const refused = (request: Parameters<Folio["reply"]>[0]) => expect(folio.reply(request, "X")).rejects.toBeInstanceOf(FolioError);
    await refused({ noteId: "ffffffff", text: "Hi" });
    await refused({ noteId: "xyz", text: "Hi" });
    await refused({ text: "Hi" });
    await refused({ path: path.join(root, "README.md"), text: "Hi" }); // no note on it
    await refused({ path: os.tmpdir(), text: "Hi" });
  });
});

describe("documents on another branch", () => {
  it("keeps the marks of a document that's only on another branch where they are", async () => {
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env });
    // feature/x renames docs/old/spec.md to docs/spec.md without edits
    mkdirSync(path.join(root, "docs", "old"));
    writeFileSync(path.join(root, "docs", "old", "spec.md"), "# Spec\n\nShip it.\n");
    git("init", "-q", "-b", "main");
    git("add", "docs/old/spec.md");
    git("commit", "-q", "-m", "spec");
    git("checkout", "-q", "-b", "feature/x");
    git("mv", "docs/old/spec.md", "docs/spec.md");
    git("commit", "-q", "-m", "move");
    await store.addBookmark(path.join(root, "docs", "spec.md"), { heading: null });
    // Back on main, the marked file is gone and an identical one is there
    git("checkout", "-q", "main");

    await folio.listDocuments();
    expect((await records()).map((record) => record.path)).toEqual([file("docs/spec.md")]);
  });
});

describe("agentName", () => {
  it("names known clients and tidies others", () => {
    expect(agentName("claude-code")).toBe("Claude Code");
    expect(agentName("my-agent")).toBe("My Agent");
    expect(agentName("Some Tool")).toBe("Some Tool");
    expect(agentName(undefined)).toBe("Agent");
  });
});
