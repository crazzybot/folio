import React, { useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from 'rehype-raw';
import type { Options as RehypeHighlightOptions } from "rehype-highlight";
import type { Components } from "react-markdown";

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
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** The current in-document anchor (without the leading '#'), or null/empty. */
  anchor?: string | null;
  /** Called when the user clicks an in-document '#...' link. */
  onAnchorClick?: (anchorId: string) => void;
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
    .replace(/\s+/g, "-");   // spaces → hyphens
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

// Build the components map once — stable reference, no re-creation on render.
const markdownComponents: Components = {
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

const rehypePlugins = [
  [rehypeHighlight, rehypeHighlightOptions] as [typeof rehypeHighlight, RehypeHighlightOptions],
  rehypeRaw,
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MarkdownViewer({
  content,
  loading,
  error,
  selectedId,
  anchor,
  onAnchorClick,
}: MarkdownViewerProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const target = document.getElementById(anchor);
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
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (loading || content === null) return;

    if (!anchor) {
      // No anchor in the current route — scroll the viewer back to the top.
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      return;
    }

    const target = document.getElementById(anchor);
    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }, [anchor, loading, content]);

  // -------------------------------------------------------------------------
  // Intercept in-document anchor clicks and delegate to the parent handler.
  //
  // Why not use <a onClick> on the rendered anchors directly?
  //   react-markdown renders <a> tags via its own pipeline. Attaching a single
  //   delegated handler on the outer div is simpler and avoids touching the
  //   anchor component map.
  //
  // Why document.getElementById instead of querySelector("#…")?
  //   CSS id selectors reject ids that start with a digit unless escaped.
  //   document.getElementById works with any valid HTML id string, so it is
  //   safe for slugs like "3-core-concepts".
  // -------------------------------------------------------------------------
  const handleViewerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Walk up from the click target until we find an <a> or reach the div.
      let el: Element | null = e.target as Element;
      const container = scrollRef.current;
      if (!container) return;

      while (el && el !== container) {
        if (el.tagName === "A") {
          const href = el.getAttribute("href");
          if (href && href.startsWith("#")) {
            e.preventDefault();
            const anchorId = href.slice(1); // strip the leading '#'
            if (onAnchorClick) {
              // Delegate to parent — it will update the URL (pushing a history
              // entry) which feeds back via the `anchor` prop, triggering
              // Effect 2 to scroll.
              onAnchorClick(anchorId);
            } else {
              // Fallback when used without the parent handler (e.g. tests).
              const target = document.getElementById(anchorId);
              if (target) {
                target.scrollIntoView({ behavior: "auto", block: "start" });
              }
            }
          }
          // Whether or not it was an internal anchor, stop walking.
          return;
        }
        el = el.parentElement;
      }
    },
    [onAnchorClick],
  );

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={styles.viewerRoot}
      ref={scrollRef}
      onClick={handleViewerClick}
    >
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={rehypePlugins}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
}
