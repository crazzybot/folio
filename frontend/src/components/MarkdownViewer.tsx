import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHref } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeHighlightOptions } from "rehype-highlight";
import type { Components, ExtraProps, Options as MarkdownOptions } from "react-markdown";
import { workspaceFileUrl } from "../api";

const desktopApi = window.markdownApi;
import { resolveImageSrc, resolveLink } from "../links";
import type { ImageSource, LinkTarget } from "../links";
import { saveScrollPosition } from "../scrollHistory";
import { slugify } from "../slug";
import { clearMatches, findMatches, showMatches } from "../searchHighlight";
import MarksLayer from "./MarksLayer";
import { findBookmark, headingIdentities } from "../bookmarks";
import type { MarkFocus } from "./MarksLayer";
import type { Bookmark, BookmarkHeading, Highlight, HighlightColor, TextAnchor } from "../types";
import FindBar from "./FindBar";
import Outline from "./Outline";
import type { OutlineHeading } from "./Outline";
import type { DocumentMeta } from "../types";

// Register only the languages we need (tree-shakeable subset)
import langJson from "highlight.js/lib/languages/json";
import langPython from "highlight.js/lib/languages/python";
import langJavascript from "highlight.js/lib/languages/javascript";
import langTypescript from "highlight.js/lib/languages/typescript";
import langGo from "highlight.js/lib/languages/go";
import langC from "highlight.js/lib/languages/c";
import langCpp from "highlight.js/lib/languages/cpp";
import langXml from "highlight.js/lib/languages/xml"; // covers html

import "../syntax.css";
import remarkMathDollars from "../mathDollars";
import { loadRehypeKatex, loadedRehypeKatex, mayContainMath } from "../katexLoader";
import type { RehypeKatex } from "../katexLoader";
import remarkObsidian from "../obsidian";
import MermaidDiagram from "./MermaidDiagram";
import styles from "./MarkdownViewer.module.css";
// After the module CSS: document styles override the base rules by order
import "../documentStyles.css";

interface MarkdownViewerProps {
  content: string | null;
  /** Id of the document `content` belongs to; lags `selectedId` while the next one loads. */
  contentId?: string | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** The current in-document anchor (without the leading '#'), or null/empty. */
  anchor?: string | null;
  /** Identifies the current history entry; changes on every navigation. */
  navigationKey?: string;
  /** Scroll position to return to for this history entry (Back/Forward), or null. */
  restoreScrollTop?: number | null;
  /** Called when the user clicks an in-document '#...' link. */
  onAnchorClick?: (anchorId: string) => void;
  /** All workspace documents — used to resolve links between documents. */
  documents?: DocumentMeta[];
  /** Workspace-relative paths of the images, for ![[image.png]] embeds. */
  attachments?: string[];
  /** Workspace-relative path of the displayed document (base for relative links). */
  currentLocation?: string | null;
  /** Called when the user clicks a link to another workspace document. */
  onOpenDocument?: (id: string, anchor: string | null) => void;
  /** Search text to highlight in the document ("" for none). */
  searchQuery?: string;
  /** A search match to scroll to once its document is shown. */
  searchFocus?: SearchFocus | null;
  /** Show the outline of headings beside the document. */
  showOutline?: boolean;
  /** The shown document's highlights and bookmarks. */
  highlights?: readonly Highlight[];
  bookmarks?: readonly Bookmark[];
  /** A mark to scroll to once its document is shown (Marks view). */
  markFocus?: (MarkFocus & { docId: string }) | null;
  /** Changes to the shown document's marks; without them, nothing can be highlighted or bookmarked. */
  markHandlers?: MarkHandlers;
  /** The ids of the shown document's highlights found in its text (the rest can't be placed). */
  onLocatedChange?: (docId: string, ids: ReadonlySet<string>) => void;
}

export interface MarkHandlers {
  add: (anchor: TextAnchor, color: HighlightColor) => Promise<Highlight | null>;
  recolor: (id: string, color: HighlightColor) => void;
  setNote: (id: string, note: string | null) => void;
  remove: (id: string) => void;
  toggleHeadingBookmark: (heading: BookmarkHeading) => void;
}

/** "Scroll to the `occurrence`-th match in `docId`"; a new `nonce` asks again. */
export interface SearchFocus {
  docId: string;
  occurrence: number;
  nonce: number;
}

// ---------------------------------------------------------------------------
// Heading anchors — GFM slugs of the heading's text (see slug.ts)
// ---------------------------------------------------------------------------

