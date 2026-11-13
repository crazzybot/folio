// @vitest-environment jsdom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { placeInlineNotes, watchInlineNotes } from "./inlineNotes";
import type { InlineNote } from "./inlineNotes";
import { findMatches } from "./searchHighlight";
import { buildTextModel } from "./textModel";

afterEach(() => {
  document.body.innerHTML = "";
});

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

/** A note on the first `quote` in `root`'s text, found as MarksLayer finds highlights. */
function noteOn(root: HTMLElement, quote: string, note = `on ${quote}`): InlineNote {
  const model = buildTextModel(root);
  const at = model.text.indexOf(quote);
  if (at === -1) throw new Error(`not in the text: ${quote}`);
  return { id: quote, range: model.range(at, at + quote.length), color: "yellow", note };
}

const notesText = (root: HTMLElement) => [...root.querySelectorAll(".folio-inline-note")].map((n) => n.textContent);
/** The text before each group of notes: the block it follows. */
const notesAfter = (root: HTMLElement) =>
  [...root.querySelectorAll(".folio-inline-notes")].map(
    (n) => (n.closest(".folio-inline-notes-row") ?? n).previousElementSibling?.textContent,
  );
const microtasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("placeInlineNotes", () => {
  it("puts a lone note after its paragraph, without a number", () => {
    const root = article("<p>One <em>two</em> three.</p><p>Next.</p>");
    placeInlineNotes(root, [noteOn(root, "two")]);
    expect(notesAfter(root)).toEqual(["One two three."]);
    expect(notesText(root)).toEqual(["on two"]);
  });

  it("adds a line for the note's replies, marked new when some are, outside the text", () => {
    const root = article("<p>One two.</p><p>Three four.</p>");
    const summary = (fresh: number) => ({ text: "2 replies · latest from Claude Code, 10:02", title: "", fresh });
    placeInlineNotes(root, [{ ...noteOn(root, "two"), replies: summary(1) }, { ...noteOn(root, "four"), replies: summary(0) }]);
    const lines = [...root.querySelectorAll(".folio-inline-note-replies")];
    expect(lines.map((l) => l.textContent)).toEqual(["↳ 2 replies · latest from Claude Code, 10:02 New", "↳ 2 replies · latest from Claude Code, 10:02"]);
    expect(buildTextModel(root).text).toBe(buildTextModel(article("<p>One two.</p><p>Three four.</p>")).text);
  });

  it("numbers a block's notes by where their passages end, leaving the text alone", () => {
    const root = article("<p>Alpha beta gamma delta.</p>");
    // Given out of order
    placeInlineNotes(root, [noteOn(root, "gamma"), noteOn(root, "Alpha")]);
    expect(notesText(root)).toEqual(["1on Alpha", "2on gamma"]);
    expect(root.querySelector("p")?.innerHTML).toBe("Alpha beta gamma delta.");
  });

  it("puts a list item's note after its own text, before its nested list", () => {
    const root = article("<ul><li>Outer item<ul><li>Inner</li></ul></li></ul>");
    placeInlineNotes(root, [noteOn(root, "Outer")]);
    const notes = root.querySelector(".folio-inline-notes");
    expect(notes?.parentElement?.tagName).toBe("LI");
    expect(notes?.nextElementSibling?.tagName).toBe("UL");
  });

  it("keeps a quote's note inside the quote", () => {
    const root = article("<blockquote><p>Quoted words.</p></blockquote>");
    placeInlineNotes(root, [noteOn(root, "Quoted")]);
    expect(root.querySelector(".folio-inline-notes")?.parentElement?.tagName).toBe("BLOCKQUOTE");
  });

  it("puts a table cell's note in a row under the cell's row, labelled by column", () => {
    const root = article(
      "<table><thead><tr><th>Plan</th><th>Rate</th><th>Burst</th></tr></thead>" +
        "<tbody><tr><td>Free</td><td>5</td><td>20</td></tr><tr><td>Team</td><td>50</td><td>200</td></tr></tbody></table>",
    );
    placeInlineNotes(root, [noteOn(root, "20")]);
    expect(notesAfter(root)).toEqual(["Free520"]);
    expect(root.querySelector(".folio-inline-notes-row td")?.getAttribute("colspan")).toBe("3");
    expect(notesText(root)).toEqual(["Burst: on 20"]);
  });

  it("names a column by its math as shown", () => {
    const root = article(
      '<table><thead><tr><th>Burst <span class="katex"><span class="katex-mathml">b b</span><span class="katex-html">b</span></span></th></tr></thead>' +
        "<tbody><tr><td>20</td></tr></tbody></table>",
    );
    placeInlineNotes(root, [noteOn(root, "20")]);
    expect(notesText(root)).toEqual(["Burst b: on 20"]);
  });

  it("puts notes after a table with rowspan, labelled by row and column", () => {
    const root = article(
      '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td rowspan="2">Merged</td><td>top</td></tr><tr><td>bottom</td></tr></tbody></table><p>After.</p>',
    );
    placeInlineNotes(root, [noteOn(root, "top"), noteOn(root, "bottom")]);
    expect(root.querySelector(".folio-inline-notes")?.previousElementSibling?.tagName).toBe("TABLE");
    expect(notesText(root)).toEqual(["1Row Merged, column Value: on top", "2Row bottom, column Name: on bottom"]);
  });

  it("shows nothing for a passage in a closed <details>", () => {
    const root = article("<details><summary>More</summary><p>Hidden words.</p></details>");
    placeInlineNotes(root, [noteOn(root, "Hidden")]);
    expect(root.querySelector(".folio-inline-notes")).toBeNull();
    root.querySelector("details")?.setAttribute("open", "");
    placeInlineNotes(root, [noteOn(root, "Hidden")]);
    expect(notesText(root)).toEqual(["on Hidden"]);
  });

  it("leaves the document's text, its nodes and the highlights' ranges as they were", () => {
    const root = article("<p>Alpha beta gamma <strong>bold</strong> delta.</p><ul><li>Item<ul><li>x</li></ul></li></ul>");
    const before = buildTextModel(root).text;
    const nodes = [...root.querySelectorAll("p, li")].flatMap((el) => [...el.childNodes]);
    const notes = [noteOn(root, "Alpha"), noteOn(root, "beta"), noteOn(root, "bold"), noteOn(root, "Item")];
    placeInlineNotes(root, notes);
    expect(buildTextModel(root).text).toBe(before);
    expect(notes.map((n) => n.range.toString())).toEqual(["Alpha", "beta", "bold", "Item"]);
    // Only notes were added: React's own nodes are all still there, unchanged
    const now = [...root.querySelectorAll("p, li")].flatMap((el) => [...el.childNodes]);
    expect(now.filter((n) => !(n instanceof Element && n.hasAttribute("data-marks-skip")))).toEqual(nodes);
  });

  it("restores the DOM exactly when removed", () => {
    const html = "<p>Alpha beta gamma <strong>bold</strong> delta.</p><ul><li>Item<ul><li>x</li></ul></li></ul>";
    const root = article(html);
    const placed = placeInlineNotes(root, [noteOn(root, "Alpha"), noteOn(root, "bold"), noteOn(root, "Item")]);
    placed.remove();
    expect(root.innerHTML).toBe(html);
  });
});

