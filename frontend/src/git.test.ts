import { describe, expect, it } from "vitest";
import { branchLabel, branchSentence, isOnBase, repositoryAtFolder, repositoryOf } from "./git";
import type { GitRepository, GitState } from "./types";

function repo(location: string, changes: Partial<GitRepository> = {}): GitRepository {
  return {
    location,
    root: `/code/${location || "workspace"}`,
    branch: "main",
    head: "1a2b3c4",
    base: "main",
    mainCheckout: null,
    worktrees: [],
    ...changes,
  };
}

const state: GitState = { repositories: [repo(""), repo("projects/api"), repo("projects/api/vendor/lib")] };

describe("repositoryOf", () => {
  it("finds the deepest repository holding a location", () => {
    expect(repositoryOf(state, "README.md")?.location).toBe("");
    expect(repositoryOf(state, "projects/api/docs/a.md")?.location).toBe("projects/api");
    expect(repositoryOf(state, "projects/api")?.location).toBe("projects/api");
    expect(repositoryOf(state, "projects/api/vendor/lib/x.md")?.location).toBe("projects/api/vendor/lib");
    // Only a name in common
    expect(repositoryOf(state, "projects/api-old/a.md")?.location).toBe("");
  });

  it("finds none outside the repositories", () => {
    const nested: GitState = { repositories: [repo("api")] };
    expect(repositoryOf(nested, "notes/a.md")).toBeNull();
    expect(repositoryOf(nested, "")).toBeNull();
    expect(repositoryOf(null, "a.md")).toBeNull();
  });
});

describe("repositoryAtFolder", () => {
  it("finds the nested repository whose root a row shows", () => {
    expect(repositoryAtFolder(state, "projects/api")?.location).toBe("projects/api");
    expect(repositoryAtFolder(state, "projects")).toBeNull();
    expect(repositoryAtFolder(state, "projects/api/docs")).toBeNull();
  });

  it("counts every folder of a merged chain", () => {
    // "api / docs": the repository's root is the chain's first folder
    expect(repositoryAtFolder(state, "projects/api/docs", 2)?.location).toBe("projects/api");
    expect(repositoryAtFolder(state, "projects/api/docs/guides", 2)).toBeNull();
  });

  it("leaves out the workspace's own repository", () => {
    expect(repositoryAtFolder({ repositories: [repo("")] }, "docs")).toBeNull();
  });
});

describe("branches", () => {
  it("shows the branch, or the commit when detached", () => {
    expect(branchLabel(repo(""))).toBe("main");
    expect(branchLabel(repo("", { branch: null }))).toBe("1a2b3c4");
    expect(branchSentence(repo("", { branch: null }))).toBe("Detached at 1a2b3c4");
  });

  it("compares with the base branch, local or origin's", () => {
    expect(isOnBase(repo(""))).toBe(true);
    expect(isOnBase(repo("", { base: "origin/main" }))).toBe(true);
    expect(isOnBase(repo("", { branch: "feature/x", base: "origin/main" }))).toBe(false);
    expect(isOnBase(repo("", { branch: null }))).toBe(false);
    expect(isOnBase(repo("", { branch: "feature/x", base: null }))).toBe(true);
  });
});
