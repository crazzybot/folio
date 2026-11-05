import React, { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate, useNavigationType, useParams, useLocation } from "react-router-dom";
import { fetchDocumentContent, fetchDocuments } from "./api";
import { savedScrollPosition } from "./scrollHistory";
import DocumentList from "./components/DocumentList";
import MarkdownViewer from "./components/MarkdownViewer";
import type { SearchFocus } from "./components/MarkdownViewer";
import Breadcrumb from "./components/Breadcrumb";
import useDesktopHistory from "./useDesktopHistory";
import useFileDrop from "./useFileDrop";
import { useFontSize, useReadingWidth } from "./readerPrefs";
import useTheme from "./theme";
import DisplayMenu from "./components/DisplayMenu";
import styles from "./App.module.css";
import type { DocumentMeta } from "./types";

const PANEL_MIN_WIDTH = 160;
const PANEL_DEFAULT_WIDTH = 260;

// The macOS desktop app hides the title bar and insets the window buttons
// into the app's own header rows.
const IS_MAC_DESKTOP = window.markdownApi?.platform === "darwin";
const BACK_SHORTCUT = IS_MAC_DESKTOP ? "⌘[" : "Alt+←";
const FORWARD_SHORTCUT = IS_MAC_DESKTOP ? "⌘]" : "Alt+→";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; id: string; content: string }
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

  // Back/Forward (and reload) are POP navigations: return to the scroll
  // position saved when a link in that document was followed, if any.
  const navigationType = useNavigationType();
  const restoreScrollTop = navigationType === "POP" ? savedScrollPosition() : null;

  // Decode the URL segment back to the raw document id.
  // selectedId preserves the existing string | null contract for all children.
  const selectedId: string | null = docId !== undefined ? decodeURIComponent(docId) : null;

  // ── Document list state ────────────────────────────────────────────────────
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  // ── Content state ──────────────────────────────────────────────────────────
  const [contentState, setContentState] = useState<LoadState>({ status: "idle" });

  // ── Search (sidebar) → highlights and scrolling in the viewer ─────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<SearchFocus | null>(null);

  // ── Back / forward (desktop app only; null in the browser) ─────────────────
  const history = useDesktopHistory();

  // ── Opening from the system (desktop app only) ─────────────────────────────
  // A file of this workspace opened from Finder, the command line or a drop
  // is shown like any other navigation, so Back returns to where you were.
  const dragging = useFileDrop();

  // The main process dispatches it with a user gesture (see openPath in
  // desktop/src/main.ts), so the new history entry isn't skipped by Back.
  useEffect(() => {
    function onOpenDocument(e: Event) {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id === "string") navigate("/doc/" + encodeURIComponent(id));
    }
    window.addEventListener("folio:open-document", onOpenDocument);
    return () => window.removeEventListener("folio:open-document", onOpenDocument);
  }, [navigate]);

  // ── Display options (header menu) ─────────────────────────────────────────
  const [theme, setTheme] = useTheme();
  const [readingWidth, setReadingWidth] = useReadingWidth();
  const [fontSize, setFontSize] = useFontSize();

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
        setContentState({ status: "success", id: selectedId, content: doc.content });
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

  // ── Live reload (desktop app only) ───────────────────────────────────────
  // When markdown files in the workspace change, refresh the list and the
  // open document in place: no loading state, so the scroll position stays.
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    // Only the latest refresh may update state; older ones finish late
    let generation = 0;
    const unsubscribe = api.onWorkspaceChange(() => {
      const current = ++generation;
      const id = selectedIdRef.current;

      fetchDocuments()
        .then((docs) => {
          if (current !== generation) return;
          setDocuments(docs);
          setListError(null);
          // The workspace was empty until now: open its first document
          const first = docs[0];
          if (first !== undefined && selectedIdRef.current === null) {
            navigate("/doc/" + encodeURIComponent(first.id), { replace: true });
          }
        })
        .catch(() => {
          // Keep showing the last list; the next change retries
        });

      if (id === null) return;
      fetchDocumentContent(id)
        .then((doc) => {
          if (current !== generation || selectedIdRef.current !== id) return;
          setContentState((prev) =>
            prev.status === "success" && prev.id === id && prev.content === doc.content
              ? prev
              : { status: "success", id, content: doc.content },
          );
        })
        .catch(() => {
          if (current !== generation || selectedIdRef.current !== id) return;
          setContentState({ status: "error", message: "This document was moved or deleted." });
        });
    });
    return () => {
      generation++;
      unsubscribe();
    };
  }, [navigate]);

  // ── Navigation handler passed to DocumentList ──────────────────────────────
  // Replaces the old setSelectedId callback; pushes a new history entry so
  // the user can navigate back with the browser back-button.
  // A search result also asks the viewer to scroll to its match; for the
  // document already shown, that's all it does (no duplicate history entry).
  const handleSelect = useCallback(
    (id: string, occurrence?: number) => {
      if (occurrence !== undefined) setSearchFocus({ docId: id, occurrence, nonce: Date.now() });
      if (id !== selectedId || occurrence === undefined) navigate("/doc/" + encodeURIComponent(id));
    },
    [navigate, selectedId],
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

  // ── Cross-document link handler passed to MarkdownViewer ────────────────
  // A link to another workspace document opens it (optionally at an anchor),
  // pushing a history entry like any other document switch.
  const handleOpenDocument = useCallback(
    (id: string, anchorId: string | null) => {
      navigate("/doc/" + encodeURIComponent(id) + (anchorId ? "#" + anchorId : ""));
    },
    [navigate],
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

  // ⌘B / Ctrl+B toggles the sidebar, as in VS Code
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapse();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapse]);

  // Print styles (see @media print rules) strip the side panel and other app
  // chrome, leaving only the rendered document.
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const effectivePanelWidth = collapsed ? 0 : panelWidth;

  const contentValue =
    contentState.status === "success" ? contentState.content : null;
  const contentId = contentState.status === "success" ? contentState.id : null;
  const contentLoading = contentState.status === "loading";
  const contentError =
    contentState.status === "error" ? contentState.message : null;

  const selectedDoc = documents.find((doc) => doc.id === selectedId) ?? null;
  const toggleLabel = collapsed ? "Show document list (⌘B)" : "Hide document list (⌘B)";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={styles.appRoot}
      ref={containerRef}
      data-titlebar={IS_MAC_DESKTOP ? "inset" : undefined}
      style={{ "--reading-width": readingWidth.value, "--reading-font-size": fontSize.value } as React.CSSProperties}
    >
      <div className={styles.workbench}>
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
            onOpenSection={handleOpenDocument}
            onSearchQueryChange={setSearchQuery}
            loading={listLoading}
            error={listError}
          />
        </aside>

        {/* ── Divider ── */}
        <div
          className={styles.divider}
          onMouseDown={handleDividerMouseDown}
          onDoubleClick={toggleCollapse}
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
        />

        {/* ── Right panel ── */}
        <main className={styles.rightPanel} aria-label="Markdown viewer">
          <header
            className={`${styles.editorHeader} ${collapsed ? styles.editorHeaderInset : ""}`}
          >
            <button
              className={styles.iconBtn}
              onClick={toggleCollapse}
              aria-label={toggleLabel}
              aria-pressed={!collapsed}
              title={toggleLabel}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
                <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" />
                {!collapsed && <rect x="2" y="3" width="4" height="10" fill="currentColor" opacity="0.35" />}
              </svg>
            </button>

            {history !== null && (
              <>
                <button
                  className={styles.iconBtn}
                  onClick={() => navigate(-1)}
                  disabled={!history.canGoBack}
                  aria-label={`Go back (${BACK_SHORTCUT})`}
                  title={`Go back (${BACK_SHORTCUT})`}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13 8H3.5M7.5 3.5L3 8l4.5 4.5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={() => navigate(1)}
                  disabled={!history.canGoForward}
                  aria-label={`Go forward (${FORWARD_SHORTCUT})`}
                  title={`Go forward (${FORWARD_SHORTCUT})`}
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8h9.5M8.5 3.5L13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
              </>
            )}

            <Breadcrumb location={selectedDoc?.location ?? null} />

            <DisplayMenu
              theme={theme}
              onThemeChange={setTheme}
              readingWidth={readingWidth.id}
              onReadingWidthChange={setReadingWidth}
              fontSize={fontSize.id}
              onFontSizeChange={setFontSize}
              buttonClassName={styles.iconBtn}
            />

            <button
              className={styles.iconBtn}
              onClick={handlePrint}
              disabled={contentValue === null}
              aria-label="Print document"
              title="Print document"
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 6V1.5h7V6" />
                <path d="M4.5 12h-2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2" />
                <rect x="4.5" y="9.5" width="7" height="5" />
              </svg>
            </button>
          </header>

          <MarkdownViewer
            content={contentValue}
            contentId={contentId}
            loading={contentLoading}
            error={contentError}
            selectedId={selectedId}
            anchor={anchor}
            navigationKey={location.key}
            restoreScrollTop={restoreScrollTop}
            onAnchorClick={handleAnchorClick}
            documents={documents}
            currentLocation={selectedDoc?.location ?? null}
            onOpenDocument={handleOpenDocument}
            searchQuery={searchQuery}
            searchFocus={searchFocus}
          />
        </main>
      </div>

      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <span className={styles.dropLabel}>Drop a Markdown file or folder to open it</span>
        </div>
      )}

      {/* ── Status bar ── */}
      <footer className={styles.statusBar}>
        <span className={styles.statusItem} title={selectedDoc?.location}>
          {selectedDoc ? selectedDoc.location : ""}
        </span>
        <span className={styles.statusItem} aria-live="polite">
          {listLoading
            ? "Loading…"
            : `${documents.length} document${documents.length !== 1 ? "s" : ""}`}
        </span>
      </footer>
    </div>
  );
}
