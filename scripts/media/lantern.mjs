// Makes a fresh, nearly empty workspace for recording a game built
// spec-first with Claude Code in Folio's agent panel: a git repository with
// empty docs/specs and docs/adr folders, an ADR template, and a CLAUDE.md
// that sets the way of working (decisions in the docs, the game in game/).
//
//   node lantern.mjs [folder]          (default ~/lantern-drift)
//
// The agent writes the spec, the ADR and the game during the take. Run it
// again between takes. It first deletes Folio's records for the folder (see
// records.mjs). Quit Folio before running it.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { forget, realFolder } from "./records.mjs";

const target = resolve(process.argv[2] ?? join(homedir(), "lantern-drift"));

const files = {
  "README.md": "# Lantern Drift\n\nA small browser game.\n",
  "CLAUDE.md": `# Lantern Drift

A small browser game, built spec-first. Specs go in \`docs/specs/\`,
decisions in \`docs/adr/\` (copy \`0000-template.md\`), each with a
\`Status:\` line. The game goes in \`game/\`: one static page
(\`game/index.html\` and its scripts), no build step, no dependencies.
Every decision about the game is made in the specs and ADRs: questions
that come up while implementing go on the spec's passage in Folio.
`,
  "docs/specs/.gitkeep": "",
  "docs/adr/0000-template.md": `# ADR NNNN: Title

Status: proposed

## Context

What the decision is about, and what constrains it.

## Decision

What we do.

## Consequences

What gets easier, what gets harder, what we give up.
`,
  // No approval prompts in the panel during the take: edits, opening the
  // game and git are allowed up front
  ".claude/settings.json":
    JSON.stringify(
      {
        permissions: {
          allow: ["Edit", "Write", "Bash(open game/index.html)", "Bash(git *)"],
        },
      },
      null,
      2,
    ) + "\n",
};

const git = (...args) => execFileSync("git", ["-C", target, ...args], { stdio: "inherit" });

const removed = forget(realFolder(target));
rmSync(target, { recursive: true, force: true });
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(target, path)), { recursive: true });
  writeFileSync(join(target, path), text);
}
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "Lantern Drift: empty project");
console.log(`${target}: ready (${removed} old Folio records removed)`);
