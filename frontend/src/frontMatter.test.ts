import { describe, expect, it } from "vitest";
import { frontMatterProperties, isWebUrl, propertiesLabel } from "./frontMatter";
import type { FrontMatter } from "./frontMatter";

const read = (block: string): FrontMatter => {
  const frontMatter = frontMatterProperties(`---\n${block}\n---\n`);
  if (frontMatter === null) throw new Error("no front matter");
  return frontMatter;
};

describe("propertiesLabel", () => {
  it("counts the keys the strip doesn't show", () => {
    const frontMatter = read("status: accepted\ntags: [a]\nowner: me\njira: X-1");
    expect(propertiesLabel(frontMatter, true)).toBe("2 more properties");
    expect(propertiesLabel(read("Status: accepted\nowner: me"), true)).toBe("1 more property");
  });

  it("counts every key when the strip shows none", () => {
    expect(propertiesLabel(read("owner: me\njira: X-1\nteam: core"), false)).toBe("3 properties");
    expect(propertiesLabel(read("owner: me"), false)).toBe("1 property");
  });

  it("says Properties when the strip shows every key, or there are none to count", () => {
    expect(propertiesLabel(read("status: accepted\ndate: 2026-08-12"), true)).toBe("Properties");
    expect(propertiesLabel(read("# only a comment"), false)).toBe("Properties");
    expect(propertiesLabel({ format: "toml", block: 'title = "x"', properties: [] }, false)).toBe("Properties");
  });
});

describe("isWebUrl", () => {
  it("is a link only for one http(s) address", () => {
    expect(isWebUrl("https://example.com/rfc/42")).toBe(true);
    expect(isWebUrl("http://example.com")).toBe(true);
    expect(isWebUrl("see https://example.com")).toBe(false);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("https://")).toBe(false);
  });
});
