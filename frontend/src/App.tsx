import React, { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate, useParams, useLocation } from "react-router-dom";
import { fetchDocumentContent, fetchDocuments } from "./api";
import DocumentList from "./components/DocumentList";
import MarkdownViewer from "./components/MarkdownViewer";
import styles from "./App.module.css";
import type { DocumentMeta } from "./types";

const PANEL_MIN_WIDTH = 160;
const PANEL_DEFAULT_WIDTH = 280;

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; content: string }
  | { status: "error"; message: string };

// ─── Routing shell ────────────────────────────────────────────────────────────
// AppRoutes is the default export consumed by main.tsx.
// It declares both the parameterised route and a catch-all so that the same
// AppInner layout renders under / as well as /doc/:docId.

export default function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/doc/:docId" element={<AppInner />} />
      <Route path="*" element={<AppInner />} />
    </Routes>
  );
}

// ─── Inner app (has access to route params) ───────────────────────────────────

function AppInner(): React.ReactElement {
  // ── URL params → selectedId ────────────────────────────────────────────────
  // useParams is only safe inside a <Route>; AppInner always runs inside one.
  const { docId } = useParams<{ docId?: string }>();
  const navigate = useNavigate();

  // location.hash gives us the current '#...' fragment (including the '#').
  // Stripping it yields the raw anchor id, e.g. "3-core-concepts".
  const location = useLocation();
  const anchor = location.hash.length > 0 ? location.hash.slice(1) : null;

  // Decode the URL segment back to the raw document id.
  // selectedId preserves the existing string | null contract for all children.
  const selectedId: string | null = docId !== undefined ? decodeURIComponent(docId) : null;

  // ── Document list state ────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  // ── Content state ──────────────────────────────────────────────────────────
  const [contentState, setContentState] = useState<LoadState>({ status: "idle" });

  // ── Panel / divider state ──────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch document list on mount ───────────────────────────────────────────
  // When the list loads and no docId is present in the URL, navigate to the
  // first document using replace:true so the browser back-button stays clean.
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    fetchDocuments()
      .then((docs) => {
        if (cancelled) return;
        setDocuments(docs);
        setListError(null);
        // Auto-select first document only when no URL param is present
        const first = docs[0];
        if (first !== undefined && docId === undefined) {
          navigate("/doc/" + encodeURIComponent(first.id), { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : "Failed to load documents");
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // navigate is stable; docId intentionally omitted — we only want this to
    // fire once on mount, not whenever the user navigates between documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch content when selectedId (derived from URL) changes ──────────────
  useEffect(() => {
    if (selectedId === null) {
      setContentState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setContentState({ status: "loading" });
    fetchDocumentContent(selectedId)
      .then((doc) => {
        if (cancelled) return;
        setContentState({ status: "success", content: doc.content });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setContentState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load content",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ── Navigation handler passed to DocumentList ──────────────────────────────
  // Replaces the old setSelectedId callback; pushes a new history entry so
  // the user can navigate back with the browser back-button.
  const handleSelect = useCallback(
    (id: string) => {
      navigate("/doc/" + encodeURIComponent(id));
    },
    [navigate],
  );

  // ── Anchor-click handler passed to MarkdownViewer ─────────────────────────
  // Called when the user clicks an in-document '#...' link (e.g. a TOC entry).
  // We push a full history entry so the browser Back button restores the
  // previous location (document + anchor, or document root if no anchor).
  const handleAnchorClick = useCallback(
    (anchorId: string) => {
      if (selectedId === null) return; // guard: no document selected yet
      navigate("/doc/" + encodeURIComponent(selectedId) + "#" + anchorId);
    },
    [navigate, selectedId],
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [panelWidth],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.max(PANEL_MIN_WIDTH, dragStartWidth.current + delta);
      // Don't exceed 40% of container width
      const maxWidth = containerRef.current
        ? containerRef.current.offsetWidth * 0.4
        : 600;
      setPanelWidth(Math.min(next, maxWidth));
      // If dragged wide while collapsed, expand
      if (delta > 20) setCollapsed(false);
    }

    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  // Print styles (see @media print rules) strip the side panel and other app
  // chrome, leaving only the rendered document.
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const effectivePanelWidth = collapsed ? 0 : panelWidth;

  const contentValue =
    contentState.status === "success" ? contentState.content : null;
  const contentLoading = contentState.status === "loading";
  const contentError =
    contentState.status === "error" ? contentState.message : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.appRoot} ref={containerRef}>
      {/* ── Left panel (document list) ── */}
      <aside
        className={styles.leftPanel}
        style={{ width: effectivePanelWidth }}
        aria-label="Document list"
        aria-hidden={collapsed}
      >
        <DocumentList
          documents={documents}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={listLoading}
          error={listError}
        />
      </aside>

      {/* ── Divider ── */}
      <div
        className={styles.divider}
        onMouseDown={handleDividerMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        aria-valuenow={effectivePanelWidth}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={600}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setPanelWidth((w) => Math.max(PANEL_MIN_WIDTH, w - 20));
            setCollapsed(false);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setPanelWidth((w) => Math.min(w + 20, 600));
            setCollapsed(false);
          }
        }}
      >
        <button
          className={styles.collapseBtn}
          onClick={toggleCollapse}
          aria-label={collapsed ? "Expand document list" : "Collapse document list"}
          title={collapsed ? "Expand document list" : "Collapse document list"}
          type="button"
        >
          <svg
            className={styles.collapseIcon}
            style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)" }}
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
          >
            <polyline
              points="7,2 3,5 7,8"
              strokeWidth="1.8"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* ── Right panel ── */}
      <main className={styles.rightPanel} aria-label="Markdown viewer">
        {contentValue !== null && (
          <button
            className={styles.printBtn}
            onClick={handlePrint}
            aria-label="Print document"
            title="Print document"
            type="button"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6,9 6,2 18,2 18,9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </button>
        )}
        <MarkdownViewer
          content={contentValue}
          loading={contentLoading}
          error={contentError}
          selectedId={selectedId}
          anchor={anchor}
          onAnchorClick={handleAnchorClick}
        />
      </main>
    </div>
  );
}
