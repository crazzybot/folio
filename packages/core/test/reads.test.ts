import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { recordId } from "../src/marks";
import { hashFile, MAX_READ_VERSIONS, ReadsStore } from "../src/reads";

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

  it("counts a version read before as read, as after switching branches", async () => {
    await store.list(workspace, docs("docs/a.md"));
    // Another branch: its version is read there
    edit("docs/a.md", "# A on a branch\n");
    await store.mark(at("docs/a.md"), sha1("# A on a branch\n"));
    // Back on the first branch: read, and it's the last read again
    edit("docs/a.md", "# A\n");
    const [back] = await store.list(workspace, docs("docs/a.md"));
    expect([back?.read?.sha1, back?.baseline]).toEqual([sha1("# A\n"), true]);
    expect(await store.lastRead(at("docs/a.md"))).toBe("# A\n");
    // So an edit there is compared with it, not with the branch's version
    edit("docs/a.md", "# A, revised\n");
    expect(await store.lastRead(at("docs/a.md"))).toBe("# A\n");
    // And the branch's version is still read
    edit("docs/a.md", "# A on a branch\n");
    const [again] = await store.list(workspace, docs("docs/a.md"));
    expect([again?.read?.sha1, again?.baseline]).toEqual([sha1("# A on a branch\n"), false]);
  });

  it("forgets the version marked unread, so listing doesn't count it as read", async () => {
    await store.list(workspace, docs("docs/a.md"));
    edit("docs/a.md", "# A2\n");
    await store.mark(at("docs/a.md"), sha1("# A2\n"));
    edit("docs/a.md", "# A\n");
    await store.list(workspace, docs("docs/a.md"));
    await store.unmark(at("docs/a.md"));
    const [a] = await store.list(workspace, docs("docs/a.md"));
    expect(a?.read?.sha1).toBe(sha1("# A2\n"));
  });

  it("remembers at most MAX_READ_VERSIONS versions", async () => {
    await store.list(workspace, docs("docs/a.md"));
    for (let n = 1; n <= MAX_READ_VERSIONS; n++) {
      edit("docs/a.md", `# A${n}\n`);
      await store.mark(at("docs/a.md"), sha1(`# A${n}\n`));
    }
    // The baseline's version is the one that went
    edit("docs/a.md", "# A\n");
    const [a] = await store.list(workspace, docs("docs/a.md"));
    expect(a?.read?.sha1).toBe(sha1(`# A${MAX_READ_VERSIONS}\n`));
    expect((await store.versions()).size).toBe(MAX_READ_VERSIONS);
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

describe("snapshots", () => {
  it("keeps the version read, so a changed document can be compared with it", async () => {
    await store.list(workspace, docs("docs/a.md"));
    edit("docs/a.md", "# A, revised\n");
    expect(await store.lastRead(at("docs/a.md"))).toBe("# A\n");
    await store.mark(at("docs/a.md"), sha1("# A, revised\n"));
    expect(await store.lastRead(at("docs/a.md"))).toBe("# A, revised\n");
    expect(await store.lastRead(at("docs/none.md"))).toBeNull();
  });

  it("collects snapshots no record points at", async () => {
    await store.list(workspace, docs("docs/a.md", "docs/b.md"));
    edit("docs/a.md", "# A2\n");
    await store.mark(at("docs/a.md"), sha1("# A2\n"));
    edit("docs/a.md", "# A3\n");
    await store.mark(at("docs/a.md"), sha1("# A3\n"));
    // Every version of a.md read, and b.md's
    const keep = await store.versions();
    expect([...keep].sort()).toEqual([sha1("# A\n"), sha1("# A2\n"), sha1("# A3\n"), sha1("# B\n")].sort());
    // Unmarked, A3 goes: nothing points at it
    await store.unmark(at("docs/a.md"));
    expect(await store.snapshots.collect(await store.versions())).toBe(1);
    expect(await store.snapshots.read(sha1("# A3\n"))).toBeNull();
    expect(await store.snapshots.read(sha1("# A2\n"))).toBe("# A2\n");
  });
});

describe("hashFile", () => {
  it("hashes the bytes, and is null for a missing file", async () => {
    writeFileSync(at("docs/crlf.md"), "one\r\ntwo\r\n");
    expect(await hashFile(at("docs/crlf.md"))).toBe(sha1("one\r\ntwo\r\n"));
    expect(await hashFile(at("docs/none.md"))).toBeNull();
  });
});
