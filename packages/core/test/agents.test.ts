import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentsFolder, isLive, liveAgents, requestStop, requestStopSync, stopFile, stopRequested, writePresence } from "../src/agents";
import type { AgentPresence } from "../src/agents";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const alive = (pid: number) => pid !== 999;

function presence(extra: Partial<AgentPresence>): AgentPresence {
  return { version: 1, pid: 1, root: "/repo", client: "Claude Code", state: "waiting", since: at(0), until: at(60_000), updated: at(0), ...extra };
}

describe("isLive", () => {
  it("keeps a waiting session live until a minute past its deadline", () => {
    expect(isLive(presence({ until: at(-30_000) }), NOW, alive)).toBe(true);
    expect(isLive(presence({ until: at(-90_000) }), NOW, alive)).toBe(false);
    expect(isLive(presence({ until: undefined }), NOW, alive)).toBe(false);
  });

  it("keeps a working session live for half an hour", () => {
    expect(isLive(presence({ state: "working", updated: at(-10 * 60_000) }), NOW, alive)).toBe(true);
    expect(isLive(presence({ state: "working", updated: at(-40 * 60_000) }), NOW, alive)).toBe(false);
  });

  it("drops a session whose process is gone", () => {
    expect(isLive(presence({ pid: 999 }), NOW, alive)).toBe(false);
  });
});

describe("liveAgents", () => {
  it("reads the sessions written, skipping stale and unreadable files", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-agents-"));
    expect(await liveAgents(dataDir, NOW, alive)).toEqual([]); // no folder yet

    await writePresence(dataDir, { pid: 1, root: "/repo", client: "Claude Code", state: "waiting", since: at(0), until: at(240_000) });
    await writePresence(dataDir, { pid: 999, root: "/gone", client: "Cursor", state: "waiting", since: at(0), until: at(240_000) });
    writeFileSync(path.join(agentsFolder(dataDir), "2.json"), "{ half");
    writeFileSync(path.join(agentsFolder(dataDir), "3.json"), JSON.stringify({ version: 2, pid: 3 }));

    const live = await liveAgents(dataDir, NOW, alive);
    expect(live.map((a) => [a.pid, a.root, a.state])).toEqual([[1, "/repo", "waiting"]]);

    // Asked to stop: gone before the session notices
    await requestStop(dataDir, 1);
    expect(await liveAgents(dataDir, NOW, alive)).toEqual([]);
  });
});

describe("liveAgents and the agent panel", () => {
  it("keeps the panel session a session names, and skips a file with a malformed one", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-agents-"));
    await writePresence(dataDir, { pid: 1, root: "/repo", client: "Claude Code", state: "waiting", since: at(0), until: at(240_000), panelSession: "s1" });
    writeFileSync(
      path.join(agentsFolder(dataDir), "2.json"),
      JSON.stringify({ version: 1, pid: 2, root: "/repo", client: "Claude Code", state: "working", since: at(0), updated: at(0), panelSession: 7 }),
    );
    const live = await liveAgents(dataDir, NOW, alive);
    expect(live.map((a) => [a.pid, a.panelSession])).toEqual([[1, "s1"]]);
  });
});

describe("stopRequested", () => {
  it("says why a session was asked to stop", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-agents-"));
    expect(await stopRequested(dataDir, 1)).toBeNull();
    await requestStop(dataDir, 1);
    expect(await stopRequested(dataDir, 1)).toBe("ended");
    requestStopSync(dataDir, 2, "quit");
    expect(await stopRequested(dataDir, 2)).toBe("quit");
    await requestStop(dataDir, 4, "closed");
    expect(await stopRequested(dataDir, 4)).toBe("closed");
    // An older app's stop file has no reason: the user ended the loop
    writeFileSync(stopFile(dataDir, 3), "{}");
    expect(await stopRequested(dataDir, 3)).toBe("ended");
  });
});
