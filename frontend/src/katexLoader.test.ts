import { describe, expect, it } from "vitest";
import { mayContainMath } from "./katexLoader";

describe("mayContainMath", () => {
  it("finds dollar math", () => {
    expect(mayContainMath("Energy is $E=mc^2$.")).toBe(true);
    expect(mayContainMath("$$\n\\int_0^1 x\\,dx\n$$")).toBe(true);
  });

  it("finds ```math and ~~~math blocks", () => {
    expect(mayContainMath("Intro\n\n```math\nx^2\n```")).toBe(true);
    expect(mayContainMath("  ~~~~ math\nx^2\n~~~~")).toBe(true);
  });

  it("ignores documents without either", () => {
    expect(mayContainMath("# Notes\n\nPlain text, `code` and a [link](x.md).")).toBe(false);
    expect(mayContainMath("```mathematica\nPlot[x]\n```")).toBe(false);
    expect(mayContainMath("Mentions ```math inline, not as a fence")).toBe(false);
  });
});
