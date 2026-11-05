/**
 * links.ts — Classifies hrefs found inside a markdown document.
 *
 * Relative links resolve against the current document's folder (a leading
 * "/" means the workspace root), the same way GitHub resolves links between
 * files in a repository.
 */

export type LinkTarget =
  /** "#section" — a heading in the current document */
  | { kind: "anchor"; anchor: string }
  /** "other.md", "../guide.md#setup" — another document in the workspace */
  | { kind: "document"; id: string; anchor: string | null }
  /** "https://…", "mailto:…" — opens outside the app */
  | { kind: "external"; href: string }
  /** A relative link to something that isn't a workspace document */
  | { kind: "missing"; location: string };

// RFC 3986 scheme ("https:", "mailto:", …) or a protocol-relative "//host"
const EXTERNAL_HREF = /^([a-z][a-z\d+.-]*:|\/\/)/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Join `path` onto `baseDir` and collapse "." / ".." — null if it escapes the root. */
function resolvePath(baseDir: string, path: string): string | null {
  const segments = path.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

/**
 * Classify `href` as it appears in the document at `currentLocation`.
 * `idsByLocation` maps workspace-relative paths to document ids.
 */
export function resolveLink(
  href: string,
  currentLocation: string | null,
  idsByLocation: ReadonlyMap<string, string>,
): LinkTarget | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  if (EXTERNAL_HREF.test(trimmed)) return { kind: "external", href: trimmed };

  const hashIndex = trimmed.indexOf("#");
  const anchor = hashIndex >= 0 ? safeDecode(trimmed.slice(hashIndex + 1)) || null : null;
  const pathPart = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).split("?")[0] ?? "";

  // "#section" (or "?x#section") — stays in this document
  if (pathPart === "") return anchor !== null ? { kind: "anchor", anchor } : null;

  const baseDir =
    currentLocation !== null && currentLocation.includes("/")
      ? currentLocation.slice(0, currentLocation.lastIndexOf("/"))
      : "";
  const location = resolvePath(baseDir, safeDecode(pathPart));
  if (location === null || location === "") {
    return { kind: "missing", location: safeDecode(pathPart) };
  }

  // Extension-less links ("guide", "docs/setup") — try the markdown file
  const id =
    idsByLocation.get(location) ??
    idsByLocation.get(`${location}.md`) ??
    idsByLocation.get(`${location}.markdown`);
  if (id === undefined) return { kind: "missing", location };

  if (location === currentLocation && anchor !== null) return { kind: "anchor", anchor };
  return { kind: "document", id, anchor };
}
