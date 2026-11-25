/**
 * links.ts — What the live demo (`vite build --mode demo`) says it can't do,
 * and where to read about it: it has no coding agent, only simulated
 * replies, so its banner, the Send dialog and the status bar point to the
 * desktop app's review loop.
 */

/** The live demo build, not the desktop app's frontend. */
export const IS_DEMO = import.meta.env.MODE === "demo";

/** The user docs (docs-site/), published beside the demo (…/folio/demo/ → …/folio/docs/). */
export const DOCS = "../docs/";

/** The guide's section on a coding agent in a review loop. */
export const REVIEW_LOOP_DOCS = `${DOCS}guide/review-loop#review-in-a-loop`;

/** Open the review loop's guide, from the status bar's link. */
export function openReviewLoopDocs(): void {
  window.open(REVIEW_LOOP_DOCS, "_blank", "noopener");
}
