import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { recordId } from "../src/marks";
import { hashFile, ReadsStore } from "../src/reads";

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

let workspace: string;
let dataDir: string;
let store: ReadsStore;

const at = (location: string) => path.join(workspace, ...location.split("/"));
const docs = (...locations: string[]) => locations.map((location) => ({ id: `id:${location}`, location }));
/** Change a file so its hash cache can't mistake it for the old version. */
function edit(location: string, text: string): void {
  writeFileSync(at(location), text);
  const later = new Date(Date.now() + 5_000);
  utimesSync(at(location), later, later);
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(os.tmpdir(), "folio-reads-ws-"));
  dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-reads-data-"));
  mkdirSync(path.join(workspace, "docs"));
  writeFileSync(at("docs/a.md"), "# A\n");
  writeFileSync(at("docs/b.md"), "# B\n");
  store = new ReadsStore(dataDir);
});

describe("ReadsStore", () => {
  it("records every document as read the first time a workspace is listed", async () => {
    const listed = await store.list(workspace, docs("docs/a.md", "docs/b.md"));
    expect(listed.map((d) => [d.docId, d.sha1, d.read?.sha1, d.baseline])).toEqual([
      ["id:docs/a.md", sha1("# A\n"), sha1("# A\n"), true],
      ["id:docs/b.md", sha1("# B\n"), sha1("# B\n"), true],
    ]);
  });

  it("shows documents added later as new, and edited ones as changed", async () => {
    await store.list(workspace, docs("docs/a.md", "docs/b.md"));
    writeFileSync(at("docs/c.md"), "# C\n");
    edit("docs/a.md", "# A, revised\n");
    const listed = await store.list(workspace, docs("docs/a.md", "docs/b.md", "docs/c.md"));
    expect(listed.map((d) => [d.docId, d.sha1 === d.read?.sha1, d.read === null])).toEqual([
      ["id:docs/a.md", false, false],
      ["id:docs/b.md", true, false],
      ["id:docs/c.md", false, true],
    ]);
  });

  it("records the baseline once per workspace, even after a document is marked unread", async () => {
    await store.list(workspace, docs("docs/a.md"));
    await store.unmark(at("docs/a.md"));
    const [a] = await store.list(workspace, docs("docs/a.md"));
    expect(a?.read).toBeNull();
  });

  it("marks the version shown as read, and refuses one that's no longer on disk", async () => {
    await store.list(workspace, docs("docs/a.md"));
    edit("docs/a.md", "# A2\n");
    await expect(store.mark(at("docs/a.md"), sha1("# A\n"))).rejects.toMatchObject({ status: 409 });
    await expect(store.mark(at("docs/a.md"), "not a hash")).rejects.toMatchObject({ status: 400 });
    const read = await store.mark(at("docs/a.md"), sha1("# A2\n"));
    const [a] = await store.list(workspace, docs("docs/a.md"));
    expect([a?.read, a?.baseline]).toEqual([read, false]);
  });

  it("goes back one read on Mark as unread", async () => {
    await store.list(workspace, docs("docs/a.md"));
    edit("docs/a.md", "# A2\n");
    await store.mark(at("docs/a.md"), sha1("# A2\n"));
    // Reading it again keeps the step back
    await store.mark(at("docs/a.md"), sha1("# A2\n"));
    await store.unmark(at("docs/a.md"));
    const [a] = await store.list(workspace, docs("docs/a.md"));
    expect(a?.read?.sha1).toBe(sha1("# A\n"));
    // Nothing before that: it's new
    await store.unmark(at("docs/a.md"));
    expect((await store.list(workspace, docs("docs/a.md")))[0]?.read).toBeNull();
  });

  it("marks many at their current versions", async () => {
    await store.list(workspace, docs("docs/a.md", "docs/b.md"));
    edit("docs/a.md", "# A2\n");
    edit("docs/b.md", "# B2\n");
    await store.markAll([at("docs/a.md"), at("docs/b.md"), at("docs/gone.md")]);
    const listed = await store.list(workspace, docs("docs/a.md", "docs/b.md"));
    expect(listed.every((d) => d.read?.sha1 === d.sha1)).toBe(true);
  });

  it("keeps a record per document, with the id its marks have", async () => {
    await store.list(workspace, docs("docs/a.md"));
    const file = path.join(dataDir, "reads", `${recordId(at("docs/a.md"))}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, baseline: true });
  });
});

describe("hashFile", () => {
  it("hashes the bytes, and is null for a missing file", async () => {
    writeFileSync(at("docs/crlf.md"), "one\r\ntwo\r\n");
    expect(await hashFile(at("docs/crlf.md"))).toBe(sha1("one\r\ntwo\r\n"));
    expect(await hashFile(at("docs/none.md"))).toBeNull();
  });
});
