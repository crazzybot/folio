/**
 * mermaidTheme.ts — Which background a Mermaid diagram was written for.
 *
 * A diagram that sets its own colours (`rect rgb(20, 40, 80)` blocks,
 * `style A fill:#1e3a5f`, `classDef x fill:...`) or its own theme
 * (`%%{init: {"theme": "dark"}}%%`) only reads well on the background its
 * author had: Mermaid's other theme switches the text colour, and dark text
 * vanishes into dark blocks. Such a diagram is drawn in its own theme on a
 * matching card instead (see MermaidDiagram.tsx).
 */

export type DiagramTheme = "light" | "dark";

// Mermaid themes that draw dark text on light backgrounds
const LIGHT_THEMES = new Set(["default", "neutral", "forest", "base"]);

/** sRGB relative luminance, 0 (black) … 1 (white). */
function luminance(r: number, g: number, b: number): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function hexToRgb(hex: string): [number, number, number] {
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A theme named by an init directive or front-matter config, if any. */
function declaredTheme(code: string): DiagramTheme | null {
  const match =
    /%%\{\s*init\s*:[\s\S]*?["']theme["']\s*:\s*["'](\w+)["']/.exec(code) ??
    /^\s*---[\s\S]*?^\s*theme\s*:\s*["']?(\w+)/m.exec(code);
  const name = match?.[1]?.toLowerCase();
  if (name === undefined) return null;
  if (name === "dark") return "dark";
  return LIGHT_THEMES.has(name) ? "light" : null;
}

/** Background colours the diagram sets itself: rect blocks, fill: and background: styles. */
function backgroundColours(code: string): [number, number, number][] {
  const colours: [number, number, number][] = [];
  // `rect rgb(…)` / `rect rgba(…)` in sequence diagrams, and rgb() in fill: styles
  for (const m of code.matchAll(/(?:\brect\s+|(?:fill|background(?:-color)?)\s*:\s*)rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    colours.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  for (const m of code.matchAll(/(?:fill|background(?:-color)?)\s*:\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    if (m[1] !== undefined) colours.push(hexToRgb(m[1]));
  }
  return colours;
}

/**
 * The theme the diagram was written for, or null when it doesn't say (it
 * then follows the app's theme). A declared theme wins; otherwise the
 * average brightness of the backgrounds it sets.
 */
export function authoredTheme(code: string): DiagramTheme | null {
  const declared = declaredTheme(code);
  if (declared !== null) return declared;
  const colours = backgroundColours(code);
  if (colours.length === 0) return null;
  const average = colours.reduce((sum, [r, g, b]) => sum + luminance(r, g, b), 0) / colours.length;
  // Mid-grey (≈ #777) splits dark from light backgrounds
  return average < 0.18 ? "dark" : "light";
}
