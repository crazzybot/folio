import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MessageText from "./MessageText";

const html = (text: string) => renderToStaticMarkup(<MessageText text={text} />);

describe("MessageText", () => {
  it("renders formatting", () => {
    const out = html("**Send** is `primary`.\n\n- one\n- two");
    expect(out).toContain("<strong>Send</strong>");
    expect(out).toContain("<code>primary</code>");
    expect(out).toContain("<li>one</li>");
  });

  it("never opens, loads or runs anything", () => {
    const out = html('[docs](https://example.com) ![chart](https://example.com/a.png) <img src=x onerror="alert(1)"> <script>x()</script>');
    expect(out).not.toMatch(/<a |href=|<img|<script|onerror/);
    expect(out).toContain('title="https://example.com"');
    expect(out).toContain("chart");
  });

  it("shows a heading as a bold line", () => {
    expect(html("# Done")).toContain("<p><strong>Done</strong></p>");
  });
});
