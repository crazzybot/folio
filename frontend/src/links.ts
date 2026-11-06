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
  /** "data.csv", "../report.pdf" — another kind of file in the workspace */
  | { kind: "file"; location: string; openable: boolean }
  /** A relative link to something that isn't a workspace document */
  | { kind: "missing"; location: string };

/**
 * Files a link may open (in its app on the desktop, from the backend in the
 * browser): documents, data, office files, images and media — never HTML,
 * SVG, scripts, executables, launchers or archives. Enforced by the desktop
 * app (desktop/src/files.ts) and the backend (LINKED_FILE_TYPES); here it
 * only decides how a link looks.
 */
const OPENABLE_EXTENSIONS = new Set(
  (
    "pdf txt log csv tsv json yaml yml xml rtf epub doc docx xls xlsx ppt pptx odt ods odp pages numbers " +
    "png jpg jpeg gif webp avif bmp ico heic tif tiff mp3 m4a aac wav flac ogg mp4 m4v mov webm"
  ).split(" "),
);

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
  if (id === undefined) {
    // A file name with a (non-markdown) extension: some other file, opened
    // outside the viewer if it exists and is a safe type
    const name = location.slice(location.lastIndexOf("/") + 1);
    const hasExtension = name.lastIndexOf(".") > 0;
    const isMarkdown = /\.(md|markdown)$/i.test(name);
    if (!hasExtension || isMarkdown) return { kind: "missing", location };
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    return { kind: "file", location, openable: OPENABLE_EXTENSIONS.has(extension) };
  }

  if (location === currentLocation && anchor !== null) return { kind: "anchor", anchor };
  return { kind: "document", id, anchor };
}

export type ImageSource =
  /** "https://…" — loaded as it is */
  | { kind: "url"; src: string }
  /** "img/diagram.png" — a file in the workspace */
  | { kind: "workspace"; location: string };

/**
 * Resolve an image `src` as it appears in the document at `currentLocation`:
 * URLs with a scheme are used as they are, relative paths become a workspace
 * location. Null when the path escapes the workspace.
 */
export function resolveImageSrc(src: string, currentLocation: string | null): ImageSource | null {
  const trimmed = src.trim();
  if (trimmed === "") return null;
  if (EXTERNAL_HREF.test(trimmed)) return { kind: "url", src: trimmed };

  const pathPart = trimmed.split(/[?#]/)[0] ?? "";
  const baseDir =
    currentLocation !== null && currentLocation.includes("/")
      ? currentLocation.slice(0, currentLocation.lastIndexOf("/"))
      : "";
  const location = resolvePath(baseDir, safeDecode(pathPart));
  if (location === null || location === "") return null;
  return { kind: "workspace", location };
}
