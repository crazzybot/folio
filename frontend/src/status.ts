/**
 * status.ts — A document's status (meta.status, from its front matter or its
 * "Status:" line) as the list, hover card and document header show it.
 * See docs/design/frontmatter-metadata.md.
 */

import { documentNumber } from "./docNumber";
import type { DocumentMeta, Metadata } from "./types";

/** MADR's statuses in its order, plus "implemented" (shown as accepted). */
export const KNOWN_STATUSES = ["proposed", "accepted", "implemented", "rejected", "deprecated", "superseded"] as const;
export type StatusKind = (typeof KNOWN_STATUSES)[number] | "other";

export function statusKind(status: string): StatusKind {
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as StatusKind) : "other";
}

// Shared with the MCP server, which asks for status changes the same way
export { normaliseStatus, requestDone } from "../../packages/core/src/reviewNotes";

/** Rejected, deprecated and superseded documents no longer apply: their titles are dimmed. */
export function isRetired(status: string): boolean {
  const kind = statusKind(status);
  return kind === "rejected" || kind === "deprecated" || kind === "superseded";
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]*)[^)]*\)/;

/** How the status reads: its detail as plain text ("Superseded by ADR-0005"), else the word ("Accepted"). */
export function statusText(meta: Pick<Metadata, "status" | "statusDetail">): string {
  const text = meta.statusDetail?.replace(new RegExp(MARKDOWN_LINK, "g"), "$1") ?? meta.status ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The document a superseded status points to: the target of a Markdown link
 * in its detail, or without a link, the numbered document in the same folder
 * with the number it names ("superseded by ADR-0005" → 0005-….md).
 */
export function supersedingDocument(doc: DocumentMeta, documents: readonly DocumentMeta[]): DocumentMeta | null {
  const detail = doc.meta?.statusDetail;
  if (detail == null || doc.meta?.status !== "superseded") return null;
  const folder = doc.location.includes("/") ? doc.location.slice(0, doc.location.lastIndexOf("/") + 1) : "";

  // A link decides on its own: it may point outside the workspace
  const link = MARKDOWN_LINK.exec(detail)?.[2];
  if (link !== undefined) {
    if (link === "" || /^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
    const target = resolve(folder, decodePath(link.split("#")[0] ?? ""));
    return documents.find((d) => d.location === target) ?? null;
  }

  // The first number after the status word: "superseded by ADR-0005", "Superseded by 4. Kafka"
  const named = /\d+/.exec(detail.slice(detail.search(/\s/) + 1))?.[0];
  if (named === undefined) return null;
  return (
    documents.find((d) => {
      if (d === doc || !d.location.startsWith(folder) || d.location.slice(folder.length).includes("/")) return false;
      const number = documentNumber(d.filename);
      return number !== null && Number(number) === Number(named);
    }) ?? null
  );
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path; // a stray "%"
  }
}

/** `relative` ("../adr/0005.md", "./x.md") against `folder` ("docs/adr/"), as a workspace location. */
function resolve(folder: string, relative: string): string {
  const parts = relative.startsWith("/") ? [] : folder.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
