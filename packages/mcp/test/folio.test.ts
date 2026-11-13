import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MarksStore, realPath } from "../../core/src/marks";
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

  it("refuses paths it doesn't list", async () => {
    await expect(folio.reviewNotes({ paths: ["docs/missing.md"] }, "Claude Code")).rejects.toThrow("missing.md");
    await expect(folio.reviewNotes({ paths: ["/etc/hosts"] }, "Claude Code")).rejects.toBeInstanceOf(FolioError);
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

describe("agentName", () => {
  it("names known clients and tidies others", () => {
    expect(agentName("claude-code")).toBe("Claude Code");
    expect(agentName("my-agent")).toBe("My Agent");
    expect(agentName("Some Tool")).toBe("Some Tool");
    expect(agentName(undefined)).toBe("Agent");
  });
});
