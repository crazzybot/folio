import { beforeEach, describe, expect, it, vi } from "vitest";

// The desktop app's view state, as storage.ts reads it
const values = new Map<string, string>();
const api = {
  workspacePath: "/work/a" as string | null,
  viewState: { get: (key: string) => values.get(key) ?? null, set: (key: string, value: string) => values.set(key, value) },
};
vi.stubGlobal("window", { markdownApi: api });
const { recallForWorkspace, rememberForWorkspace } = await import("./workspaceMemory");

const KEY = "folio.test";

beforeEach(() => {
  values.clear();
  api.workspacePath = "/work/a";
});

describe("workspace memory", () => {
  it("keeps a value per workspace", () => {
    rememberForWorkspace(KEY, "notes/a.md");
    api.workspacePath = "/work/b";
    expect(recallForWorkspace(KEY)).toBeNull();
    rememberForWorkspace(KEY, "b.md");
    api.workspacePath = "/work/a";
    expect(recallForWorkspace(KEY)).toBe("notes/a.md");
  });

  it("forgets a value set to null", () => {
    rememberForWorkspace(KEY, "a.md");
    rememberForWorkspace(KEY, null);
    expect(recallForWorkspace(KEY)).toBeNull();
  });

  it("treats malformed storage as nothing remembered", () => {
    values.set(KEY, "not json");
    expect(recallForWorkspace(KEY)).toBeNull();
    values.set(KEY, "[1, 2]");
    expect(recallForWorkspace(KEY)).toBeNull();
  });

  it("keeps the most recently used workspaces", () => {
    for (let i = 0; i < 55; i++) {
      api.workspacePath = `/work/${i}`;
      rememberForWorkspace(KEY, `${i}.md`);
    }
    api.workspacePath = "/work/0";
    expect(recallForWorkspace(KEY)).toBeNull();
    api.workspacePath = "/work/54";
    expect(recallForWorkspace(KEY)).toBe("54.md");
  });
});
