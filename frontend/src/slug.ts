/**
 * GFM slug generation — matches GitHub's anchor algorithm:
 *   1. Lowercase
 *   2. Strip anything that is not alphanumeric, space, hyphen, or underscore
 *   3. Replace spaces with hyphens
 *
 * Shared by the viewer (heading ids) and the sidebar (links to headings).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // strip chars outside word chars, whitespace, hyphen
    .trim()
    .replace(/\s/g, "-"); // spaces → hyphens (one-to-one, preserves double-dash for stripped chars like &)
}
