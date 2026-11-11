/**
 * imageTypes.ts — The image types a document may embed: the scanner lists
 * them as attachments, and the desktop app serves them.
 */

/** Image types a document may embed, with the content type they are served as. */
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
