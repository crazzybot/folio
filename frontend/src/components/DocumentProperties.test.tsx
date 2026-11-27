// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { frontMatterProperties } from "../frontMatter";
import { FRONT_MATTER_VIEWS } from "../readerPrefs";
import type { DocumentMeta, Metadata } from "../types";
import DocumentProperties from "./DocumentProperties";

const META: Metadata = { status: "accepted", statusDetail: null, date: null, people: [], tags: [], statusLine: 2 };

function render(text: string, { meta, open = false, view = 0 }: { meta?: Metadata; open?: boolean; view?: 0 | 1 } = {}): string {
  const doc: DocumentMeta = { id: "a", filename: "a.md", location: "a.md", title: "A", created: "", headings: [], ...(meta && { meta }) };
  const frontMatter = frontMatterProperties(text);
  return renderToStaticMarkup(
    <DocumentProperties
      doc={doc}
      documents={[doc]}
      frontMatter={
        frontMatter === null
          ? undefined
          : { frontMatter, open, setOpen: () => {}, view: FRONT_MATTER_VIEWS[view], setView: () => {} }
      }
    />,
  );
}

describe("DocumentProperties with front matter", () => {
  it("shows the toggle alone when the strip has nothing else", () => {
    const out = render("---\nowner: me\njira: X-1\n---\n");
    expect(out).toContain('aria-label="Document properties"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("2 properties");
    expect(out).not.toContain('aria-label="Front matter"');
  });

  it("counts what the strip doesn't show", () => {
    expect(render("---\nstatus: accepted\nowner: me\n---\n", { meta: META })).toContain("1 more property");
  });

  it("shows nothing without front matter or metadata", () => {
    expect(render("# Title\n")).toBe("");
  });

  it("shows every key as text when open, never as Markdown or HTML", () => {
    const out = render('---\nstatus: accepted\nnote: "<b>bold</b> [x](javascript:alert(1))"\nrfc: https://example.com/rfc\n---\n', {
      meta: META,
      open: true,
    });
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-label="Front matter"');
    expect(out).toContain("<dt");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt; [x](javascript:alert(1))");
    expect(out).not.toContain("<b>");
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('href="https://example.com/rfc"');
  });

  it("shows the block as written in the YAML view", () => {
    const out = render("---\nowner: me # here\n---\n", { open: true, view: 1 });
    expect(out).toContain("<pre");
    expect(out).toContain("owner: me # here");
    expect(out).toContain('aria-pressed="true"');
  });
});
