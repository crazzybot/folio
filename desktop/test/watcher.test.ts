import { mkdtempSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watchWorkspace } from "../src/watcher";

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
