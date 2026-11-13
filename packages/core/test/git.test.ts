import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filesOnOtherBranches, repositoryDirs } from "../src/git";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

// A repository on main, with a document only on feature/x and an older branch
describe("filesOnOtherBranches", () => {
  let tmp = "";
  let repo = "";
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, env: GIT_ENV });
  const write = (location: string, text: string) => {
    const file = path.join(repo, ...location.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  beforeAll(() => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "folio-core-git-")));
    repo = path.join(tmp, "repo");
    mkdirSync(repo);
    run("init", "-q", "-b", "main");
    write("docs/a.md", "# A");
    run("add", ".");
    run("commit", "-q", "-m", "a");
    run("checkout", "-q", "-b", "feature/x");
    write("docs/new folder/spec [draft].md", "# Spec");
    run("add", ".");
    run("commit", "-q", "-m", "spec");
    run("checkout", "-q", "main");
  });

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("finds missing files on other local branches", async () => {
    // A folder that's gone too, and a name git would read as a pattern
    const spec = path.join(repo, "docs", "new folder", "spec [draft].md");
    const gone = path.join(repo, "docs", "gone.md");
    expect(await filesOnOtherBranches([spec, gone])).toEqual(new Map([[spec, "feature/x"]]));
  });

  it("leaves out files only on the current branch, and outside repositories", async () => {
    run("checkout", "-q", "feature/x");
    try {
      const spec = path.join(repo, "docs", "new folder", "spec [draft].md");
      const outside = path.join(tmp, "elsewhere", "x.md");
      expect(await filesOnOtherBranches([spec, outside])).toEqual(new Map());
    } finally {
      run("checkout", "-q", "main");
    }
  });

  it("reads a repository's folders", async () => {
    expect(await repositoryDirs(path.join(repo, "docs"))).toEqual({
      root: repo,
      gitDir: path.join(repo, ".git"),
      commonDir: path.join(repo, ".git"),
    });
    expect(await repositoryDirs(tmp)).toBeNull();
  });
});
