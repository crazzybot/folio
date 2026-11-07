/**
 * documentTree.ts — The document list grouped by folder, for the sidebar.
 *
 * Only folders that hold documents appear, and the tree is kept shallow:
 *   - a folder whose only content is one subfolder merges with it
 *     ("api / v2 / endpoints"), as VS Code's compact folders do;
 *   - a folder holding just one document is replaced by that document, with
 *     the folder named beside it ("README  core / src");
 *   - when everything sits inside one folder, its contents are the top level.
 * Folders come first, then documents; each in natural, case-insensitive order
 * ("v2" before "v10", "CHANGELOG" before "notes/…" before "README").
 */

import type { DocumentMeta } from "./types";

export interface FolderNode {
  kind: "folder";
  /** Path of the (last) folder it shows, e.g. "docs/api/v2" — stable across renders. */
  key: string;
  /** What the row shows: "api / v2" for merged folders. */
  label: string;
  children: TreeNode[];
}

export interface DocumentNode {
  kind: "document";
  doc: DocumentMeta;
  /** Folder(s) folded into this row, shown beside it ("core / src"). */
  hint: string | null;
}

export type TreeNode = FolderNode | DocumentNode;

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  docs: DocumentMeta[];
}

const SEPARATOR = " / ";

function collect(documents: readonly DocumentMeta[]): Folder {
  const root: Folder = { name: "", path: "", folders: new Map(), docs: [] };
  for (const doc of documents) {
    const parts = doc.location.split("/").slice(0, -1);
    let folder = root;
    for (const part of parts) {
      let child = folder.folders.get(part);
      if (child === undefined) {
        const path = folder.path === "" ? part : `${folder.path}/${part}`;
        child = { name: part, path, folders: new Map(), docs: [] };
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.docs.push(doc);
  }
  return root;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Tree nodes for `folder`'s contents. */
function nodesOf(folder: Folder): TreeNode[] {
  const folders: FolderNode[] = [];
  const docs: DocumentNode[] = folder.docs.map((doc) => ({ kind: "document", doc, hint: null }));

  for (const start of folder.folders.values()) {
    // Merge chains of folders that hold nothing but one subfolder
    let current = start;
    let label = start.name;
    while (current.docs.length === 0 && current.folders.size === 1) {
      const [only] = current.folders.values();
      if (only === undefined) break;
      current = only;
      label += SEPARATOR + only.name;
    }
    if (current.folders.size === 0 && current.docs.length === 1 && current.docs[0] !== undefined) {
      // Just one document: show it instead of the folder
      docs.push({ kind: "document", doc: current.docs[0], hint: label });
    } else {
      folders.push({ kind: "folder", key: current.path, label, children: nodesOf(current) });
    }
  }

  folders.sort((a, b) => byName.compare(a.label, b.label));
  docs.sort((a, b) => byName.compare(a.doc.location, b.doc.location));
  return [...folders, ...docs];
}

/** The sidebar's tree for `documents`. */
export function buildDocumentTree(documents: readonly DocumentMeta[]): TreeNode[] {
  const nodes = nodesOf(collect(documents));
  // Everything inside one folder: show its contents at the top level
  const [only] = nodes;
  return nodes.length === 1 && only?.kind === "folder" ? only.children : nodes;
}

/** Keys of the folders containing `location` in `tree` (to expand them). */
export function foldersContaining(tree: readonly TreeNode[], location: string): string[] {
  for (const node of tree) {
    if (node.kind === "document") {
      if (node.doc.location === location) return [];
      continue;
    }
    const inside = foldersContaining(node.children, location);
    const found = inside.length > 0 || node.children.some((c) => c.kind === "document" && c.doc.location === location);
    if (found) return [node.key, ...inside];
  }
  return [];
}

/** Documents inside `folder` ("docs/api"), at any depth; all of them when null (Focus on Folder). */
export function documentsInFolder(documents: DocumentMeta[], folder: string | null): DocumentMeta[] {
  if (folder === null) return documents;
  const prefix = folder + "/";
  return documents.filter((doc) => doc.location.startsWith(prefix));
}
