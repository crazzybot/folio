/**
 * frontMatter.ts — The front matter properties in the document header
 * (docs/design/frontmatter-properties.md): what the toggle says, and which
 * values are links.
 */

import type { FrontMatter } from "../../packages/core/src/frontMatter";

export { frontMatterProperties } from "../../packages/core/src/frontMatter";
export type { FrontMatter, FrontMatterProperty } from "../../packages/core/src/frontMatter";

// The keys the properties strip shows (extractMeta): the toggle counts the others
const SHOWN_KEYS = new Set(["status", "date", "decision-makers", "deciders", "tags", "tag"]);

/**
 * The closed toggle's text, saying what it hides: "4 more properties" beside
 * the strip's own, "3 properties" when the strip shows none, "Properties"
 * when it shows them all (or the front matter isn't YAML).
 */
export function propertiesLabel(frontMatter: FrontMatter, stripShowsMeta: boolean): string {
  const { properties } = frontMatter;
  const count = stripShowsMeta ? properties.filter(({ key }) => !SHOWN_KEYS.has(key.toLowerCase())).length : properties.length;
  if (count === 0) return "Properties";
  const noun = count === 1 ? "property" : "properties";
  return stripShowsMeta ? `${count} more ${noun}` : `${count} ${noun}`;
}

/** A value that is one web address, and nothing else, is a link. */
export function isWebUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
