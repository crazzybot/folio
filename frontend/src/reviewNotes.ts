/**
 * reviewNotes.ts — Copy review notes' formatting, shared with the MCP server:
 * it lives in the core (packages/core/src/reviewNotes.ts).
 */

export {
  defaultIntro,
  formatReviewNotes,
  reviewPath,
  statusRequest,
} from "../../packages/core/src/reviewNotes";
export type { ReviewDocument, ReviewNote, ReviewNotes } from "../../packages/core/src/reviewNotes";
