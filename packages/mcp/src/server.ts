/**
 * server.ts — The MCP server: three tools over Folio (folio.ts) for a coding
 * agent. The descriptions are the agent's instructions, so they say what to
 * do with the notes as well as what each tool returns.
 */

import { CLIENT_INFO_META_KEY, McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentName, Folio, FolioError } from "./folio";

declare const FOLIO_MCP_VERSION: string;
const VERSION = typeof FOLIO_MCP_VERSION === "string" ? FOLIO_MCP_VERSION : "0.0.0-dev";

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });
const refusal = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }], isError: true });

/** A tool's work, with Folio's refusals told to the agent rather than failing the call. */
async function answer(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof FolioError) return refusal(err.message);
    throw err;
  }
}

export function createServer(folio: Folio): McpServer {
  const server = new McpServer(
    { name: "folio", title: "Folio", version: VERSION },
    {
      instructions:
        "Folio is where the user reads and reviews this project's Markdown documents. " +
        "Use these tools when the user asks you to address, apply or work through their review notes or comments from Folio.",
    },
  );

  /** Who's calling, for the replies' author and the round: from the request, or the session's opening. */
  const client = (ctx: ServerContext): string => {
    const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
    const info = envelope?.[CLIENT_INFO_META_KEY] as { name?: unknown } | undefined;
    const name = typeof info?.name === "string" ? info.name : server.server.getClientVersion()?.name;
    return agentName(name);
  };

  server.registerTool(
    "folio_list_documents",
    {
      title: "List documents",
      description:
        `List the Markdown documents under ${folio.root} that Folio shows: absolute path, title, status, tags, ` +
        "and how many review notes are waiting on you (openNotes). Filter by folder, status (as written in the document, e.g. proposed), tag, " +
        "or withOpenNotes to find the documents the user has left notes on.",
      inputSchema: z.object({
        folder: z.string().optional().describe("Only documents in this folder: absolute, or relative to the project"),
        status: z.string().optional().describe("Only documents with this status, e.g. proposed"),
        tag: z.string().optional().describe("Only documents with this tag"),
        withOpenNotes: z.boolean().optional().describe("Only documents with review notes waiting on you"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      answer(async () => {
        const documents = await folio.listDocuments(input);
        if (documents.length === 0) return text("No documents match.");
        return text(JSON.stringify(documents, null, 2));
      }),
  );

  server.registerTool(
    "folio_get_review_notes",
    {
      title: "Get review notes",
      description:
        "Get the review notes the user left in Folio on documents in this project: each quoted passage with its file, lines and section, " +
        "the user's comment, the replies so far, and notes on documents as a whole (including status changes to make). " +
        "Without paths, every document with notes not yet sent to you. " +
        "Then edit the documents yourself to address the notes, keeping each document's structure and language; Folio never edits files. " +
        "Answer every note you acted on or have a question about with folio_reply. " +
        "Fetching marks the notes as sent, so a second call returns only new ones unless includeSent is set.",
      inputSchema: z.object({
        paths: z.array(z.string()).optional().describe("Documents to get notes for: absolute, or relative to the project"),
        includeSent: z.boolean().optional().describe("Also notes sent before and not answered yet"),
        includeAddressed: z.boolean().optional().describe("Also notes already marked addressed"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input, ctx) =>
      answer(async () => {
        const notes = await folio.reviewNotes(input, client(ctx));
        if (notes === null) {
          return text(
            "No review notes to send. Notes already sent are left out unless includeSent is set, addressed ones unless includeAddressed is set; " +
              "notes the user marked private are never sent.",
          );
        }
        return text(
          `${notes.text}\n\n---\n` +
            "Answer each note with folio_reply: noteId as given after \"note\" on its location line; " +
            "for a document's overall note or status change, its path instead. " +
            "Set addressed when you changed the document to address it; leave it out to ask a question or explain why not.",
        );
      }),
  );

  server.registerTool(
    "folio_reply",
    {
      title: "Reply to a note",
      description:
        "Answer one of the user's review notes in Folio, where they read it next to the passage. " +
        "Say what you changed and set addressed: true, or explain why you didn't change it, or ask a question (addressed left out: the note stays open). " +
        "The user resolves or reopens addressed notes; you can't resolve, edit or delete them. Keep replies short: a sentence or two.",
      inputSchema: z.object({
        noteId: z.string().optional().describe("The note's id from folio_get_review_notes (8 hex digits)"),
        path: z.string().optional().describe("Instead of noteId: the document whose overall note (or status change) you're answering"),
        text: z.string().min(1).max(10_000).describe("Your reply, in Markdown"),
        addressed: z.boolean().optional().describe("true when you changed the document to address the note"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input, ctx) => answer(async () => text(await folio.reply(input, client(ctx)))),
  );

  return server;
}
