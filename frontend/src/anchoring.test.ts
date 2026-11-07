import { describe, expect, it } from "vitest";
import { describeSpan, locateAnchor } from "./anchoring";

const TEXT =
  "Install the app. Run the installer as admin on Windows. " +
  "Then open the settings. Run the installer as admin again after updates.";

/** The anchor for the first `phrase` in TEXT (or its `nth` occurrence). */
function anchorFor(phrase: string, nth = 0) {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = TEXT.indexOf(phrase, at + 1);
  return describeSpan(TEXT, at, at + phrase.length);
}

const found = (text: string, span: { start: number; end: number } | null) =>
  span === null ? null : text.slice(span.start, span.end);

describe("describeSpan", () => {
  it("saves the text, up to 32 characters around it and the offsets", () => {
    const anchor = anchorFor("open the settings");
    expect(anchor.quote.exact).toBe("open the settings");
    expect(anchor.quote.prefix).toBe("aller as admin on Windows. Then ");
    expect(anchor.quote.suffix).toBe(". Run the installer as admin aga");
    expect(TEXT.slice(anchor.position.start, anchor.position.end)).toBe("open the settings");
  });

  it("stops at the ends of the text", () => {
    const anchor = describeSpan(TEXT, 0, 7);
    expect(anchor.quote.prefix).toBe("");
    expect(describeSpan(TEXT, TEXT.length - 8, TEXT.length).quote.suffix).toBe("");
  });
});

describe("locateAnchor", () => {
  it("finds an unchanged highlight where it was", () => {
    const anchor = anchorFor("open the settings");
    expect(locateAnchor(TEXT, anchor)).toEqual(anchor.position);
  });

  it("follows the text when something is added before it", () => {
    const edited = "A new first paragraph. " + TEXT;
    expect(found(edited, locateAnchor(edited, anchorFor("open the settings")))).toBe("open the settings");
  });

  it("isn't affected by changes after it", () => {
    const edited = TEXT.replace("again after updates", "every time");
    expect(locateAnchor(edited, anchorFor("Install the app"))).toEqual({ start: 0, end: 15 });
  });

  it("tells repeated text apart by what surrounds it", () => {
    const second = anchorFor("Run the installer as admin", 1);
    // Text added before both: offsets are off, the surroundings decide
    const edited = "Intro. " + TEXT;
    const span = locateAnchor(edited, second);
    expect(span?.start).toBe(edited.lastIndexOf("Run the installer as admin"));
    const first = locateAnchor(edited, anchorFor("Run the installer as admin", 0));
    expect(first?.start).toBe(edited.indexOf("Run the installer as admin"));
  });

  it("follows a highlight whose own text was edited", () => {
    const edited = TEXT.replace("Run the installer as admin on Windows", "Run the installer as an administrator on Windows");
    const span = locateAnchor(edited, anchorFor("Run the installer as admin on Windows"));
    expect(found(edited, span)).toBe("Run the installer as an administrator on Windows");
  });

  it("follows an edited highlight at the start of the text", () => {
    const edited = TEXT.replace("Install the app.", "Install the application.");
    expect(found(edited, locateAnchor(edited, anchorFor("Install the app.")))).toBe("Install the application.");
  });

  it("gives up when the passage is gone", () => {
    const edited = TEXT.replace("Then open the settings. ", "");
    expect(locateAnchor(edited, anchorFor("open the settings"))).toBeNull();
  });

  it("gives up when the passage was rewritten beyond recognition", () => {
    const edited = TEXT.replace("open the settings", "restart your computer twice");
    expect(locateAnchor(edited, anchorFor("open the settings"))).toBeNull();
  });
});
