/**
 * obsidian.ts — remark plugin for Obsidian's wiki links and embeds, so an
 * Obsidian vault reads in Folio as it does in Obsidian:
 *
 *   [[Note]]  [[Note|alias]]  [[Note#Heading]]  [[#Heading]]  [[folder/Note]]
 *   ![[image.png]]  ![[image.png|300]]  ![[image.png|300x200]]  ![[Note]]
 *
 * Targets resolve like Obsidian's: by file name anywhere in the workspace,
 * case-insensitively; a path narrows it down. Several matches prefer the
 * current document's folder, then the shortest path. Links become ordinary
 * root-relative links ("/folder/Note.md#heading"), so they open through the
 * viewer's usual link handling (Back works; unresolved ones show as missing).
 * Embedded notes become links — their content isn't inlined.
 *
 * Text inside code and existing links is left alone.
 */

import { slugify } from "./slug";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string | number> };
}

export interface ObsidianOptions {
  /** Workspace-relative locations of the documents. */
  documents: readonly string[];
  /** Workspace-relative locations of the images (attachments). */
  attachments: readonly string[];
  /** The document being rendered, for preferring nearby matches. */
  currentLocation: string | null;
}

const WIKI_LINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MARKDOWN_EXT = /\.(md|markdown)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
// ![[image.png|300]] / ![[image.png|300x200]]: a size, not an alias
const SIZE = /^(\d+)(?:x(\d+))?$/;
// Not looked into: their text isn't prose
const SKIP_PARENTS = new Set(["link", "linkReference", "code", "inlineCode", "html"]);

function folderOf(location: string): string {
  return location.includes("/") ? location.slice(0, location.lastIndexOf("/")) : "";
}

/** The best of several matching files: same folder first, then shortest path, then by name. */
function pick(matches: string[], currentLocation: string | null): string | null {
  const here = currentLocation === null ? null : folderOf(currentLocation);
  const depth = (loc: string) => loc.split("/").length;
  const sorted = [...matches].sort(
    (a, b) =>
      Number(folderOf(b) === here) - Number(folderOf(a) === here) || depth(a) - depth(b) || a.localeCompare(b),
  );
  return sorted[0] ?? null;
}

/** The file `name` refers to among `locations` ("Note", "folder/Note", "pic.png"), or null. */
function resolve(
  name: string,
  locations: readonly string[],
  currentLocation: string | null,
  stripMarkdownExt: boolean,
): string | null {
  const strip = (s: string) => (stripMarkdownExt ? s.replace(MARKDOWN_EXT, "") : s);
  const target = strip(name.trim().replace(/^\/+/, "")).toLowerCase();
  if (target === "") return null;
  const matches = locations.filter((loc) => {
    const candidate = strip(loc).toLowerCase();
    return candidate === target || candidate.endsWith("/" + target);
  });
  return pick(matches, currentLocation);
}

/** A root-relative URL for a workspace location, as links.ts / the image loader expect. */
function workspaceUrl(location: string): string {
  return "/" + location.split("/").map(encodeURIComponent).join("/");
}

/** The node(s) one [[…]] or ![[…]] becomes. */
function wikiNode(embed: boolean, inner: string, options: ObsidianOptions): MdNode {
  const bar = inner.indexOf("|");
  const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : null;
  const hash = target.indexOf("#");
  const name = (hash >= 0 ? target.slice(0, hash) : target).trim();
  const rawHeading = hash >= 0 ? target.slice(hash + 1).trim() : "";
  // Block references (#^id) have no anchor here: open the note itself
  const heading = rawHeading.startsWith("^") ? "" : rawHeading;

  if (embed && IMAGE_EXT.test(name)) {
    const location = resolve(name, options.attachments, options.currentLocation, false);
    const size = alias === null ? null : SIZE.exec(alias);
    const hProperties: Record<string, number> = {};
    if (size?.[1] !== undefined) hProperties["width"] = Number(size[1]);
    if (size?.[2] !== undefined) hProperties["height"] = Number(size[2]);
    return {
      type: "image",
      // Unresolved: left relative, so the viewer shows its "not found" placeholder
      url: location === null ? encodeURI(name) : workspaceUrl(location),
      alt: alias !== null && size === null ? alias : name,
      title: null,
      data: { hProperties },
    };
  }

  const text = alias ?? (name && heading ? `${name} > ${heading}` : name || heading);
  const anchor = heading ? `#${slugify(heading)}` : "";
  let url: string;
  if (name === "") {
    url = anchor; // [[#Heading]]: this document
  } else {
    const location = resolve(name, options.documents, options.currentLocation, true);
    // Unresolved: a root-relative path that links.ts reports as missing
    url = (location === null ? workspaceUrl(name) : workspaceUrl(location)) + anchor;
  }
  return { type: "link", url, title: null, children: [{ type: "text", value: text }] };
}

/** `node`'s text split into text and wiki-link nodes, or null if it has none. */
function splitText(value: string, options: ObsidianOptions): MdNode[] | null {
  const parts: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(WIKI_LINK)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ type: "text", value: value.slice(last, at) });
    parts.push(wikiNode(match[1] === "!", match[2] ?? "", options));
    last = at + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

function transform(parent: MdNode, options: ObsidianOptions): void {
  const children = parent.children;
  if (children === undefined || SKIP_PARENTS.has(parent.type)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    if (child.type === "text" && child.value?.includes("[[")) {
      const parts = splitText(child.value, options);
      if (parts !== null) {
        children.splice(i, 1, ...parts);
        i += parts.length - 1;
      }
    } else {
      transform(child, options);
    }
  }
}

export default function remarkObsidian(options: ObsidianOptions) {
  return (tree: MdNode) => {
    transform(tree, options);
  };
}
