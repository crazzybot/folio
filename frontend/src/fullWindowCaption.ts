/**
 * The caption for a diagram or image opened in the whole window: the
 * document's title, then the figure's own title or else the nearest heading
 * above it. `fallback` is used when there's nothing to show.
 */
export function fullWindowCaption(figure: HTMLElement, ownTitle: string | null, fallback: string): string {
  const article = figure.closest("article");
  const headings = article === null ? [] : [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  const documentTitle = headings[0]?.textContent?.trim() ?? "";
  const above = headings.filter((h) => h.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const own = ownTitle?.trim() || (above?.textContent?.trim() ?? "");
  const parts = [documentTitle, own].filter((part, i, all) => part !== "" && all.indexOf(part) === i);
  return parts.length > 0 ? parts.join(" — ") : fallback;
}
