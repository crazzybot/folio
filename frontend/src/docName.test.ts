import { describe, expect, it } from "vitest";
import { documentName, titleIsName } from "./docName";

describe("documentName", () => {
  it("reads well-known names in any case, as written", () => {
    expect(documentName("README.md")).toBe("README");
    expect(documentName("readme.md")).toBe("readme");
    expect(documentName("Changelog.md")).toBe("Changelog");
    expect(documentName("AGENTS.md")).toBe("AGENTS");
    expect(documentName("CLAUDE.md")).toBe("CLAUDE");
    expect(documentName("CODE_OF_CONDUCT.md")).toBe("CODE_OF_CONDUCT");
    expect(documentName("copilot-instructions.md")).toBe("copilot-instructions");
    expect(documentName("SKILL.markdown")).toBe("SKILL");
  });

  it("reads any name in capitals", () => {
    expect(documentName("SPEC.md")).toBe("SPEC");
    expect(documentName("DESIGN-NOTES.md")).toBe("DESIGN-NOTES");
    expect(documentName("TODO_2.md")).toBe("TODO_2");
  });

  it("leaves other names alone", () => {
    expect(documentName("notes.md")).toBeNull();
    expect(documentName("Design.md")).toBeNull();
    expect(documentName("queue-options.md")).toBeNull();
    expect(documentName("A.md")).toBeNull(); // a single letter isn't a name
    expect(documentName("README.ja.md")).toBeNull();
    expect(documentName("SPEC-.md")).toBeNull();
  });
});

describe("titleIsName", () => {
  it("matches a title that only repeats the name", () => {
    expect(titleIsName("Changelog", "CHANGELOG")).toBe(true);
    expect(titleIsName("README", "README")).toBe(true);
    expect(titleIsName("Code of Conduct", "CODE_OF_CONDUCT")).toBe(true);
    expect(titleIsName("Copilot instructions", "copilot-instructions")).toBe(true);
  });

  it("keeps a title that says more", () => {
    expect(titleIsName("RCM Claims Engine — Workspace", "AGENTS")).toBe(false);
    expect(titleIsName("Contributor Covenant Code of Conduct", "CODE_OF_CONDUCT")).toBe(false);
    expect(titleIsName("Contributing to Folio", "CONTRIBUTING")).toBe(false);
  });
});
