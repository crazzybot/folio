import { describe, expect, it } from "vitest";
import { resolveImageSrc, resolveLink } from "./links";

const ids = new Map([
  ["README.md", "readme"],
  ["docs/guide.md", "guide"],
  ["docs/setup.markdown", "setup"],
]);

describe("resolveLink", () => {
  it.each([
    ["https://example.com/x", null, { kind: "external", href: "https://example.com/x" }],
    ["mailto:me@example.com", null, { kind: "external", href: "mailto:me@example.com" }],
    ["#intro", "README.md", { kind: "anchor", anchor: "intro" }],
    ["docs/guide.md", "README.md", { kind: "document", id: "guide", anchor: null }],
    ["guide.md#setup-steps", "docs/setup.markdown", { kind: "document", id: "guide", anchor: "setup-steps" }],
    ["../README.md", "docs/guide.md", { kind: "document", id: "readme", anchor: null }],
    ["/docs/setup", "README.md", { kind: "document", id: "setup", anchor: null }],
    ["setup", "docs/guide.md", { kind: "document", id: "setup", anchor: null }],
    ["guide.md#part", "docs/guide.md", { kind: "anchor", anchor: "part" }],
    ["docs/my%20file.md", "README.md", { kind: "missing", location: "docs/my file.md" }],
    ["../../escape.md", "docs/guide.md", { kind: "missing", location: "../../escape.md" }],
  ])("%s from %s", (href, from, target) => {
    expect(resolveLink(href, from, ids)).toEqual(target);
  });

  it("ignores empty hrefs", () => {
    expect(resolveLink("  ", "README.md", ids)).toBeNull();
  });
});

describe("resolveImageSrc", () => {
  it.each([
    ["img/a.png", "docs/guide.md", { kind: "workspace", location: "docs/img/a.png" }],
    ["../a.png", "docs/guide.md", { kind: "workspace", location: "a.png" }],
    ["/assets/a.png", "docs/guide.md", { kind: "workspace", location: "assets/a.png" }],
    ["https://example.com/a.png", null, { kind: "url", src: "https://example.com/a.png" }],
    ["../../a.png", "docs/guide.md", null],
  ])("%s from %s", (src, from, source) => {
    expect(resolveImageSrc(src, from)).toEqual(source);
  });
});
