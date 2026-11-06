import { describe, expect, it } from "vitest";
import { serveImage } from "../src/images";
import { SKIP, WORKSPACE } from "./fixtures";

describe("serveImage", () => {
  it("serves images in the workspace with a sandboxing policy", async () => {
    const res = await serveImage(WORKSPACE, "attachments/pixel.png", SKIP.skipDirs);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect((await serveImage(WORKSPACE, "docs/diagram.svg", SKIP.skipDirs)).headers.get("content-type")).toBe("image/svg+xml");
  });

  it.each([
    "../expected-scan.json",
    "docs/../../expected-scan.json",
    "node_modules/pkg/skipped.png",
    "docs/plain.md",
    "missing.png",
    "",
  ])("refuses %j", async (location) => {
    expect((await serveImage(WORKSPACE, location, SKIP.skipDirs)).status).toBe(404);
  });

  it("refuses everything without a workspace", async () => {
    expect((await serveImage(null, "attachments/pixel.png", SKIP.skipDirs)).status).toBe(404);
  });
});
