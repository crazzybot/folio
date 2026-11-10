import { mkdtempSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MarksStore } from "../../packages/core/src/marks";
import { watchMarks, watchWorkspace } from "../src/watcher";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("watchWorkspace", () => {
  let dir = "";
  afterEach(() => {
    watchWorkspace(null, new Set(), () => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports markdown changes once per burst, ignoring other files and skipped folders", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "folio-watch-"));
    mkdirSync(path.join(dir, "docs"));
    mkdirSync(path.join(dir, "node_modules"));
    let calls = 0;
    watchWorkspace(dir, new Set(["node_modules"]), () => calls++);
    // macOS delivers file events late: let the folder creation above arrive first
    await sleep(500);
    calls = 0;

    writeFileSync(path.join(dir, "notes.txt"), "x");
    writeFileSync(path.join(dir, "node_modules", "a.md"), "x");
    await sleep(400);
    expect(calls).toBe(0);

    for (let i = 0; i < 5; i++) writeFileSync(path.join(dir, "docs", "a.md"), `# ${i}`);
    await sleep(400);
    expect(calls).toBe(1);

    unlinkSync(path.join(dir, "docs", "a.md"));
    await sleep(400);
    expect(calls).toBe(2);

    renameSync(path.join(dir, "docs"), path.join(dir, "guides"));
    await sleep(400);
    expect(calls).toBe(3);
  });
});

describe("watchMarks", () => {
  let dir = "";
  let stop = () => {};
  afterEach(() => {
    stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reports records changed by another process, not the app's own", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "folio-watch-marks-"));
    const doc = path.join(dir, "doc.md");
    writeFileSync(doc, "No headings here.");
    const app = new MarksStore(path.join(dir, "data"));
    const agent = new MarksStore(path.join(dir, "data"));
    let calls = 0;
    stop = watchMarks(app.folder, (id) => app.changedOutside(id), () => calls++);
    await sleep(500);
    const body = { color: "yellow", quote: { exact: "No headings" }, position: { start: 0, end: 11 } };

    const own = await app.addHighlight(doc, body);
    await app.updateHighlight(doc, own.id, { note: "Mine" });
    writeFileSync(path.join(app.folder, "notes.txt"), "x");
    await sleep(400);
    expect(calls).toBe(0);

    await agent.updateHighlight(doc, own.id, { color: "blue" });
    await agent.addHighlight(doc, body);
    await sleep(400);
    expect(calls).toBe(1);

    // Removed by another process
    for (const h of (await agent.records())[0]?.[1].highlights ?? []) await agent.deleteHighlight(doc, h.id);
    await sleep(400);
    expect(calls).toBe(2);
  });
});
