import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTracker, sessionsFor } from "../src/agents";
import { stopRequested, writePresence } from "../../packages/core/src/agents";
import type { AgentPresence } from "../../packages/core/src/agents";

const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), "folio-agents-ws-")));
mkdirSync(path.join(work, "projects", "Api"), { recursive: true });

const presence = (root: string): AgentPresence => ({
  version: 1,
  pid: 1,
  root,
  client: "Claude Code",
  state: "waiting",
  since: "2026-11-14T12:00:00Z",
  until: "2026-11-14T12:04:00Z",
  updated: "2026-11-14T12:00:00Z",
});

describe("sessionsFor", () => {
  it("places sessions inside the workspace at their folder, in its own case", () => {
    const [session] = sessionsFor(work, [presence(path.join(work, "projects", "Api"))]);
    expect(session?.location).toBe("projects/Api");
  });

  it("puts a session on the workspace, or a folder holding it, at the top", () => {
    expect(sessionsFor(work, [presence(work)]).map((s) => s.location)).toEqual([""]);
    expect(sessionsFor(path.join(work, "projects"), [presence(work)]).map((s) => s.location)).toEqual([""]);
  });

  it("leaves out sessions elsewhere", () => {
    expect(sessionsFor(path.join(work, "projects"), [presence(path.join(work, "projectsX"))])).toEqual([]);
    expect(sessionsFor(work, [presence(path.join(os.tmpdir(), "folio-agents-elsewhere"))])).toEqual([]);
  });
});

describe("AgentTracker", () => {
  // A session in the workspace's projects/Api, as live as the test process
  const tracking = async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-agents-data-"));
    const until = new Date(Date.now() + 240_000).toISOString();
    const root = path.join(work, "projects", "Api");
    await writePresence(dataDir, { pid: process.pid, root, client: "Claude Code", state: "waiting", since: until, until });
    const tracker = new AgentTracker(dataDir, () => {});
    tracker.setWorkspace(work);
    await tracker.refresh();
    expect(tracker.current().map((s) => s.pid)).toEqual([process.pid]);
    return { dataDir, tracker };
  };
  // setWorkspace's stop and refresh run in the background
  const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

  it("keeps the loops of sessions the new workspace still covers", async () => {
    const { dataDir, tracker } = await tracking();
    tracker.setWorkspace(work); // the same one, as when skipped folders change
    tracker.setWorkspace(path.join(work, "projects"));
    await settled();
    expect(await stopRequested(dataDir, process.pid)).toBeNull();
    expect(tracker.current().map((s) => s.location)).toEqual(["Api"]);
  });

  it("ends the loops of sessions on a workspace it closes", async () => {
    const { dataDir, tracker } = await tracking();
    tracker.setWorkspace(path.join(os.tmpdir(), "folio-agents-elsewhere"));
    await settled();
    expect(await stopRequested(dataDir, process.pid)).toBe("closed");
    expect(tracker.current()).toEqual([]);
  });

  it("ends the loop of every session it shows when the app quits", async () => {
    const { dataDir, tracker } = await tracking();

    tracker.endAllOnQuit();
    expect(tracker.current()).toEqual([]);
    expect(await stopRequested(dataDir, process.pid)).toBe("quit");
  });
});
