import { describe, expect, it } from "vitest";
import { authoredTheme } from "./mermaidTheme";

describe("authoredTheme", () => {
  it.each([
    ["plain", "flowchart LR\n A --> B", null],
    ["dark rect blocks", "sequenceDiagram\n rect rgb(25, 40, 80)\n A->>B: hi\n end", "dark"],
    ["light rect", "sequenceDiagram\n rect rgb(255, 245, 220)\n A->>B: hi\n end", "light"],
    ["dark fill hex", "flowchart LR\n A-->B\n style A fill:#1e3a5f,color:#fff", "dark"],
    ["light short hex classDef", "flowchart LR\n classDef k fill:#ffe,stroke:#333\n A:::k", "light"],
    ["init directive", '%%{init: {"theme": "dark"}}%%\nflowchart LR\n A-->B', "dark"],
    ["init forest", "%%{init: {'theme': 'forest'}}%%\nflowchart LR\n A-->B", "light"],
    ["front matter", "---\nconfig:\n  theme: dark\n---\nflowchart LR\n A-->B", "dark"],
    ["stroke only", "flowchart LR\n style A stroke:#000", null],
  ])("%s", (_name, code, theme) => {
    expect(authoredTheme(code)).toBe(theme);
  });
});
