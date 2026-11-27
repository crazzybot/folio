/**
 * frontMatter.ts — Front matter's top-level keys and their values, as the
 * scanner reads the metadata fields (docs/design/frontmatter-metadata.md)
 * and the document header shows every property
 * (docs/design/frontmatter-properties.md). Not a YAML parser: the few forms
 * keys are written in, and the rest kept as written. No Node imports: the
 * frontend compiles this for the browser too.
 */

import { FRONT_MATTER } from "./headings";

// A top-level key and its value: "status: accepted", "tags:" (a block list follows)
export const FRONT_MATTER_KEY = /^([A-Za-z][\w-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const QUOTED = /^(["'])(.*)\1$/;
const BLOCK_LIST_ITEM = /^[ \t]+-[ \t]+(.*?)[ \t]*$/;

/** Top-level keys of front matter: a scalar's text, or a block list's items. First of each key wins. */
export function frontMatterFields(block: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  const lines = block.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = FRONT_MATTER_KEY.exec(lines[i] ?? "");
    if (match?.[1] === undefined) continue;
    let value: string | string[] = match[2] ?? "";
    if (value === "") {
      const items: string[] = [];
      for (let item = BLOCK_LIST_ITEM.exec(lines[i + 1] ?? ""); item?.[1] !== undefined; item = BLOCK_LIST_ITEM.exec(lines[i + 1] ?? "")) {
        items.push(item[1]);
        i++;
      }
      if (items.length > 0) value = items;
    }
    if (!fields.has(match[1])) fields.set(match[1], value);
  }
  return fields;
}

/** A scalar's text: unquoted, without a trailing comment; null for anything but plain text. */
export function scalar(raw: string): string | null {
  const value = raw.trim();
  const quoted = QUOTED.exec(value) ?? QUOTED.exec(value.replace(/[ \t]+#.*$/, ""));
  if (quoted?.[2] !== undefined) return quoted[2].trim() || null;
  const plain = value.replace(/[ \t]+#.*$/, "").trim();
  // Flow collections and block scalars aren't plain text
  if (plain === "" || /^[[{|>]/.test(plain)) return null;
  return plain;
}

/** A list's items: a block list, a flow list ("[a, b]") or comma-separated text. */
export function list(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => scalar(item) ?? []);
  let value = raw.trim();
  if (!/["']/.test(value)) value = value.replace(/[ \t]+#.*$/, "");
  const flow = /^\[(.*)\](?:[ \t]+#.*)?$/.exec(value);
  if (flow?.[1] !== undefined) value = flow[1];
  else if (/^[{|>]/.test(value)) return [];
  return value.split(",").flatMap((item) => scalar(item) ?? []);
}

// ---------------------------------------------------------------------------
// Every property, for the document header
// ---------------------------------------------------------------------------

/** One top-level key of front matter. */
export interface FrontMatterProperty {
  key: string;
  /** A scalar's text or a list's items; null for any other form, shown as `raw`. */
  value: string | string[] | null;
  /** The value as written: the rest of the key's line, then its indented lines, dedented. "" when empty. */
  raw: string;
}

export interface FrontMatter {
  /** "toml" front matter (+++) is shown as written only: it has no properties. */
  format: "yaml" | "toml";
  /** The text between the fences, as written. */
  block: string;
  properties: FrontMatterProperty[];
}

const TOML_FRONT_MATTER = /^﻿?\+\+\+[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?\+\+\+[ \t]*(?:\r?\n|$)/;
// Any top-level key, quoted or not ("_draft:", "'key two':"); not a list item or a comment
const PROPERTY_KEY = /^(?![-?#][ \t]|[-?]$)("[^"]*"|'[^']*'|[^\s#:][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
// Part of the key above: indented, or a block list item written at the margin
const CONTINUATION = /^(?:[ \t]|-(?:[ \t]|$))/;
const LIST_ITEM = /^([ \t]*)-[ \t]+(.*?)[ \t]*$/;
// "- name: x" is a map in a list, not a scalar
const MAP_ENTRY = /^(?:"[^"]*"|'[^']*'|[^\s"'#][^:]*?):(?:[ \t]|$)/;

/** Lines without their shared indentation. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim() !== "").map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(common));
}

/** A block list's items when every line is one plain item at the same indent; else null. */
function blockList(lines: string[]): string[] | null {
  const items: string[] = [];
  let indent: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const item = LIST_ITEM.exec(line);
    if (item?.[1] === undefined || item[2] === undefined) return null;
    if (indent !== null && item[1] !== indent) return null;
    indent = item[1];
    if (MAP_ENTRY.test(item[2]) || /^[[{|>&*!]/.test(item[2])) return null;
    const text = scalar(item[2]);
    if (text === null) return null;
    items.push(text);
  }
  return items.length > 0 ? items : null;
}

/** A value written on the key's line, when it's text or a flat flow list. */
function inlineValue(text: string): string | string[] | null {
  if (text.startsWith("[")) {
    const flow = /^\[([^[\]{}]*)\](?:[ \t]+#.*)?$/.exec(text);
    return flow === null ? null : list(text);
  }
  if (/^[{|>&*!]/.test(text)) return null;
  return scalar(text);
}

function property(key: string, rest: string, lines: string[]): FrontMatterProperty {
  // Blank lines after the last indented one belong to no key
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  const unquotedKey = QUOTED.exec(key)?.[2] ?? key;
  const raw = [rest, ...dedent(lines)].filter((line, index) => index > 0 || line !== "").join("\n");
  // "key: # comment" has no value on its line
  const inline = rest.startsWith("#") ? "" : rest;
  let value: string | string[] | null = null;
  if (lines.length === 0) value = inline === "" ? null : inlineValue(inline);
  else if (inline === "") value = blockList(lines);
  return { key: unquotedKey, value, raw };
}

/**
 * The document's front matter, its block as written and its top-level keys
 * in order (repeated keys kept: the metadata rules read the first, the
 * header hides nothing); null when the document has none or it's empty.
 */
export function frontMatterProperties(text: string): FrontMatter | null {
  const toml = TOML_FRONT_MATTER.exec(text);
  if (toml !== null) {
    const block = toml[1] ?? "";
    return block.trim() === "" ? null : { format: "toml", block, properties: [] };
  }
  const match = FRONT_MATTER.exec(text);
  const block = match?.[1] ?? "";
  if (block.trim() === "") return null;

  const properties: FrontMatterProperty[] = [];
  let current: { key: string; rest: string; lines: string[] } | null = null;
  const finish = () => {
    if (current !== null) properties.push(property(current.key, current.rest, current.lines));
    current = null;
  };
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (current !== null && (line.trim() === "" || CONTINUATION.test(line))) {
      current.lines.push(line);
      continue;
    }
    const key = PROPERTY_KEY.exec(line);
    finish();
    // Anything else at the margin (a comment, a document marker) ends the key before it
    if (key?.[1] !== undefined) current = { key: key[1], rest: key[2] ?? "", lines: [] };
  }
  finish();
  return { format: "yaml", block, properties };
}
