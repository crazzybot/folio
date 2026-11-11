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
const markers = (root: HTMLElement) => [...root.querySelectorAll(".folio-note-marker")].map((m) => m.textContent);
const microtasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("placeInlineNotes", () => {
  it("puts a lone note after its paragraph, without a number", () => {
    const root = article("<p>One <em>two</em> three.</p><p>Next.</p>");
    placeInlineNotes(root, [noteOn(root, "two")]);
    const notes = root.querySelector(".folio-inline-notes");
    expect(notes?.previousElementSibling?.textContent).toBe("One two three.");
    expect(notesText(root)).toEqual(["on two"]);
    expect(markers(root)).toEqual([]);
  });

  it("numbers a block's notes by where their passages end, with markers after them", () => {
    const root = article("<p>Alpha beta gamma delta.</p>");
    // Given out of order
    placeInlineNotes(root, [noteOn(root, "gamma"), noteOn(root, "Alpha")]);
    expect(notesText(root)).toEqual(["1on Alpha", "2on gamma"]);
    expect(root.querySelector("p")?.innerHTML).toBe(
      'Alpha<sup data-marks-skip="" contenteditable="false" class="folio-note-marker" data-highlight="Alpha" style="--note-color: yellow;">1</sup> beta gamma<sup data-marks-skip="" contenteditable="false" class="folio-note-marker" data-highlight="gamma" style="--note-color: yellow;">2</sup> delta.',
    );
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
    const row = root.querySelector(".folio-inline-notes-row");
    expect(row?.previousElementSibling?.textContent).toBe("Free5201");
    expect(row?.querySelector("td")?.colSpan).toBe(3);
    expect(notesText(root)).toEqual(["1Burst: on 20"]);
  });

  it("names a column by its math as shown", () => {
    const root = article(
      '<table><thead><tr><th>Burst <span class="katex"><span class="katex-mathml">b b</span><span class="katex-html">b</span></span></th></tr></thead>' +
        "<tbody><tr><td>20</td></tr></tbody></table>",
    );
    placeInlineNotes(root, [noteOn(root, "20")]);
    expect(notesText(root)).toEqual(["1Burst b: on 20"]);
  });

  it("puts notes after a table with rowspan, labelled by row and column", () => {
    const root = article(
      '<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td rowspan="2">Merged</td><td>top</td></tr><tr><td>bottom</td></tr></tbody></table><p>After.</p>',
    );
    placeInlineNotes(root, [noteOn(root, "top")]);
    expect(root.querySelector(".folio-inline-notes")?.previousElementSibling?.tagName).toBe("TABLE");
    expect(notesText(root)).toEqual(["1Row Merged, column Value: on top"]);
  });

  it("shows nothing for a passage in a closed <details>", () => {
    const root = article("<details><summary>More</summary><p>Hidden words.</p></details>");
    placeInlineNotes(root, [noteOn(root, "Hidden")]);
    expect(root.querySelector(".folio-inline-notes")).toBeNull();
    root.querySelector("details")?.setAttribute("open", "");
    placeInlineNotes(root, [noteOn(root, "Hidden")]);
    expect(notesText(root)).toEqual(["on Hidden"]);
  });

  it("leaves the document's text and the highlights' ranges as they were", () => {
    const root = article("<p>Alpha beta gamma <strong>bold</strong> delta.</p>");
    const before = buildTextModel(root).text;
    const notes = [noteOn(root, "Alpha"), noteOn(root, "beta"), noteOn(root, "bold")];
    placeInlineNotes(root, notes);
    expect(buildTextModel(root).text).toBe(before);
    expect(notes.map((n) => n.range.toString())).toEqual(["Alpha", "beta", "bold"]);
  });

  it("restores the DOM exactly when removed, keeping the ranges", () => {
    const html = "<p>Alpha beta gamma <strong>bold</strong> delta.</p><ul><li>Item<ul><li>x</li></ul></li></ul>";
    const root = article(html);
    const notes = [noteOn(root, "Alpha"), noteOn(root, "gamma"), noteOn(root, "bold"), noteOn(root, "Item")];
    const textNodes = [...root.querySelectorAll("p, li")].flatMap((el) => [...el.childNodes]);
    const placed = placeInlineNotes(root, notes);
    placed.remove(notes.map((n) => n.range));
    expect(root.innerHTML).toBe(html);
    // The same nodes React made, not copies
    expect([...root.querySelectorAll("p, li")].flatMap((el) => [...el.childNodes])).toEqual(textNodes);
    expect(notes.map((n) => n.range.toString())).toEqual(["Alpha", "gamma", "bold", "Item"]);
  });

  it("merges a text node split three times back, with the ranges in every part", () => {
    const html = "<p>Alpha beta gamma delta epsilon.</p>";
    const root = article(html);
    const notes = ["Alpha", "beta", "gamma", "delta"].map((q) => noteOn(root, q));
    // Not shown, but painted: a highlight in the last part
    const other = noteOn(root, "epsilon").range;
    const placed = placeInlineNotes(root, notes);
    expect(markers(root)).toEqual(["1", "2", "3", "4"]);
    placed.remove([...notes.map((n) => n.range), other]);
    expect(root.innerHTML).toBe(html);
    expect(root.querySelector("p")?.childNodes).toHaveLength(1);
    expect([...notes.map((n) => n.range.toString()), other.toString()]).toEqual(["Alpha", "beta", "gamma", "delta", "epsilon"]);
  });

  it("keeps a range that starts after a marker in the same text node", () => {
    const root = article("<p>Alpha beta gamma.</p>");
    const notes = [noteOn(root, "Alpha"), noteOn(root, "gamma")];
    const placed = placeInlineNotes(root, notes);
    expect(notes[1]?.range.toString()).toBe("gamma");
    placed.remove(notes.map((n) => n.range));
    expect(notes.map((n) => n.range.toString())).toEqual(["Alpha", "gamma"]);
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
  function Paragraph({ text }: { text: string }) {
    // Text beside an element: React keeps a text node and writes new text into it
    return createElement("p", null, text, " ", createElement("strong", null, "bold"), " end.");
  }

  function setup() {
    const root = article("");
    const react = createRoot(root);
    flushSync(() => react.render(createElement(Paragraph, { text: "Alpha beta gamma delta" })));
    // Found again each time, as the viewer finds highlights again after a render
    let found: InlineNote[] = [];
    const notes = () => (found = [noteOn(root, "gamma"), noteOn(root, "delta")]);
    const ranges = () => found.map((n) => n.range);
    return { root, react, notes, ranges };
  }

  it("shows the old text twice when React rewrites a split text node without it", () => {
    const { root, react, notes } = setup();
    placeInlineNotes(root, notes());
    flushSync(() => react.render(createElement(Paragraph, { text: "Alpha BETA gamma delta" })));
    // The tail split off for the first marker is still there
    expect(root.querySelector("p")?.textContent).toContain("Alpha BETA gamma delta");
    expect(buildTextModel(root).text).not.toBe("Alpha BETA gamma delta bold end.");
    react.unmount();
  });

  it("places the notes again once React has rewritten the text", async () => {
    const { root, react, notes, ranges } = setup();
    const stop = watchInlineNotes(root, notes, ranges);
    expect(markers(root)).toEqual(["1", "2"]);

    flushSync(() => react.render(createElement(Paragraph, { text: "Alpha BETA gamma delta" })));
    await microtasks();
    expect(buildTextModel(root).text).toBe("Alpha BETA gamma delta bold end.");
    expect(markers(root)).toEqual(["1", "2"]);

    stop();
    expect(root.innerHTML).toBe("<p>Alpha BETA gamma delta <strong>bold</strong> end.</p>");
    react.unmount();
  });

  it("doesn't place them again for its own changes", async () => {
    const { root, react, notes, ranges } = setup();
    let placings = 0;
    const stop = watchInlineNotes(root, notes, ranges, () => placings++);
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
