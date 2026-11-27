import { describe, expect, it } from "vitest";
import { frontMatterProperties } from "../src/frontMatter";

const properties = (block: string) => frontMatterProperties(`---\n${block}\n---\n# Title\n`)?.properties;

describe("frontMatterProperties", () => {
  it("has nothing without front matter, or with an empty one", () => {
    expect(frontMatterProperties("# Title\n")).toBeNull();
    expect(frontMatterProperties("---\n---\n# Title\n")).toBeNull();
    expect(frontMatterProperties("---\n\n---\n")).toBeNull();
  });

  it("reads scalars as the metadata rules do", () => {
    expect(properties('owner: platform-team\njira: "PLAT-1234"\nversion: 2 # bumped\nrfc: https://example.com/rfc/42')).toEqual([
      { key: "owner", value: "platform-team", raw: "platform-team" },
      { key: "jira", value: "PLAT-1234", raw: '"PLAT-1234"' },
      { key: "version", value: "2", raw: "2 # bumped" },
      { key: "rfc", value: "https://example.com/rfc/42", raw: "https://example.com/rfc/42" },
    ]);
  });

  it("reads flow and block lists", () => {
    expect(properties("tags: [queue, \"postgres\"]\naliases:\n  - One\n  - Two\nauthors:\n- Ana\n- Ben")).toEqual([
      { key: "tags", value: ["queue", "postgres"], raw: '[queue, "postgres"]' },
      { key: "aliases", value: ["One", "Two"], raw: "- One\n- Two" },
      { key: "authors", value: ["Ana", "Ben"], raw: "- Ana\n- Ben" },
    ]);
  });

  it("keeps any other form as written, dedented", () => {
    expect(properties("review:\n  reviewers:\n    - carol\n  due: 2026-12-01\nsummary: |\n  Line one\n\n  Line two\nmeta: {a: 1}\npeople:\n  - name: Ana\n  - name: Ben")).toEqual([
      { key: "review", value: null, raw: "reviewers:\n  - carol\ndue: 2026-12-01" },
      { key: "summary", value: null, raw: "|\nLine one\n\nLine two" },
      { key: "meta", value: null, raw: "{a: 1}" },
      { key: "people", value: null, raw: "- name: Ana\n- name: Ben" },
    ]);
  });

  it("keeps empty values, repeated keys and keys the scanner doesn't read", () => {
    expect(properties('draft:\n_hidden: true\n"key two": x\ndraft: no\nnote: # later')).toEqual([
      { key: "draft", value: null, raw: "" },
      { key: "_hidden", value: "true", raw: "true" },
      { key: "key two", value: "x", raw: "x" },
      { key: "draft", value: "no", raw: "no" },
      { key: "note", value: null, raw: "# later" },
    ]);
  });

  it("leaves comments at the margin out of the keys", () => {
    expect(properties("# About this file\nowner: me\n\n# Next\nteam: core")).toEqual([
      { key: "owner", value: "me", raw: "me" },
      { key: "team", value: "core", raw: "core" },
    ]);
  });

  it("keeps the block as written", () => {
    expect(frontMatterProperties("---\r\nowner: me # here\r\n---\r\nBody")).toEqual({
      format: "yaml",
      block: "owner: me # here",
      properties: [{ key: "owner", value: "me", raw: "me # here" }],
    });
  });

  it("shows TOML front matter as written only", () => {
    expect(frontMatterProperties('+++\ntitle = "Hello"\n+++\nBody')).toEqual({ format: "toml", block: 'title = "Hello"', properties: [] });
  });
});
