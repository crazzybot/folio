/**
 * katexLoader.ts — loads KaTeX (rehype-katex and its stylesheet) on demand.
 *
 * KaTeX is about half of the app's JavaScript, and most documents have no
 * math, so it's imported only for a document that may contain some, like
 * Mermaid. The check is deliberately loose: a "$" in a shell snippet loads
 * KaTeX for nothing, which is harmless; missing real math is not.
 */

import type rehypeKatexType from "rehype-katex";

export type RehypeKatex = typeof rehypeKatexType;

/** True when `markdown` may hold math: any "$", or a ```math / ~~~math block. */
export function mayContainMath(markdown: string): boolean {
  return markdown.includes("$") || /^[ \t]*(?:`{3,}|~{3,})[ \t]*math\b/m.test(markdown);
}

let loaded: RehypeKatex | null = null;
let loading: Promise<RehypeKatex> | null = null;

/** The plugin if it has already loaded, so documents after the first render at once. */
export function loadedRehypeKatex(): RehypeKatex | null {
  return loaded;
}

export function loadRehypeKatex(): Promise<RehypeKatex> {
  loading ??= Promise.all([import("rehype-katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => (loaded = module.default),
    (error: unknown) => {
      // Don't cache the failure: the next viewer to mount tries again
      loading = null;
      throw error;
    },
  );
  return loading;
}
