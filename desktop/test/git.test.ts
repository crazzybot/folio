import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitTracker, parseWorktrees } from "../src/git";
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
        mainCheckout: null,
        worktrees: [
          { path: repo, branch: "main", current: true },
          { path: worktree, branch: "feature/x", current: false },
        ],
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

  it("has no state outside a repository", async () => {
    const plain = path.join(tmp, "plain");
    mkdirSync(plain);
    expect(await read(plain, [])).toBeNull();
  });
});