/** Recursively extract plain text from React children. */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    // `props` is typed as `unknown` in strict React 18 — narrow safely.
    const props = node.props as Record<string, unknown>;
    return extractText(props["children"] as React.ReactNode);
  }
  return "";
}

/** Convert a heading's text content to a GFM-compatible anchor slug. */
function toSlug(children: React.ReactNode): string {
  return slugify(extractText(children));
}

// ---------------------------------------------------------------------------
// Custom heading components — h1 through h6
// Each one computes a slug from its children and sets it as the `id`.
// ---------------------------------------------------------------------------

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function makeHeading(Tag: HeadingTag) {
  // Named so React DevTools shows a useful label
  function Heading({
    children,
    node: _node,
    ...rest
  }: React.HTMLAttributes<HTMLHeadingElement> & ExtraProps): React.ReactElement {
    const id = toSlug(children);
    return (
      <Tag id={id} {...rest}>
        {children}
      </Tag>
    );
  }
  Heading.displayName = `Heading(${Tag})`;
  return Heading;
}

// ---------------------------------------------------------------------------
// Links
// Every <a> (markdown or raw HTML) is classified when rendered: anchors scroll
// within the document, workspace links open that document, external links
// get an icon and open in the browser, unresolvable ones are marked.
// ---------------------------------------------------------------------------

interface LinkHandlers {
  resolve: (href: string) => LinkTarget | null;
  resolveImage: (src: string) => ImageSource | null;
  onAnchor: (anchor: string) => void;
  onOpenDocument: (id: string, anchor: string | null) => void;
}

const LinkContext = createContext<LinkHandlers | null>(null);

/** Let the browser handle modified clicks (new tab / window / download). */
function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps): React.ReactElement {
  const handlers = useContext(LinkContext);
  const target = href !== undefined && handlers ? handlers.resolve(href) : null;
  // A document's app URL, as the router writes it ("#/doc/…" in the live demo)
  const documentHref = useHref(
    target?.kind === "document"
      ? `/doc/${encodeURIComponent(target.id)}${target.anchor ? `#${target.anchor}` : ""}`
      : "/",
  );

  if (target === null || handlers === null) {
    return <a href={href} {...rest}>{children}</a>;
  }

  switch (target.kind) {
    case "external":
      return (
        <a
          {...rest}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          title={rest.title ?? target.href}
        >
          {children}
          <ExternalLinkIcon />
        </a>
      );

    case "anchor":
      return (
        <a
          {...rest}
          href={`#${target.anchor}`}
          onClick={(e) => {
            e.preventDefault();
            handlers.onAnchor(target.anchor);
          }}
        >
          {children}
        </a>
      );

    case "document":
      return (
        <a
          {...rest}
          // A real app URL, so modified clicks and "copy link" still work
          href={documentHref}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            handlers.onOpenDocument(target.id, target.anchor);
          }}
        >
          {children}
        </a>
      );

    case "file": {
      const name = target.location.slice(target.location.lastIndexOf("/") + 1);
      if (!target.openable) {
        return (
          <a
            {...rest}
            className={styles.missingLink}
            title={`Folio doesn't open ${name.slice(name.lastIndexOf("."))} files from documents: ${target.location}`}
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
          >
            {children}
          </a>
        );
      }
      // Desktop: the main process opens it in its default app (safe types
      // only). Browser: the backend serves it, in a new tab.
      if (desktopApi) {
        return (
          <a
            {...rest}
            href={`#${encodeURIComponent(target.location)}`}
            title={rest.title ?? `Open ${name}`}
            onClick={(e) => {
              e.preventDefault();
              void desktopApi.openLinkedFile(target.location);
            }}
          >
            {children}
            <ExternalLinkIcon label="(opens in another app)" />
          </a>
        );
      }
      return (
        <a {...rest} href={workspaceFileUrl(target.location)} target="_blank" rel="noopener noreferrer" title={rest.title ?? `Open ${name}`}>
          {children}
          <ExternalLinkIcon label="(opens in a new tab)" />
        </a>
      );
    }

    case "missing":
      return (
        <a
          {...rest}
          className={styles.missingLink}
          title={`Not found in workspace: ${target.location}`}
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
        >
          {children}
        </a>
      );
  }
}

