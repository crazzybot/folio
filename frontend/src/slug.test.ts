import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["3. Core concepts", "3-core-concepts"],
    ["Q&A — FAQ", "qa--faq"],
    ["  snake_case stays  ", "snake_case-stays"],
  ])("%j → %j", (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });
});
