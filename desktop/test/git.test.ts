import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitTracker, lastCommit, parseNameStatus, parseStatus, parseWorktrees } from "../src/git";
import type { GitState } from "../src/git";

describe("parseWorktrees", () => {
  it("lists worktrees with their branches, leaving out bare and pruned ones", () => {
    const porcelain = [
      "worktree /code/folio\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main",
      "worktree /code/folio-x\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feature/x",
      "worktree /code/folio-detached\nHEAD 3333333333333333333333333333333333333333\ndetached",
      "worktree /code/folio.git\nbare",
      "worktree /tmp/gone\nHEAD 4444444444444444444444444444444444444444\nbranch refs/heads/old\nprunable gitdir file points to non-existent location",
    ].join("\n\n");
    expect(parseWorktrees(porcelain + "\n", "/code/folio-x")).toEqual([
      { path: "/code/folio", branch: "main", current: false },
      { path: "/code/folio-x", branch: "feature/x", current: true },
      { path: "/code/folio-detached", branch: null, current: false },
    ]);
  });
});

describe("parseStatus", () => {
  it("reads added, modified and untracked files, leaving out deleted ones", () => {
    const out = ["A  docs/new.md", " M docs/a.md", "MM docs/b.md", "?? notes/idea.md", " D docs/gone.md", "AM docs/c.md", ""].join("\0");
    expect([...parseStatus(out)]).toEqual([
      ["docs/new.md", "A"],
      ["docs/a.md", "M"],
      ["docs/b.md", "M"],
      ["notes/idea.md", "A"],
      ["docs/c.md", "A"],
    ]);
  });
});

describe("parseNameStatus", () => {
  it("reads the diff's status and path pairs, leaving out deleted ones", () => {
    expect([...parseNameStatus(["A", "docs/spec.md", "M", "a.md", "D", "old.md", "T", "link.md", ""].join("\0"))]).toEqual([
      ["docs/spec.md", "A"],
      ["a.md", "M"],
      ["link.md", "M"],
    ]);
  });
});

// A real repository: main with a worktree on feature/x, and a nested repository
describe("a workspace in git", () => {
  let tmp = "";
  let repo = "";
  let worktree = "";
  const run = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const read = async (workspace: string, documents: string[]): Promise<GitState | null> => {
    const tracker = new GitTracker(() => {});
    const state = await tracker.refresh(workspace, documents);
    tracker.dispose();
    return state;
  };

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "folio-git-")));
    repo = path.join(tmp, "folio");
    worktree = path.join(tmp, "folio-x");
    mkdirSync(repo);
    run(repo, "init", "-q", "-b", "main");
    write(path.join(repo, "docs", "a.md"), "# A");
    run(repo, "add", ".");
    run(repo, "commit", "-q", "-m", "a");
    run(repo, "worktree", "add", "-q", "-b", "feature/x", worktree);
    write(path.join(worktree, "docs", "spec.md"), "# Spec");
    run(worktree, "add", ".");
    run(worktree, "commit", "-q", "-m", "spec");
    // A nested repository on a branch of its own
    const nested = path.join(repo, "vendor", "lib");
    mkdirSync(nested, { recursive: true });
    run(nested, "init", "-q", "-b", "main");
    write(path.join(nested, "README.md"), "# Lib");
    run(nested, "add", ".");
    run(nested, "commit", "-q", "-m", "lib");
    run(nested, "checkout", "-q", "-b", "fix");
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("reads the branch, base and worktrees of the workspace's repository", async () => {
    const state = await read(path.join(repo, "docs"), ["a.md"]);
    expect(state?.repositories).toEqual([
      {
        location: "",
        root: repo,
        branch: "main",
        head: expect.stringMatching(/^[0-9a-f]{7,}$/),
        base: "main",
        baseChosen: false,
        mainCheckout: null,
        worktrees: [
          { path: repo, branch: "main", current: true },
          { path: worktree, branch: "feature/x", current: false },
        ],
        changes: [],
      },
    ]);
  });

  it("knows a linked worktree and its main checkout", async () => {
    const [own] = (await read(worktree, ["docs/spec.md"]))?.repositories ?? [];
    expect([own?.branch, own?.mainCheckout, own?.worktrees.find((w) => w.current)?.path]).toEqual(["feature/x", repo, worktree]);
  });

  it("finds nested repositories from the documents' folders", async () => {
    const state = await read(repo, ["docs/a.md", "vendor/lib/README.md"]);
    expect(state?.repositories.map((r) => [r.location, r.branch, r.base])).toEqual([
      ["", "main", "main"],
      ["vendor/lib", "fix", "main"],
    ]);
  });

  it("lists the documents changed on the branch, committed or not", async () => {
    write(path.join(worktree, "docs", "a.md"), "# A, revised");
    write(path.join(worktree, "docs", "draft.md"), "# Draft");
    write(path.join(worktree, "docs", "notes.txt"), "not Markdown");
    try {
      const [own] = (await read(path.join(worktree, "docs"), ["a.md", "spec.md", "draft.md"]))?.repositories ?? [];
      expect(own?.changes).toEqual([
        { location: "a.md", status: "M", uncommitted: true },
        { location: "draft.md", status: "A", uncommitted: true },
        { location: "spec.md", status: "A", uncommitted: false },
      ]);
    } finally {
      run(worktree, "checkout", "-q", "--", "docs/a.md");
      rmSync(path.join(worktree, "docs", "draft.md"));
      rmSync(path.join(worktree, "docs", "notes.txt"));
    }
  });

  it("lists only uncommitted changes on the base branch", async () => {
    const [own] = (await read(repo, ["docs/a.md"]))?.repositories ?? [];
    expect(own?.changes).toEqual([]);
  });

  it("compares with the branch chosen for the repository", async () => {
    const tracker = new GitTracker(
      () => {},
      (mainCheckout) => (mainCheckout === repo ? "feature/x" : null),
    );
    const state = await tracker.refresh(worktree, ["docs/spec.md"]);
    tracker.dispose();
    expect([state?.repositories[0]?.base, state?.repositories[0]?.baseChosen, state?.repositories[0]?.changes]).toEqual([
      "feature/x",
      true,
      [],
    ]);
  });

  it("finds the last commit that touched a document, and whether Claude co-wrote it", async () => {
    write(path.join(worktree, "docs", "spec.md"), "# Spec, revised");
    run(worktree, "commit", "-q", "-am", "Revise the spec\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
    expect(await lastCommit(path.join(worktree, "docs", "spec.md"))).toEqual({
      subject: "Revise the spec",
      author: "t",
      date: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      withClaude: true,
    });
    expect((await lastCommit(path.join(repo, "docs", "a.md")))?.withClaude).toBe(false);
    expect(await lastCommit(path.join(tmp, "nowhere.md"))).toBeNull();
  });

  it("has no state outside a repository", async () => {
    const plain = path.join(tmp, "plain");
    mkdirSync(plain);
    expect(await read(plain, [])).toBeNull();
  });
});
