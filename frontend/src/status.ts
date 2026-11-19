/**
 * status.ts — A document's status (meta.status, from its front matter or its
 * "Status:" line) as the list, hover card and document header show it.
 * See docs/design/frontmatter-metadata.md.
 */

import { documentNumber } from "./docNumber";
import type { DocumentMeta, DocumentNote, Metadata } from "./types";

/**
 * The statuses Folio knows, in lifecycle order: a decision (draft → proposed
 * → accepted), then its delivery (in-progress → implemented), then the ways
 * out. Each is a kind with its own glyph; the words in STATUS_ALIASES are
 * shown as written but take their kind's glyph.
 */
export const KNOWN_STATUSES = [
  "draft",
  "proposed",
  "accepted",
  "in-progress",
  "implemented",
  "deferred",
  "rejected",
  "deprecated",
  "superseded",
] as const;
export type StatusKind = (typeof KNOWN_STATUSES)[number] | "other";

/** Other words for the known statuses, from MADR, PEPs, KEPs and common use. */
const STATUS_ALIASES = new Map<string, StatusKind>([
  ["wip", "draft"],
  ["review", "proposed"],
  ["open", "proposed"],
  ["pending", "proposed"],
  ["approved", "accepted"],
  ["agreed", "accepted"],
  ["implementing", "in-progress"],
  ["partial", "in-progress"],
  ["done", "implemented"],
  ["complete", "implemented"],
  ["completed", "implemented"],
  ["final", "implemented"],
  ["shipped", "implemented"],
  ["on-hold", "deferred"],
  ["postponed", "deferred"],
  ["paused", "deferred"],
  ["declined", "rejected"],
  ["withdrawn", "rejected"],
  ["obsolete", "deprecated"],
  ["replaced", "superseded"],
]);

export function statusKind(status: string): StatusKind {
  if ((KNOWN_STATUSES as readonly string[]).includes(status)) return status as StatusKind;
  return STATUS_ALIASES.get(status) ?? "other";
}

/**
 * The statuses the note editor offers: the known ones in lifecycle order,
 * then the others used in the workspace, sorted. The document's own status
 * is always among them, where it falls: picking it asks for no change.
 */
export function statusChoices(workspaceStatuses: readonly string[], currentStatus: string | null): string[] {
  const known: readonly string[] = KNOWN_STATUSES;
  const others = new Set(workspaceStatuses.filter((s) => !known.includes(s)));
  if (currentStatus !== null && !known.includes(currentStatus)) others.add(currentStatus);
  return [...known, ...[...others].sort()];
}

// Shared with the MCP server, which asks for status changes the same way
export { normaliseStatus, requestDone } from "../../packages/core/src/reviewNotes";
import { requestDone } from "../../packages/core/src/reviewNotes";

/**
 * The document has the status its note asked for, and the user hasn't
 * opened the note since it got it: the status is new to them.
 */
export function statusNew(status: string | null | undefined, note: DocumentNote | undefined): boolean {
  if (note === undefined || !requestDone(status, note.requestedStatus)) return false;
  return note.statusSeen !== status;
}

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
