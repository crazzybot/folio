import { describe, expect, it } from "vitest";
import { agentsAtFolder, agentsFor, agentsOnFolder, agentsSentence } from "./agents";
import type { AgentSession } from "./types";

const api: AgentSession = { pid: 1, location: "projects/api", root: "/work/projects/api", client: "Claude Code", state: "waiting" };
const whole: AgentSession = { pid: 2, location: "", root: "/work", client: "Cursor", state: "working" };

describe("agentsFor", () => {
  it("finds the agents a document's notes go to", () => {
    expect(agentsFor([api], "projects/api/docs/adr.md")).toEqual([api]);
    expect(agentsFor([api], "projects/apiary/adr.md")).toEqual([]);
    expect(agentsFor([api, whole], "README.md")).toEqual([whole]);
  });
});

describe("agentsAtFolder", () => {
  it("finds the agents on a folder row, including a chain of folders", () => {
    expect(agentsAtFolder([api, whole], "projects/api")).toEqual([api]);
    expect(agentsAtFolder([api], "projects/api/docs", 2)).toEqual([api]);
    expect(agentsAtFolder([api], "projects")).toEqual([]);
  });
});

describe("agentsOnFolder", () => {
  it("finds the agents on a focused folder or one that holds it, not the workspace's", () => {
    expect(agentsOnFolder([api, whole], "projects/api")).toEqual([api]);
    expect(agentsOnFolder([api, whole], "projects/api/docs")).toEqual([api]);
    expect(agentsOnFolder([api, whole], "projects")).toEqual([]);
    expect(agentsOnFolder([api], "projects/apiary")).toEqual([]);
  });
});

describe("agentsSentence", () => {
  it("says who waits or works where", () => {
    expect(agentsSentence([api, whole])).toBe(
      "Claude Code is waiting for notes in api\nCursor is working on notes in work, and takes new ones next",
    );
  });
});
