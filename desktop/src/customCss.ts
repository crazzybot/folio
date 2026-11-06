/**
 * customCss.ts — The user's own document styles: custom.css in the app's
 * data folder, applied on top of the chosen document style and reloaded as
 * it's saved. View → Edit Custom CSS… creates it from a template.
 *
 * It's the user's own file, so it's trusted like settings.json; CSS can't
 * run scripts, and the page's Content-Security-Policy still applies.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 512 * 1024;
const RELOAD_DELAY_MS = 150;

const TEMPLATE = `/*
 * Folio custom styles — applied on top of the document style chosen in the
 * display options menu (Default, Book or Compact), in print and PDF too.
 * Saved changes show immediately.
 *
 * Target the document with .folio-document. To change only one style, use
 * [data-doc-style="book"] .folio-document (or "default", "compact").
 * For colours that work in light and dark, use the theme's variables:
 * var(--color-text), var(--color-text-strong), var(--color-link),
 * var(--color-border), var(--color-code-bg)…
 *
 * Examples — remove the comment markers around one to try it:
 */

/*
.folio-document {
  font-family: "Avenir Next", "Segoe UI", sans-serif;
}

.folio-document h1,
.folio-document h2 {
  color: var(--color-link);
  border-bottom: none;
}

.folio-document blockquote {
  border-left-color: var(--color-link);
}

@media print {
  .folio-document {
    font-size: 11pt;
  }
}
*/
`;

export function customCssPath(): string {
  return path.join(app.getPath("userData"), "custom.css");
}

/** The custom CSS, or null when there is none (or it's too large to be a stylesheet). */
export function readCustomCss(): string | null {
  try {
    const file = customCssPath();
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The file's path, after writing the template if it doesn't exist yet. */
export function ensureCustomCss(): string {
  const file = customCssPath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, TEMPLATE);
  }
  return file;
}

/** Call `onChange` with the new CSS whenever custom.css is saved, created or removed. */
export function watchCustomCss(onChange: (css: string | null) => void): void {
  const file = customCssPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let timer: NodeJS.Timeout | undefined;
  // Watch the folder, not the file: editors often save by replacing the file
  fs.watch(path.dirname(file), (_event, filename) => {
    if (filename !== path.basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(readCustomCss()), RELOAD_DELAY_MS);
  });
}
