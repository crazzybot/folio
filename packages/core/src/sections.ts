/**
 * sections.ts — Which sections of a document changed between two versions:
 * what the banner above a changed document lists (docs/design/reads.md).
 *
 * A section is a heading and the lines up to the next heading of any level,
 * so a change in a subsection is that subsection's, not its parent's. Text
 * before the first heading and the front matter count on their own.
 * Whitespace differences don't count. No Node imports: the frontend
 * compiles this for the browser too.
 */

import { FRONT_MATTER, headingLines } from "./headings";
import type { Heading } from "./headings";

interface Section {
  /** Null for the text before the first heading. */
  heading: Heading | null;
  /** The section's text, whitespace collapsed. */
  text: string;
}

export interface SectionChanges {
  /** Sections in both versions whose text differs, in the new version's order. */
  changed: Heading[];
  /** Sections only in the new version. */
  added: Heading[];
  /** Sections only in the old version. */
  removed: Heading[];
  /** The text before the first heading changed. */
  intro: boolean;
  /** The front matter (title, status, tags…) changed. */
  frontMatter: boolean;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function split(markdown: string): { frontMatter: string; sections: Section[] } {
  const match = FRONT_MATTER.exec(markdown);
  const frontMatter = collapse(match?.[1] ?? "");
  const lines = (match === null ? markdown : markdown.slice(match[0].length)).split(/\r\n|\r|\n/);
  const headings = headingLines(lines);
  const sections: Section[] = [{ heading: null, text: collapse(lines.slice(0, headings[0]?.line ?? lines.length).join("\n")) }];
  headings.forEach(({ level, text, line }, i) => {
    sections.push({ heading: { level, text }, text: collapse(lines.slice(line + 1, headings[i + 1]?.line ?? lines.length).join("\n")) });
  });
  return { frontMatter, sections };
}

/** Sections told apart by heading: its level and text, and which occurrence of those it is. */
function keyed(sections: readonly Section[]): Map<string, Section> {
  const seen = new Map<string, number>();
  const byKey = new Map<string, Section>();
  for (const section of sections) {
    if (section.heading === null) continue;
    const name = `${section.heading.level} ${section.heading.text}`;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    byKey.set(`${name}#${n}`, section);
  }
  return byKey;
}

/** What changed from `before` to `after`, section by section. */
export function sectionChanges(before: string, after: string): SectionChanges {
  const old = split(before);
  const now = split(after);
  const oldSections = keyed(old.sections);
  const newSections = keyed(now.sections);
  const changes: SectionChanges = {
    changed: [],
    added: [],
    removed: [],
    intro: old.sections[0]?.text !== now.sections[0]?.text,
    frontMatter: old.frontMatter !== now.frontMatter,
  };
  for (const [key, section] of newSections) {
    if (section.heading === null) continue;
    const was = oldSections.get(key);
    if (was === undefined) changes.added.push(section.heading);
    else if (was.text !== section.text) changes.changed.push(section.heading);
  }
  for (const [key, section] of oldSections) {
    if (section.heading !== null && !newSections.has(key)) changes.removed.push(section.heading);
  }
  return changes;
}

/** How many places changed: sections, the intro and the front matter. */
export function changeCount(changes: SectionChanges): number {
  return changes.changed.length + changes.added.length + changes.removed.length + (changes.intro ? 1 : 0) + (changes.frontMatter ? 1 : 0);
}
