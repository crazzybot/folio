import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionsFor } from "../src/agents";
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