function ExternalLinkIcon({ label = "(opens in browser)" }: { label?: string }): React.ReactElement {
  return (
    <svg
      className={styles.externalIcon}
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={label}
      role="img"
    >
      <path d="M12 9v4.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
      <path d="M10 1.5h4.5V6" />
      <path d="M14.5 1.5L7 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Images
// Relative paths resolve against the document's folder, like links, and are
// loaded from the workspace. Images that can't be shown leave a labelled
// placeholder instead of a broken-image icon.
// ---------------------------------------------------------------------------

function MarkdownImage({
  src,
  alt,
  node: _node,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps): React.ReactElement {
  const handlers = useContext(LinkContext);
  const source = src !== undefined && handlers ? handlers.resolveImage(src) : null;
  const url = source === null ? null : source.kind === "url" ? source.src : workspaceFileUrl(source.location);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url === null || failedUrl === url) {
    const where = source?.kind === "workspace" ? source.location : src;
    return (
      <span className={styles.missingImage} role="img" aria-label={alt || "Image"} title={`Image not found: ${where ?? ""}`}>
        {alt || "Image"} (not found)
      </span>
    );
  }
  return <img {...rest} src={url} alt={alt ?? ""} loading="lazy" onError={() => setFailedUrl(url)} />;
}

// Build the components map once — stable reference, no re-creation on render.
// ---------------------------------------------------------------------------
// Code blocks
// ```mermaid blocks become diagrams; every other block renders as usual.
// ---------------------------------------------------------------------------

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(hastText).join("");
}

function MarkdownPre({ node, children, ...rest }: React.HTMLAttributes<HTMLPreElement> & ExtraProps): React.ReactElement {
  const code = (node as HastNode | undefined)?.children?.find((child) => child.type === "element");
  const classes = code?.tagName === "code" ? [code.properties?.className].flat() : [];
  if (code !== undefined && classes.includes("language-mermaid")) {
    return <MermaidDiagram code={hastText(code)} />;
  }
  return <CodeBlock {...rest}>{children}</CodeBlock>;
}

/** A code block with a copy button, shown on hover or keyboard focus. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>): React.ReactElement {
  const preRef = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 1500);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = () => {
    const text = preRef.current?.querySelector("code")?.textContent ?? preRef.current?.textContent ?? "";
    navigator.clipboard.writeText(text).then(
      () => setStatus("copied"),
      () => setStatus("failed"),
    );
  };

  const label = status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy" : "Copy code";
  return (
    <div className={styles.codeBlock}>
      <pre ref={preRef} {...rest}>
        {children}
      </pre>
      <button
        type="button"
        className={`${styles.copyBtn} ${status !== "idle" ? styles.copyBtnShown : ""}`}
        onClick={copy}
        aria-label={label}
        title={label}
      >
        {status === "copied" ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 8.5l3.5 3.5L13 4.5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" />
          </svg>
        )}
        <span className={styles.srOnlyLive} aria-live="polite">
          {status === "idle" ? "" : label}
        </span>
      </button>
    </div>
  );
}

const markdownComponents: Components = {
  a: MarkdownLink,
  pre: MarkdownPre,
  img: MarkdownImage,
  h1: makeHeading("h1"),
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
  h5: makeHeading("h5"),
  h6: makeHeading("h6"),
};

// ---------------------------------------------------------------------------
// rehype-highlight options
// ---------------------------------------------------------------------------

const rehypeHighlightOptions: RehypeHighlightOptions = {
  languages: {
    json: langJson,
    python: langPython,
    javascript: langJavascript,
    typescript: langTypescript,
    go: langGo,
    c: langC,
    cpp: langCpp,
    xml: langXml,
    html: langXml,
  },
  detect: false,
};

// ---------------------------------------------------------------------------
// HTML sanitizing
// Documents may embed raw HTML (rehype-raw), and documents aren't trusted:
// a workspace can hold cloned repos or vendored packages. Everything is
// filtered through GitHub's allow-list (hast-util-sanitize defaultSchema),
// which drops <script>, <style>, <iframe>, <form>, <meta>, <base>, <object>,
// <embed>, <svg>, event handlers, style attributes and unsafe URL schemes.
//
// It also prefixes id/name values with "user-content-" so a document can't
// clobber page globals (e.g. id="markdownApi"); findAnchorTarget() looks
// for the prefixed id too. KaTeX and highlighting run after sanitizing so
// their generated markup (KaTeX's inline styles, hljs-* class names)
// survives; both only produce markup from the math / code text itself.
// KaTeX is loaded on demand (katexLoader.ts), so it's left out until then.
// ---------------------------------------------------------------------------

const CLOBBER_PREFIX = defaultSchema.clobberPrefix ?? "user-content-";

type RehypePluginList = NonNullable<MarkdownOptions["rehypePlugins"]>;

function buildRehypePlugins(katex: RehypeKatex | null): RehypePluginList {
  return [
    rehypeRaw,
    [rehypeSanitize, defaultSchema],
    ...(katex === null ? [] : [katex]),
    [rehypeHighlight, rehypeHighlightOptions],
  ];
}

const rehypePluginsWithoutKatex = buildRehypePlugins(null);

// $…$ / $$…$$ / ```math math (KaTeX), with GitHub's rules for single dollars
// (Plus Obsidian's [[wiki links]], added per document; see remarkPlugins below.)
// Front matter (YAML / TOML at the top of a file) is parsed so it can be dropped.
type PluginList = NonNullable<MarkdownOptions["remarkPlugins"]>;
const baseRemarkPlugins: PluginList = [remarkGfm, [remarkFrontmatter, ["yaml", "toml"]], remarkMath, remarkMathDollars];

const NO_ATTACHMENTS: string[] = [];
const NO_HIGHLIGHTS: readonly Highlight[] = [];
const NO_BOOKMARKS: readonly Bookmark[] = [];

const remarkRehypeOptions = {
  // Footnote ids are prefixed by the sanitizer instead, so they aren't doubled
  clobberPrefix: "",
  // Front matter is metadata, not content: render nothing for it
  handlers: { yaml: () => undefined, toml: () => undefined },
};

/**
 * The element an in-document anchor points at: by id, then by legacy
 * <a name="…">, each with and without the clobber prefix.
 */
function findAnchorTarget(anchorId: string): HTMLElement | null {
  for (const candidate of [anchorId, CLOBBER_PREFIX + anchorId]) {
    const target = document.getElementById(candidate) ?? document.getElementsByName(candidate)[0];
    if (target) return target;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MarkdownViewer({
  content,
  contentId = null,
  loading: documentLoading,
  error,
  selectedId,
  anchor,
  navigationKey,
  restoreScrollTop = null,
  onAnchorClick,
  documents = [],
  attachments = NO_ATTACHMENTS,
  currentLocation = null,
  onOpenDocument,
  searchQuery = "",
  searchFocus = null,
  showOutline = false,
  highlights = NO_HIGHLIGHTS,
  bookmarks = NO_BOOKMARKS,
  markFocus = null,
  markHandlers,
  onLocatedChange,
}: MarkdownViewerProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  // -------------------------------------------------------------------------
  // KaTeX, loaded the first time a document may contain math
  // -------------------------------------------------------------------------
  // Until it arrives the document counts as still loading, so scrolling to
  // anchors, restoring scroll and find all run on the finished layout.
  // If it can't load, the document is shown with its math as plain text.
  const [katex, setKatex] = useState<RehypeKatex | "failed" | null>(loadedRehypeKatex);
  const needsKatex = content !== null && katex === null && mayContainMath(content);
  useEffect(() => {
    if (!needsKatex) return;
    let cancelled = false;
    loadRehypeKatex().then(
      // A function passed to a state setter is called as an updater: wrap it
      (plugin) => {
        if (!cancelled) setKatex(() => plugin);
      },
      (loadError: unknown) => {
        console.error("Couldn't load KaTeX", loadError);
        if (!cancelled) setKatex("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsKatex]);
  const loading = documentLoading || needsKatex;
  const rehypePlugins = useMemo(
    () => (katex === null || katex === "failed" ? rehypePluginsWithoutKatex : buildRehypePlugins(katex)),
    [katex],
  );

  // -------------------------------------------------------------------------
  // Scroll restoration (Back/Forward)
  //
  // A position saved on this history entry takes precedence over Effects 1
  // and 2 (anchor / top): they skip while it is pending, and the restore
  // effect below applies it once this entry's document is rendered.
  //
  // Must stay declared before Effects 1 and 2 so they see the pending value.
  // -------------------------------------------------------------------------
  const pendingRestoreRef = useRef<number | null>(null);

  useEffect(() => {
    pendingRestoreRef.current = restoreScrollTop;
    // Only a new history entry brings a new position to restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationKey]);

  // -------------------------------------------------------------------------
  // Effect 1 — document switch
  //
  // When selectedId changes the user navigated to a different document.
  //   • If the new URL already carries an anchor (e.g. user pressed Forward
  //     into a deep-linked URL), wait until content is rendered then scroll to
  //     that element.
  //   • If there is no anchor, simply reset the scroll container to the top.
  //
  // Dependency: [selectedId] — intentionally excludes `anchor` so that
  // clicking TOC links within the same document does NOT re-trigger this
  // effect and jump back to top.
  // -------------------------------------------------------------------------
  const prevSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Ignore the very first render pass where selectedId hasn't changed yet.
    if (prevSelectedIdRef.current === selectedId) return;
    prevSelectedIdRef.current = selectedId;
    if (pendingRestoreRef.current !== null) return;

    if (!anchor) {
      // No anchor → scroll container back to top immediately.
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      return;
    }

    // Anchor present → content may not be in the DOM yet (still loading).
    // Poll briefly until the element appears, then scroll to it.
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 × 50 ms = 1 s max wait
    const intervalId = setInterval(() => {
      const target = findAnchorTarget(anchor);
      if (target) {
        clearInterval(intervalId);
        target.scrollIntoView({ behavior: "instant", block: "start" });
      } else if (++attempts >= MAX_ATTEMPTS) {
        clearInterval(intervalId);
      }
    }, 50);

    return () => clearInterval(intervalId);
    // anchor is intentionally excluded — this effect tracks document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // -------------------------------------------------------------------------
  // Effect 2 — anchor change within the same document
  //
  // Fires whenever `anchor` changes while the same document is displayed
  // (i.e. the user clicked a TOC link, or pressed Back from an anchored URL
  // to the bare document URL).
  //
  // • anchor is truthy  → content is already rendered; scroll to the element.
  // • anchor is falsy   → the hash was removed (e.g. Back from /doc/x#section
  //                        to /doc/x).  Reset the scroll container to the top
  //                        so the viewport is not left stranded mid-document.
  //
  // Guard: skip when content isn't ready (loading or null) to avoid no-ops.
  //
  // A live reload changes `content` but neither the document nor the anchor:
  // keep the reader's scroll position instead of jumping to the anchor or top.
  // -------------------------------------------------------------------------
  const scrolledForRef = useRef<{ contentId: string | null; anchor: string | null } | null>(null);

  useEffect(() => {
    if (loading || content === null) return;
    const scrolledFor = scrolledForRef.current;
    const currentAnchor = anchor ?? null;
    if (scrolledFor !== null && scrolledFor.contentId === contentId && scrolledFor.anchor === currentAnchor) return;
    scrolledForRef.current = { contentId, anchor: currentAnchor };
    if (pendingRestoreRef.current !== null) return;

    if (!anchor) {
      // No anchor in the current route — scroll the viewer back to the top.
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      return;
    }

    const target = findAnchorTarget(anchor);
    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }, [anchor, loading, content, contentId]);

  // -------------------------------------------------------------------------
  // Effect 3 — apply a pending scroll restoration
  //
  // Waits for this entry's document: right after a document switch the old
  // content is still shown (not yet loading), hence the contentId check.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const top = pendingRestoreRef.current;
    if (top === null || loading || content === null || contentId !== selectedId) return;
    pendingRestoreRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = top;
  }, [navigationKey, loading, content, contentId, selectedId]);

  // -------------------------------------------------------------------------
  // Effect 4 — search highlights
  //
  // Highlights every match of the sidebar's search in the shown document,
  // re-done on each render of new content (live reload included). A search
  // result that was opened (searchFocus) is scrolled to once, and marked as
  // the current match; declared after Effects 1–3 so it wins over their
  // scroll-to-top on the same render. Hidden while the find bar is in use.
  // -------------------------------------------------------------------------
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findActive = findOpen && findQuery !== "";

  const focusedNonceRef = useRef<number | null>(null);
  const currentMatchRef = useRef<number | null>(null);

  // Another document (or none) is shown: its current match no longer applies.
  // Must run before the effect below, which may set a new one.
  useEffect(() => {
    currentMatchRef.current = null;
  }, [contentId]);

  useEffect(() => {
    const article = articleRef.current;
    if (loading || content === null || article === null || searchQuery === "") {
      clearMatches("search");
      currentMatchRef.current = null;
      return;
    }
    if (findActive) {
      clearMatches("search");
      return;
    }
    const ranges = findMatches(article, searchQuery);

    const wantsFocus =
      searchFocus !== null && searchFocus.docId === contentId && searchFocus.nonce !== focusedNonceRef.current;
    if (wantsFocus) {
      focusedNonceRef.current = searchFocus.nonce;
      // Counted in the markdown source, where e.g. link URLs also match; the
      // rendered text can have fewer, so fall back to the last one
      currentMatchRef.current = ranges.length === 0 ? null : Math.min(searchFocus.occurrence, ranges.length - 1);
    } else if (currentMatchRef.current !== null && currentMatchRef.current >= ranges.length) {
      currentMatchRef.current = null;
    }

    const current = currentMatchRef.current === null ? null : (ranges[currentMatchRef.current] ?? null);
    showMatches("search", ranges, current);

    const scroller = scrollRef.current;
    if (wantsFocus && current !== null && scroller !== null) {
      // Bring the match to the upper third of the viewer
      const offset = current.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += offset - scroller.clientHeight / 3;
    }
  }, [content, contentId, loading, searchQuery, searchFocus, findActive]);

  // -------------------------------------------------------------------------
  // Effect 5 — find in document (⌘F / Ctrl+F)
  //
  // Typing jumps to the first match from the top of the view. A live reload
  // keeps the current match (by index); another document starts with none
  // selected until Next / Previous.
  // -------------------------------------------------------------------------
  const findInputRef = useRef<HTMLInputElement>(null);
  const findRangesRef = useRef<Range[]>([]);
  const findIndexRef = useRef(-1);
  const findQueryRef = useRef<string | null>(null);
  const findDocRef = useRef<string | null>(null);
  const [findIndex, setFindIndex] = useState(-1);
  const [findTotal, setFindTotal] = useState(0);

  /** Scroll `range` into the upper third of the viewer, unless it's already comfortably visible. */
  const revealRange = useCallback((range: Range) => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const viewTop = scroller.getBoundingClientRect().top;
    const offset = range.getBoundingClientRect().top - viewTop;
    // The find bar covers the top of the view
    if (offset < 48 || offset > scroller.clientHeight - 48) scroller.scrollTop += offset - scroller.clientHeight / 3;
  }, []);

  /** Make match `index` (or none, -1) the current one. */
  const selectFindMatch = useCallback(
    (index: number, reveal: boolean) => {
      const ranges = findRangesRef.current;
      findIndexRef.current = index;
      setFindIndex(index);
      const current = ranges[index] ?? null;
      showMatches("find", ranges, current);
      if (reveal && current !== null) revealRange(current);
    },
    [revealRange],
  );

  /** The first match at or below the top of the view (wrapping to the first overall). */
  const firstVisibleMatch = useCallback((): number => {
    const scroller = scrollRef.current;
    const ranges = findRangesRef.current;
    if (scroller === null || ranges.length === 0) return -1;
    const viewTop = scroller.getBoundingClientRect().top;
    const index = ranges.findIndex((r) => r.getBoundingClientRect().top >= viewTop);
    return index === -1 ? 0 : index;
  }, []);

  useEffect(() => {
    const article = articleRef.current;
    if (!findOpen || findQuery === "" || loading || content === null || article === null) {
      findRangesRef.current = [];
      findQueryRef.current = findOpen ? findQuery : null;
      clearMatches("find");
      setFindTotal(0);
      findIndexRef.current = -1;
      setFindIndex(-1);
      return;
    }
    const ranges = findMatches(article, findQuery);
    findRangesRef.current = ranges;
    setFindTotal(ranges.length);

    const queryChanged = findQueryRef.current !== findQuery;
    const docChanged = findDocRef.current !== contentId;
    findQueryRef.current = findQuery;
    findDocRef.current = contentId;

    if (queryChanged) selectFindMatch(firstVisibleMatch(), true);
    else if (docChanged) selectFindMatch(-1, false);
    else selectFindMatch(Math.min(findIndexRef.current, ranges.length - 1), false);
  }, [findOpen, findQuery, content, contentId, loading, selectFindMatch, firstVisibleMatch]);

  const findNext = useCallback(() => {
    const total = findRangesRef.current.length;
    if (total === 0) return;
    const index = findIndexRef.current;
    selectFindMatch(index < 0 ? firstVisibleMatch() : (index + 1) % total, true);
  }, [selectFindMatch, firstVisibleMatch]);

  const findPrevious = useCallback(() => {
    const total = findRangesRef.current.length;
    if (total === 0) return;
    const index = findIndexRef.current;
    const from = index < 0 ? firstVisibleMatch() : index;
    selectFindMatch((from - 1 + total) % total, true);
  }, [selectFindMatch, firstVisibleMatch]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  // ⌘F / Ctrl+F opens the find bar (or re-selects its text); ⌘G / F3 step
  // through matches, with Shift going back. The desktop Edit menu shows
  // these and sends the same commands when its items are clicked.
  useEffect(() => {
    const openFind = () => {
      setFindOpen(true);
      findInputRef.current?.focus();
      findInputRef.current?.select();
    };
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && key === "f") {
        e.preventDefault();
        openFind();
      } else if (findOpen && ((mod && !e.altKey && key === "g") || e.key === "F3")) {
        e.preventDefault();
        if (e.shiftKey) findPrevious();
        else findNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = desktopApi?.onFindCommand((command) => {
      if (command === "open") openFind();
      // Next / Previous with no find bar open start a search, as in browsers
      else if (command === "next" || command === "previous") {
        if (!findOpen) openFind();
        else if (command === "next") findNext();
        else findPrevious();
      }
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [findOpen, findNext, findPrevious]);

  // Focus the input when the bar appears
  useEffect(() => {
    if (findOpen) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }
  }, [findOpen]);

  useEffect(
    () => () => {
      clearMatches("search");
      clearMatches("find");
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Effect 6 — outline
  //
  // Headings are read from the rendered document, so ids, duplicates and
  // inline formatting match what's on screen. The active heading is the last
  // one at or above a line near the top of the view (or the last heading
  // once scrolled to the bottom, where short final sections can't reach it).
  // -------------------------------------------------------------------------
  const [outlineHeadings, setOutlineHeadings] = useState<OutlineHeading[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const headingElementsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const article = articleRef.current;
    const elements =
      loading || content === null || article === null
        ? []
        : [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].filter((el) => el.id !== "");
    headingElementsRef.current = elements;
    const next = elements.map((el) => ({
      id: el.id,
      text: el.textContent?.trim() ?? "",
      level: Number(el.tagName.slice(1)),
    }));
    // Keep the same array when nothing changed (live reload of body text)
    setOutlineHeadings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [content, contentId, loading]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!showOutline || scroller === null) return;
    let frame = 0;

    function update() {
      frame = 0;
      if (scroller === null) return;
      const elements = headingElementsRef.current;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      // A heading counts as reached once it's within the top 80px of the view
      const line = scroller.getBoundingClientRect().top + 80;
      let active: HTMLElement | undefined = atBottom ? elements[elements.length - 1] : undefined;
      if (active === undefined) {
        for (const el of elements) {
          if (el.getBoundingClientRect().top <= line) active = el;
          else break;
        }
      }
      setActiveHeadingId(active?.id ?? elements[0]?.id ?? null);
    }
    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(update);
    }

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // The document's height also changes without scrolling: images loading,
    // Mermaid diagrams replacing their placeholders, the window resizing
    const resizes = new ResizeObserver(onScroll);
    if (articleRef.current !== null) resizes.observe(articleRef.current);
    resizes.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      resizes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [showOutline, outlineHeadings]);

  // -------------------------------------------------------------------------
  // Link handlers shared with MarkdownLink via context
  // -------------------------------------------------------------------------
  // Obsidian [[links]] resolve against this workspace and document
  const remarkPlugins = useMemo(
    (): PluginList => [
      ...baseRemarkPlugins,
      [remarkObsidian, { documents: documents.map((doc) => doc.location), attachments, currentLocation }],
    ],
    [documents, attachments, currentLocation],
  );

  const idsByLocation = useMemo(
    () => new Map(documents.map((doc) => [doc.location, doc.id])),
    [documents],
  );

  // findAnchorTarget uses document.getElementById rather than
  // querySelector("#…"): CSS id selectors reject ids that start with a digit
  // unless escaped, so getElementById is safe for slugs like "3-core-concepts".
  const scrollToAnchor = useCallback((anchorId: string) => {
    findAnchorTarget(anchorId)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  // Following a link in the document remembers where the reader was, so
  // Back returns there (Effect 3). Sidebar selections don't record it.
  const saveScroll = useCallback(() => {
    if (scrollRef.current) saveScrollPosition(scrollRef.current.scrollTop);
  }, []);

  const linkHandlers = useMemo<LinkHandlers>(
    () => ({
      resolve: (href) => resolveLink(href, currentLocation, idsByLocation),
      resolveImage: (src) => resolveImageSrc(src, currentLocation),
      onAnchor: (anchorId) => {
        saveScroll();
        // Scroll now — re-clicking the anchor already in the URL changes
        // nothing that Effect 2 would react to — then record it in history.
        scrollToAnchor(anchorId);
        onAnchorClick?.(anchorId);
      },
      onOpenDocument: (id, anchorId) => {
        saveScroll();
        onOpenDocument?.(id, anchorId);
      },
    }),
    [currentLocation, idsByLocation, saveScroll, scrollToAnchor, onAnchorClick, onOpenDocument],
  );

  // ── Highlights found in the text (MarksLayer), for the outline and the
  // Marks view ───────────────────────────────────────────────────────────────
  const ready = !loading && error === null && content !== null;
  // Which outline entries are bookmarked (identified as MarksLayer does)
  const outlineBookmarked = useMemo(
    () =>
      headingIdentities(outlineHeadings.map((h) => ({ level: h.level, text: h.text.replace(/\s+/g, " ") }))).map(
        (heading) => findBookmark(bookmarks, heading) !== undefined,
      ),
    [outlineHeadings, bookmarks],
  );

  // Highlights per outline entry (those after its heading and before the
  // next), counted from the document as just painted
  const [outlineCounts, setOutlineCounts] = useState<number[]>([]);
  const handlePainted = useCallback(
    (located: ReadonlyMap<string, Range>) => {
      const article = articleRef.current;
      // The same headings as the outline lists
      const elements = article === null ? [] : [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].filter((el) => el.id !== "");
      const counts = elements.map(() => 0);
      for (const range of located.values()) {
        let section = -1;
        elements.forEach((el, i) => {
          if (el.contains(range.startContainer) || el.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) {
            section = i;
          }
        });
        if (section >= 0) counts[section] = (counts[section] ?? 0) + 1;
      }
      setOutlineCounts(counts);
      if (ready && contentId !== null) onLocatedChange?.(contentId, new Set(located.keys()));
    },
    [ready, contentId, onLocatedChange],
  );

  return (
    <div className={styles.viewerFrame}>
      <div className={styles.documentColumn}>
        {findOpen && (
          <FindBar
            query={findQuery}
            onQueryChange={setFindQuery}
            current={findIndex}
            total={findTotal}
            onNext={findNext}
            onPrevious={findPrevious}
            onClose={closeFind}
            inputRef={findInputRef}
          />
        )}
        <div className={styles.viewerRoot} ref={scrollRef} tabIndex={-1}>
          {/* ── Loading ── */}
          {loading && (
            <div className={styles.centeredState} aria-live="polite" aria-busy="true">
              <span className={styles.spinnerLarge} aria-hidden="true" />
              <span className={styles.stateLabel}>Loading document…</span>
            </div>
          )}

          {/* ── Error ── */}
          {!loading && error !== null && (
            <div className={styles.centeredState} role="alert">
              <span className={styles.errorIcon} aria-hidden="true">⚠</span>
              <span className={styles.stateLabel}>{error}</span>
            </div>
          )}

          {/* ── Empty / no selection ── */}
          {!loading && error === null && content === null && (
            <div className={styles.centeredState}>
              <svg
                className={styles.emptyIcon}
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="14,2 14,8 20,8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="8" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className={styles.stateLabel}>Select a document to preview</span>
            </div>
          )}

          {/* ── Rendered markdown ── */}
          {!loading && error === null && content !== null && (
            <article className={`${styles.article} folio-document`} aria-label="Rendered markdown" ref={articleRef}>
              <LinkContext.Provider value={linkHandlers}>
                <ReactMarkdown
                  remarkPlugins={remarkPlugins}
                  remarkRehypeOptions={remarkRehypeOptions}
                  rehypePlugins={rehypePlugins}
                  components={markdownComponents}
                >
                  {content}
                </ReactMarkdown>
              </LinkContext.Provider>
            </article>
          )}
          {markHandlers !== undefined && (
            <MarksLayer
              articleRef={articleRef}
              containerRef={scrollRef}
              ready={ready}
              renderKey={content}
              highlights={highlights}
              bookmarks={bookmarks}
              focus={markFocus !== null && markFocus.docId === contentId ? markFocus : null}
              onAdd={markHandlers.add}
              onRecolor={markHandlers.recolor}
              onSetNote={markHandlers.setNote}
              onRemove={markHandlers.remove}
              onToggleBookmark={markHandlers.toggleHeadingBookmark}
              onPainted={handlePainted}
            />
          )}
        </div>
      </div>
      {showOutline && !loading && error === null && content !== null && (
        <Outline
          headings={outlineHeadings}
          activeId={activeHeadingId}
          onSelect={linkHandlers.onAnchor}
          highlightCounts={outlineCounts}
          bookmarked={outlineBookmarked}
        />
      )}
    </div>
  );
}
