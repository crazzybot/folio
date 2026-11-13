import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { MarksStore, realPath } from "../../core/src/marks";
import { Folio } from "../src/folio";
import { createServer } from "../src/server";

/** A session with the server as an agent opens it, sending raw JSON-RPC. */
async function session(folio: Folio, clientName: string) {
  const [agent, end] = InMemoryTransport.createLinkedPair();
  const answers = new Map<number, (message: JSONRPCMessage) => void>();
  agent.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number") answers.get(message.id)?.(message);
  };
  await createServer(folio).connect(end);
  await agent.start();
  let id = 0;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const n = ++id;
      answers.set(n, (message) => resolve(message as unknown as Record<string, unknown>));
      void agent.send({ jsonrpc: "2.0", id: n, method, params } as JSONRPCMessage);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: clientName, version: "1" } });
  await agent.send({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage);
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const { result } = (await request("tools/call", { name, arguments: args })) as { result: { content: { text: string }[]; isError?: boolean } };
    return { text: result.content[0]?.text ?? "", isError: result.isError === true };
  };
  return { request, callTool };
}

describe("the MCP server", () => {
  it("serves the three tools and signs replies with the client's name", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "folio-mcp-root-"));
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "folio-mcp-data-"));
    const doc = path.join(root, "plan.md");
    writeFileSync(doc, "# Plan\n\nWe ship on Friday.\n");
    const store = new MarksStore(dataDir);
    const h = await store.addHighlight(doc, {
      color: "yellow",
      note: "Which Friday?",
      quote: { exact: "ship on Friday", prefix: "", suffix: "" },
      position: { start: 3, end: 17 },
    });
    const { request, callTool } = await session(new Folio({ root, dataDir, settings: () => ({}), watch: false }), "claude-code");

    const tools = (await request("tools/list", {})) as { result: { tools: { name: string }[] } };
    expect(tools.result.tools.map((t) => t.name)).toEqual(["folio_list_documents", "folio_get_review_notes", "folio_reply"]);

    const notes = await callTool("folio_get_review_notes", {});
    expect(notes.text).toContain(`note ${h.id.slice(0, 8)}`);
    expect(notes.text).toContain("Answer each note with folio_reply");

    const reply = await callTool("folio_reply", { noteId: h.id.slice(0, 8), text: "The 14th.", addressed: true });
    expect(reply.isError).toBe(false);
    const [[, record] = []] = await store.records();
    expect(record?.highlights[0]?.replies?.[0]?.author).toEqual({ kind: "agent", name: "Claude Code" });
    expect(record?.rounds?.[0]?.client).toBe("Claude Code");

    // Folio's refusals reach the agent as tool errors
    const refused = await callTool("folio_reply", { noteId: "deadbeef", text: "Hi" });
    expect([refused.isError, refused.text]).toEqual([true, `No note deadbeef under ${realPath(root)}`]);
  });
});
