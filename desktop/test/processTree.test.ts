import { describe, expect, it } from "vitest";
import { isDescendant, parseProcessTable } from "../src/processTree";

describe("processTree", () => {
  // claude (500) → npm exec (600) → sh (700) → folio-mcp (800); another session's server (900) under 400
  const table = parseProcessTable("  1     0\n 400     1\n 500     1\n 600   500\n 700   600\n 800   700\n 900   400\nnot a row\n");

  it("reads ps output, skipping what isn't a row", () => {
    expect(table.get(800)).toBe(700);
    expect(table.size).toBe(7);
  });

  it("finds a descendant through the processes in between", () => {
    expect(isDescendant(table, 800, 500)).toBe(true);
    expect(isDescendant(table, 500, 500)).toBe(true);
  });

  it("doesn't take another session's process for one of the panel's", () => {
    expect(isDescendant(table, 900, 500)).toBe(false);
    expect(isDescendant(table, 12345, 500)).toBe(false);
  });

  it("stops on a cycle", () => {
    expect(isDescendant(new Map([[10, 11], [11, 10]]), 10, 99)).toBe(false);
  });
});
