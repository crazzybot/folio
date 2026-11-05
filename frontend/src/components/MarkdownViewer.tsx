import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeHighlightOptions } from "rehype-highlight";
import type { Components, ExtraProps } from "react-markdown";
import { resolveLink } from "../links";
import type { LinkTarget } from "../links";
import { saveScrollPosition } from "../scrollHistory";
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

import "highlight.js/styles/github-dark.css";
import styles from "./MarkdownViewer.module.css";

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
  /** Workspace-relative path of the displayed document (base for relative links). */
  currentLocation?: string | null;
  /** Called when the user clicks a link to another workspace document. */
  onOpenDocument?: (id: string, anchor: string | null) => void;
}

// ---------------------------------------------------------------------------
// GFM slug generation
// Matches GitHub's anchor algorithm:
//   1. Lowercase
//   2. Strip anything that is not alphanumeric, space, hyphen, or underscore
//   3. Replace spaces with hyphens
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
  return extractText(children)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // strip chars outside word chars, whitespace, hyphen
    .trim()
    .replace(/\s/g, "-");    // spaces → hyphens (one-to-one, preserves double-dash for stripped chars like &)
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
    ...rest
  }: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
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
          href={`/doc/${encodeURIComponent(target.id)}${target.anchor ? `#${target.anchor}` : ""}`}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            handlers.onOpenDocument(target.id, target.anchor);
          }}
        >
          {children}
        </a>
      );

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

function ExternalLinkIcon(): React.ReactElement {
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
      aria-label="(opens in browser)"
      role="img"
    >
      <path d="M12 9v4.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7" />
      <path d="M10 1.5h4.5V6" />
      <path d="M14.5 1.5L7 9" />
    </svg>
  );
}

// Build the components map once — stable reference, no re-creation on render.
const markdownComponents: Components = {
  a: MarkdownLink,
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
// for the prefixed id too. Highlighting runs after sanitizing so its
// hljs-* class names survive.
// ---------------------------------------------------------------------------

const CLOBBER_PREFIX = defaultSchema.clobberPrefix ?? "user-content-";

const rehypePlugins = [
  rehypeRaw,
  [rehypeSanitize, defaultSchema] as [typeof rehypeSanitize, typeof defaultSchema],
  [rehypeHighlight, rehypeHighlightOptions] as [typeof rehypeHighlight, RehypeHighlightOptions],
];

// Footnote ids are prefixed by the sanitizer instead, so they aren't doubled
const remarkRehypeOptions = { clobberPrefix: "" };

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
  loading,
  error,
  selectedId,
  anchor,
  navigationKey,
  restoreScrollTop = null,
  onAnchorClick,
  documents = [],
  currentLocation = null,
  onOpenDocument,
}: MarkdownViewerProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

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
  // Link handlers shared with MarkdownLink via context
  // -------------------------------------------------------------------------
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

  return (
    <div className={styles.viewerRoot} ref={scrollRef}>
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
        <article className={styles.article} aria-label="Rendered markdown">
          <LinkContext.Provider value={linkHandlers}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              remarkRehypeOptions={remarkRehypeOptions}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>
          </LinkContext.Provider>
        </article>
      )}
    </div>
  );
}
