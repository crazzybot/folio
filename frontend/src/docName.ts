/**
 * docName.ts — Well-known documents ("README.md", "AGENTS.md", "CHANGELOG.md"):
 * the sidebar shows the name before the title, since that's what such
 * documents are known by, and several of them often share one title (an
 * AGENTS.md and a CLAUDE.md both titled after the project).
 */

// Names with a meaning of their own, in any case ("readme.md", "Changelog.md")
const WELL_KNOWN = new Set([
  "readme",
  "changelog",
  "contributing",
  "license",
  "security",
  "code_of_conduct",
  "agents",
  "claude",
  "gemini",
  "skill",
  "copilot-instructions",
]);
// Any other name in capitals ("SPEC.md", "PLAN.md") is meant to stand out too
const CAPITALS = /^[A-Z][A-Z0-9_-]*[A-Z0-9]$/;

/** A well-known file name without its extension, as written ("AGENTS"), or null. */
export function documentName(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return WELL_KNOWN.has(stem.toLowerCase()) || CAPITALS.test(stem) ? stem : null;
}

/** Whether `title` only repeats `name` ("Changelog" for "CHANGELOG", "Code of Conduct" for "CODE_OF_CONDUCT"). */
export function titleIsName(title: string, name: string): boolean {
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return plain(title) === plain(name);
}