describe("findMatches", () => {
  it("doesn't match text in inline notes", () => {
    const root = article("<p>Alpha beta.</p>");
    placeInlineNotes(root, [noteOn(root, "beta", "Alpha in a note")]);
    expect(findMatches(root, "alpha")).toHaveLength(1);
  });
});

describe("watchInlineNotes with React", () => {
  function Document({ blocks }: { blocks: string[] }) {
    // Text beside an element: React keeps a text node and writes new text into it
    return createElement(
      "div",
      null,
      blocks.map((text) => createElement("p", { key: text.split(" ")[0] }, text, " ", createElement("strong", null, "bold"))),
    );
  }

  function setup(quotes: string[]) {
    const root = article("");
    const react = createRoot(root);
    const render = (blocks: string[]) => flushSync(() => react.render(createElement(Document, { blocks })));
    render(["Alpha beta gamma", "Second paragraph"]);
    // Found again each time, as the viewer finds highlights again after a render
    const notes = () => quotes.flatMap((q) => (buildTextModel(root).text.includes(q) ? [noteOn(root, q)] : []));
    return { root, react, render, notes };
  }

  it("leaves the text React rewrites whole", async () => {
    const { root, react, render, notes } = setup(["gamma"]);
    const stop = watchInlineNotes(root, notes);
    render(["Alpha BETA gamma", "Second paragraph"]);
    await microtasks();
    expect(buildTextModel(root).text).toBe("Alpha BETA gamma boldSecond paragraph bold");
    expect(notesAfter(root)).toEqual(["Alpha BETA gamma bold"]);
    stop();
    react.unmount();
  });

  it("places the notes again when React adds or removes blocks", async () => {
    const { root, react, render, notes } = setup(["gamma", "Second"]);
    const stop = watchInlineNotes(root, notes);
    expect(notesAfter(root)).toEqual(["Alpha beta gamma bold", "Second paragraph bold"]);

    render(["New opening", "Alpha beta gamma", "Second paragraph"]);
    await microtasks();
    expect(notesAfter(root)).toEqual(["Alpha beta gamma bold", "Second paragraph bold"]);

    render(["New opening", "Second paragraph"]);
    await microtasks();
    expect(notesAfter(root)).toEqual(["Second paragraph bold"]);

    stop();
    expect(root.querySelector(".folio-inline-notes")).toBeNull();
    react.unmount();
  });

  it("doesn't place them again for its own changes", async () => {
    const { root, react, notes } = setup(["gamma"]);
    let placings = 0;
    const stop = watchInlineNotes(root, notes, () => placings++);
    await microtasks();
    expect(placings).toBe(1);
    // A class set on a note (hover) isn't a change to the document
    root.querySelector(".folio-inline-note")?.classList.add("folio-hovered");
    await microtasks();
    expect(placings).toBe(1);
    stop();
    react.unmount();
  });
});
