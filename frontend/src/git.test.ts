import { describe, expect, it } from "vitest";
import { branchLabel, branchSentence, changeSentence, changesById, commitSentence, isOnBase, repositoryAtFolder, repositoryOf } from "./git";
import type { DocumentMeta, GitRepository, GitState } from "./types";

function repo(location: string, changes: Partial<GitRepository> = {}): GitRepository {
  return {
    location,
    root: `/code/${location || "workspace"}`,
    branch: "main",
    head: "1a2b3c4",
    base: "main",
    baseChosen: false,
    mainCheckout: null,
    worktrees: [],
    changes: [],
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

describe("changesById", () => {
  const doc = (location: string) => ({ id: `id-${location}`, location }) as DocumentMeta;

  it("finds each listed document's change, in any repository", () => {
    const changed: GitState = {
      repositories: [
        repo("", { changes: [{ location: "docs/spec.md", status: "A", uncommitted: false }] }),
        repo("api", { changes: [{ location: "api/README.md", status: "M", uncommitted: true }] }),
      ],
    };
    const byId = changesById(changed, [doc("docs/spec.md"), doc("api/README.md"), doc("notes.md")]);
    expect([...(byId ?? [])]).toEqual([
      ["id-docs/spec.md", { location: "docs/spec.md", status: "A", uncommitted: false }],
      ["id-api/README.md", { location: "api/README.md", status: "M", uncommitted: true }],
    ]);
  });

  it("is null without git state, so the filter is left out", () => {
    expect(changesById(null, [doc("a.md")])).toBeNull();
  });
});

describe("changeSentence", () => {
  it("says how a document changed on the branch", () => {
    expect(changeSentence({ location: "a.md", status: "A", uncommitted: false })).toBe("Added on this branch");
    expect(changeSentence({ location: "a.md", status: "M", uncommitted: true })).toBe(
      "Modified on this branch, with uncommitted changes",
    );
  });
});

describe("commitSentence", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  it("names the subject, author and day, and Claude when it co-wrote it", () => {
    const commit = { subject: "Retry budget", author: "Ada", date: "2026-11-03T10:00:00Z", withClaude: true };
    const sentence = commitSentence(commit, now);
    expect(sentence.startsWith("Retry budget · Ada · ")).toBe(true);
    expect(sentence.endsWith(" · with Claude")).toBe(true);
    expect(sentence).not.toContain("2026");
  });

  it("adds the year for an older commit and leaves out a date it can't read", () => {
    expect(commitSentence({ subject: "s", author: "a", date: "2024-02-01T10:00:00Z", withClaude: false }, now)).toContain("2024");
    expect(commitSentence({ subject: "s", author: "a", date: "", withClaude: false }, now)).toBe("s · a");
  });
});
