import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, useNavigate, useNavigationType, useParams, useLocation } from "react-router-dom";
import { fetchAttachments, fetchDocumentContent, fetchDocuments } from "./api";
import { savedScrollPosition } from "./scrollHistory";
import DocumentList from "./components/DocumentList";
import DocumentNoteEditor from "./components/DocumentNoteEditor";
import DocumentNoteIcon from "./components/DocumentNoteIcon";
import MarkdownViewer from "./components/MarkdownViewer";
import type { MarkHandlers, SearchFocus } from "./components/MarkdownViewer";
import type { MarkFocus } from "./components/MarksLayer";
import MarksPanel from "./components/MarksPanel";
import type { MarkTarget, ReviewSelection } from "./components/MarksPanel";
import SidebarTabs from "./components/SidebarTabs";
import type { SidebarView } from "./components/SidebarTabs";
import { findBookmark } from "./bookmarks";
import Breadcrumb from "./components/Breadcrumb";
import useDesktopHistory from "./useDesktopHistory";
import useFileDrop from "./useFileDrop";
import useCustomCss from "./customCss";
import {
  useDocStyle,
  useFontSize,
  useGroupByFolder,
  useOutlineVisible,
  useReadingWidth,
  useReviewIntro,
  useSearchDocumentText,
} from "./readerPrefs";
import useTheme from "./theme";
import { documentsInFolder } from "./documentTree";
import { useFolderFocus } from "./folderFocus";
import { addFilter, filterByMeta, filterOptions, hasFilters } from "./metaFilter";
import { requestDone } from "./status";
import { useMetaFilters } from "./useMetaFilters";
import useMarks from "./useMarks";
import DemoBanner from "./components/DemoBanner";
import DisplayMenu from "./components/DisplayMenu";
import SettingsPanel from "./components/SettingsPanel";
import ReviewNotesPanel, { ReviewNotesIcon, copyText } from "./components/ReviewNotesPanel";
import { formatReviewNotes, reviewPath } from "./reviewNotes";
import type { ReviewNotes } from "./reviewNotes";
import styles from "./App.module.css";
import type { DocumentMeta, HighlightColor, TextAnchor } from "./types";
import { getItem, setItem } from "./storage";
import { OUTLINE_DRAWER_QUERY, SIDEBAR_DRAWER_QUERY, useDrawerFocus, useMediaQuery } from "./drawer";

const PANEL_MIN_WIDTH = 160;
const PANEL_DEFAULT_WIDTH = 260;
const PANEL_MAX_WIDTH = 600;
// Sidebar width and whether it's hidden, remembered per browser / install (storage.ts)
const SIDEBAR_KEY = "folio.sidebar";

function loadSidebar(): { width: number; collapsed: boolean } {
  try {
    const saved: unknown = JSON.parse(getItem(SIDEBAR_KEY) ?? "null");
    if (saved !== null && typeof saved === "object") {
      const { width, collapsed } = saved as Record<string, unknown>;
      return {
        width:
          typeof width === "number" && Number.isFinite(width)
            ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width))
            : PANEL_DEFAULT_WIDTH,
        collapsed: collapsed === true,
      };
    }
  } catch {
    // Storage unavailable or unreadable: defaults
  }
  return { width: PANEL_DEFAULT_WIDTH, collapsed: false };
}

// The sidebar's view (Documents | Marks), remembered (storage.ts)
const SIDEBAR_VIEW_KEY = "folio.sidebarView";

// The macOS desktop app hides the title bar and insets the window buttons
// into the app's own header rows.
const IS_MAC_DESKTOP = window.markdownApi?.platform === "darwin";
const BOOKMARK_SHORTCUT = IS_MAC_DESKTOP || navigator.platform.toUpperCase().includes("MAC") ? "⌘D" : "Ctrl+D";
const BACK_SHORTCUT = IS_MAC_DESKTOP ? "⌘[" : "Alt+←";
const EDITOR_SHORTCUT = IS_MAC_DESKTOP ? "⌘E" : "Ctrl+E";
const FORWARD_SHORTCUT = IS_MAC_DESKTOP ? "⌘]" : "Alt+→";
const REVIEW_SHORTCUT = IS_MAC_DESKTOP || navigator.platform.toUpperCase().includes("MAC") ? "⇧⌘C" : "Ctrl+Shift+C";
// How long a status-bar message (e.g. "Copied 4 notes") shows
const STATUS_SHOWN_MS = 4000;

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; id: string; content: string }
  | { status: "error"; message: string };

/** The latest fetch result for a document. */
type LoadedContent = { id: string } & (
  | { status: "success"; content: string }
  | { status: "error"; message: string }
);

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

  // ── Focus on Folder: the list, search and count narrow to one folder ───────
  const [focus, setFocus] = useFolderFocus();
  const focusedDocuments = useMemo(() => documentsInFolder(documents, focus), [documents, focus]);
  // ── Status and tag filters: the list, search and count narrow further ──────
  // (not the Marks view, which has nowhere to show them)
  const [metaFilters, setMetaFilters] = useMetaFilters();
  const listedDocuments = useMemo(() => filterByMeta(focusedDocuments, metaFilters), [focusedDocuments, metaFilters]);
  // Counted within the focused folder, so no choice leads to an empty list
  const metaOptions = useMemo(() => filterOptions(focusedDocuments, metaFilters), [focusedDocuments, metaFilters]);

  // ── Content state ──────────────────────────────────────────────────────────
  // Only the latest result is stored; whether it's the shown document's (else
  // that one is still loading) is worked out here, during render.
  const [loaded, setLoaded] = useState<LoadedContent | null>(null);
  const contentState: LoadState =
    selectedId === null
      ? { status: "idle" }
      : loaded === null || loaded.id !== selectedId
        ? { status: "loading" }
        : loaded;

  // ── Search (sidebar) → highlights and scrolling in the viewer ─────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<SearchFocus | null>(null);

  // ── Bookmarks and highlights (kept outside the workspace; see useMarks.ts) ─
  const marks = useMarks();
  const highlightCounts = useMemo(
    () =>
      new Map(
        [...marks.byDoc].flatMap(([id, m]) => (m.highlights.length > 0 ? [[id, m.highlights.length] as const] : [])),
      ),
    [marks.byDoc],
  );
  const bookmarkedIds = useMemo(
    () => new Set([...marks.byDoc].flatMap(([id, m]) => (findBookmark(m.bookmarks, null) ? [id] : []))),
    [marks.byDoc],
  );
  const [sidebarView, setSidebarView] = useState<SidebarView>(() =>
    getItem(SIDEBAR_VIEW_KEY) === "marks" ? "marks" : "documents",
  );
  const chooseSidebarView = useCallback((view: SidebarView) => {
    setSidebarView(view);
    setItem(SIDEBAR_VIEW_KEY, view);
  }, []);
  // A mark to scroll to once its document is shown (opened from the Marks view)
  const [markFocus, setMarkFocus] = useState<(MarkFocus & { docId: string }) | null>(null);
  // The open document's highlights found in its text (the viewer reports them)
  const [located, setLocated] = useState<{ docId: string; ids: ReadonlySet<string> } | null>(null);
  const handleLocatedChange = useCallback((docId: string, ids: ReadonlySet<string>) => setLocated({ docId, ids }), []);

  // ── Back / forward (desktop app only; null in the browser) ─────────────────
  const history = useDesktopHistory();

  // ── Open in editor (desktop app only) ───────────────────────────────────────
  // undefined: not the desktop app; null: the system's default app
  const [editorName, setEditorName] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const api = window.markdownApi;
    if (!api) return;
    let cancelled = false;
    void api.getEditorName().then((name) => {
      if (!cancelled) setEditorName(name);
    });
    const unsubscribe = api.onEditorChange(setEditorName);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
  const [docStyle, setDocStyle] = useDocStyle();
  useCustomCss();
  const [showOutline, setShowOutline] = useOutlineVisible();
  const [groupByFolder, setGroupByFolder] = useGroupByFolder();
  const [searchDocumentText, setSearchDocumentText] = useSearchDocumentText();
  const reviewIntro = useReviewIntro();
  // The opening line of copied review notes: undefined for the default, null for none
  const reviewIntroText = !reviewIntro.on ? null : reviewIntro.text.trim() === "" ? undefined : reviewIntro.text;

  // ── Settings panel: ⌘, (the Settings… menu item in the desktop app) or the
  // status bar's gear ─────────────────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const api = window.markdownApi;
    if (api) return api.settings.onShow(() => setSettingsOpen(true));
    // Browser: no menu, so the shortcut is handled here
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Panel / divider state ──────────────────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(() => loadSidebar().width);
  const [collapsed, setCollapsed] = useState(() => loadSidebar().collapsed);

  // Remember the sidebar once a drag or resize settles
  useEffect(() => {
    const timer = setTimeout(() => setItem(SIDEBAR_KEY, JSON.stringify({ width: panelWidth, collapsed })), 300);
    return () => clearTimeout(timer);
  }, [panelWidth, collapsed]);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Images in the workspace, for Obsidian's ![[image.png]] embeds ──────────
  // Loaded once, and again when the workspace changes (desktop live reload)
  const [attachments, setAttachments] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchAttachments()
        .then((list) => {
          if (!cancelled) setAttachments(list);
        })
        .catch(() => {
          // Embeds by name show as "not found"; everything else still works
        });
    };
    load();
    const unsubscribe = window.markdownApi?.onWorkspaceChange(load);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // ── Fetch document list on mount ───────────────────────────────────────────
  // When the list loads and no docId is present in the URL, navigate to the
  // first document using replace:true so the browser back-button stays clean.
  useEffect(() => {
    let cancelled = false;
    fetchDocuments()
      .then((docs) => {
        if (cancelled) return;
        setDocuments(docs);
        setListError(null);
        // Auto-select first document only when no URL param is present: the
        // focused folder's first, if it has any
        const first = documentsInFolder(docs, focus)[0] ?? docs[0];
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
    if (selectedId === null) return;
    let cancelled = false;
    fetchDocumentContent(selectedId)
      .then((doc) => {
        if (cancelled) return;
        setLoaded({ status: "success", id: selectedId, content: doc.content });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoaded({
          status: "error",
          id: selectedId,
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
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
          setLoaded((prev) =>
            prev !== null && prev.status === "success" && prev.id === id && prev.content === doc.content
              ? prev
              : { status: "success", id, content: doc.content },
          );
        })
        .catch(() => {
          if (current !== generation || selectedIdRef.current !== id) return;
          setLoaded({ status: "error", id, message: "This document was moved or deleted." });
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
        : PANEL_MAX_WIDTH;
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

  // ── Drawers: in a narrow window the panels slide in over the document, one
  // at a time, and close once used. Not remembered: the panels' settings
  // above are for when there's room, and apply again when there is ─────────
  const sidebarAsDrawer = useMediaQuery(SIDEBAR_DRAWER_QUERY);
  const outlineAsDrawer = useMediaQuery(OUTLINE_DRAWER_QUERY);
  const [drawer, setDrawer] = useState<"documents" | "outline" | null>(null);
  // Resizing or rotating into another layout closes the open drawer
  const drawerLayout = `${sidebarAsDrawer} ${outlineAsDrawer}`;
  const [shownDrawerLayout, setShownDrawerLayout] = useState(drawerLayout);
  if (drawerLayout !== shownDrawerLayout) {
    setShownDrawerLayout(drawerLayout);
    setDrawer(null);
  }
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const sidebarShown = sidebarAsDrawer ? drawer === "documents" : !collapsed;
  const outlinePressed = outlineAsDrawer ? drawer === "outline" : showOutline;
  const sidebarRef = useRef<HTMLElement>(null);
  useDrawerFocus(sidebarAsDrawer && drawer === "documents", sidebarRef);

  const toggleSidebar = useCallback(() => {
    if (sidebarAsDrawer) setDrawer((d) => (d === "documents" ? null : "documents"));
    else setCollapsed((c) => !c);
  }, [sidebarAsDrawer]);
  const showSidebar = useCallback(() => {
    if (sidebarAsDrawer) setDrawer("documents");
    else setCollapsed(false);
  }, [sidebarAsDrawer]);

  // Escape closes a drawer, unless something in it used the key
  useEffect(() => {
    if (drawer === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) setDrawer(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawer]);

  // A breadcrumb folder: focus the list on it, showing the list if hidden
  const focusFolder = useCallback(
    (folder: string) => {
      setFocus(folder);
      showSidebar();
    },
    [setFocus, showSidebar],
  );

  // A status or tag clicked in the document header: filter the list by it, showing the list
  const filterBy = useCallback(
    (kind: "status" | "tag", value: string) => {
      setMetaFilters(addFilter(metaFilters, kind, value));
      chooseSidebarView("documents");
      showSidebar();
    },
    [metaFilters, setMetaFilters, chooseSidebarView, showSidebar],
  );

  // ⌘B / Ctrl+B toggles the sidebar, as in VS Code
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

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
  const { add: addMark, recolor, setNote, remove: removeMark, toggleBookmark, removeBookmark } = marks;
  // Changes to the shown document's marks, from the viewer
  const markHandlers = useMemo((): MarkHandlers | undefined => {
    if (contentId === null) return undefined;
    return {
      add: (anchor: TextAnchor, color: HighlightColor) => addMark(contentId, anchor, color),
      recolor: (id: string, color: HighlightColor) => void recolor(contentId, id, color),
      setNote: (id: string, note: string | null) => void setNote(contentId, id, note),
      remove: (id: string) => void removeMark(contentId, id),
      toggleHeadingBookmark: (heading) => void toggleBookmark(contentId, heading),
    };
  }, [contentId, addMark, recolor, setNote, removeMark, toggleBookmark]);
  const shownMarks = contentId === null ? undefined : marks.byDoc.get(contentId);
  const documentBookmarked = shownMarks !== undefined && findBookmark(shownMarks.bookmarks, null) !== undefined;

  // ── The note on the document as a whole (document-notes.md) ────────────────
  const documentNote = shownMarks?.note;
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  // Pressing the button while the editor is open saves and closes it (as any
  // click outside it does); the click that follows mustn't open it again
  const noteEditorWasOpen = useRef(false);
  // Open for one document: showing another closes it
  const [noteEditorFor, setNoteEditor] = useState<{ docId: string; right: number; bottom: number } | null>(null);
  const noteEditor = noteEditorFor !== null && noteEditorFor.docId === contentId ? noteEditorFor : null;
  const openNoteEditor = useCallback(() => {
    const box = noteButtonRef.current?.getBoundingClientRect();
    if (box !== undefined && contentId !== null) setNoteEditor({ docId: contentId, right: box.right, bottom: box.bottom });
  }, [contentId]);
  // Offered in the editor after the known statuses
  const workspaceStatuses = useMemo(
    () => [...new Set(documents.flatMap((doc) => (doc.meta?.status != null ? [doc.meta.status] : [])))],
    [documents],
  );
  const shownStatus = documents.find((doc) => doc.id === contentId)?.meta?.status ?? null;
  const documentNotes = useMemo(
    () => new Map([...marks.byDoc].flatMap(([id, m]) => (m.note !== undefined ? [[id, m.note] as const] : []))),
    [marks.byDoc],
  );

  // Open a mark from the Marks view: its document (a history entry, so Back
  // returns), scrolled to the highlight or heading
  const openMark = useCallback(
    (docId: string, target: MarkTarget) => {
      if (target !== null) setMarkFocus({ docId, target, nonce: Date.now() });
      if (docId !== selectedId) navigate("/doc/" + encodeURIComponent(docId));
    },
    [navigate, selectedId],
  );
  const contentLoading = contentState.status === "loading";
  const contentError =
    contentState.status === "error" ? contentState.message : null;

  const selectedDoc = documents.find((doc) => doc.id === selectedId) ?? null;

  // ── Copy review notes: the open document's highlights and notes as Markdown
  // for a coding agent (docs/design/review-notes.md). Stateless: copying
  // changes no marks ─────────────────────────────────────────────────────────
  const [review, setReview] = useState<{ title: string; notes: ReviewNotes } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  useEffect(() => {
    if (statusMessage === null) return;
    const timer = setTimeout(() => setStatusMessage(null), STATUS_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const shownHighlights = useMemo(() => shownMarks?.highlights ?? [], [shownMarks]);
  // Something to copy as review notes: a highlight, or a comment or status change still to make
  const canCopyReview = useMemo(
    () =>
      contentId !== null &&
      (shownHighlights.length > 0 ||
        (documentNote !== undefined &&
          (documentNote.text !== null ||
            (documentNote.requestedStatus !== null && !requestDone(shownStatus, documentNote.requestedStatus))))),
    [contentId, shownHighlights, documentNote, shownStatus],
  );

  const marksByDoc = marks.byDoc;
  /** Review notes on documents' highlights, given their sources. */
  const buildReview = useCallback(
    (docs: readonly ReviewSelection[], sources: readonly string[]): { title: string; notes: ReviewNotes } => {
      const notes = formatReviewNotes(
        docs.map(({ doc, highlights }, i) => {
          // Highlights the viewer couldn't place in the open document's current text are out of date
          const unplaced =
            located !== null && located.docId === doc.id
              ? new Set(highlights.filter((h) => !located.ids.has(h.id)).map((h) => h.id))
              : undefined;
          return {
            docId: doc.id,
            path: reviewPath(doc.location, window.markdownApi?.workspacePath, window.markdownApi?.platform),
            name: doc.filename,
            source: sources[i] ?? "",
            highlights,
            ...(unplaced === undefined ? {} : { unplaced }),
            // The note on the document as a whole, and where its status is written (document-notes.md)
            note: marksByDoc.get(doc.id)?.note,
            status: doc.meta?.status ?? null,
            statusLine: doc.meta?.statusLine ?? null,
          };
        }),
        reviewIntroText,
      );
      const title = docs.length === 1 ? (docs[0]?.doc.filename ?? "") : `${docs.length} documents`;
      return { title, notes };
    },
    [located, reviewIntroText, marksByDoc],
  );

  const openDocumentNotes = useCallback((): { title: string; notes: ReviewNotes } | null => {
    if (contentId === null || contentValue === null || selectedDoc === null || selectedDoc.id !== contentId) return null;
    if (!canCopyReview) return null;
    return buildReview([{ doc: selectedDoc, highlights: shownHighlights }], [contentValue]);
  }, [contentId, contentValue, selectedDoc, shownHighlights, canCopyReview, buildReview]);

  // From the Marks view: the documents' sources (the open one is loaded already), then the preview
  const showReviewNotes = useCallback(
    (docs: readonly ReviewSelection[]) => {
      if (docs.length === 0) return;
      Promise.all(
        docs.map(({ doc }) =>
          doc.id === contentId && contentValue !== null
            ? contentValue
            : fetchDocumentContent(doc.id).then((d) => d.content),
        ),
      ).then(
        (sources) => setReview(buildReview(docs, sources)),
        () => setStatusMessage("Couldn't read the documents to copy"),
      );
    },
    [contentId, contentValue, buildReview],
  );

  // ⇧⌘C / Ctrl+Shift+C (or Edit → Copy Review Notes): copy straight away,
  // without the preview; where the page has no clipboard, show the preview
  const copyReviewNotes = useCallback(() => {
    const review = openDocumentNotes();
    if (review === null || (review.notes.notes.length === 0 && review.notes.documentNotes === 0)) {
      setStatusMessage("No highlights or notes to copy");
      return;
    }
    const { notes, title } = review;
    void copyText(notes.text).then((ok) => {
      if (!ok) {
        setReview(review);
        return;
      }
      // Notes on passages, and the note on the document as a whole
      const count = notes.notes.length + notes.documentNotes;
      setStatusMessage(
        `Copied ${count} note${count !== 1 ? "s" : ""} on ${title}` +
          (notes.leftOut > 0 ? ` · ${notes.leftOut} out of date, left out` : ""),
      );
    });
  }, [openDocumentNotes]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copyReviewNotes();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = window.markdownApi?.onFindCommand((command) => {
      if (command === "copy-review-notes") copyReviewNotes();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [copyReviewNotes]);

  // ⌘D / Ctrl+D (or Edit → Bookmark Document): bookmark the shown document, or remove its bookmark
  useEffect(() => {
    const toggle = () => {
      if (contentId !== null) void toggleBookmark(contentId, null);
    };
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = window.markdownApi?.onFindCommand((command) => {
      if (command === "bookmark") toggle();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [contentId, toggleBookmark]);
  const toggleLabel = sidebarShown ? "Hide document list (⌘B)" : "Show document list (⌘B)";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={styles.appRoot}
      ref={containerRef}
      data-titlebar={IS_MAC_DESKTOP ? "inset" : undefined}
      data-doc-style={docStyle.id}
      style={{ "--reading-width": readingWidth.value, "--reading-font-size": fontSize.value } as React.CSSProperties}
    >
      {import.meta.env.MODE === "demo" && <DemoBanner />}
      <div className={styles.workbench}>
        {/* ── Left panel (document list) ── */}
        <aside
          ref={sidebarRef}
          className={
            sidebarAsDrawer
              ? `${styles.leftPanel} ${styles.drawer} ${sidebarShown ? styles.drawerOpen : ""}`
              : styles.leftPanel
          }
          style={sidebarAsDrawer ? undefined : { width: effectivePanelWidth }}
          aria-label="Document list"
          inert={!sidebarShown}
          tabIndex={sidebarAsDrawer ? -1 : undefined}
        >
          <div className={styles.sidebarView} hidden={sidebarView !== "marks"}>
            <MarksPanel
              tabs={<SidebarTabs view={sidebarView} onChange={chooseSidebarView} />}
              {...(sidebarAsDrawer ? { onCollapse: closeDrawer } : {})}
              documents={focusedDocuments}
              current={selectedDoc}
              byDoc={marks.byDoc}
              located={located}
              onOpen={(docId, target) => {
                closeDrawer();
                openMark(docId, target);
              }}
              onRemoveHighlight={(docId, id) => void removeMark(docId, id)}
              onRemoveBookmark={(docId, id) => void removeBookmark(docId, id)}
              onRemoveDocumentNote={(docId) => void marks.removeDocumentNote(docId)}
              missing={marks.missing}
              allDocuments={documents}
              onRelink={(recordId, docId) => void marks.relink(recordId, docId)}
              onForget={(recordId) => void marks.forget(recordId)}
              onCopyNotes={showReviewNotes}
            />
          </div>
          {/* Kept mounted while hidden, so its search and folders stay as they were */}
          <div className={styles.sidebarView} hidden={sidebarView !== "documents"}>
          <DocumentList
            tabs={<SidebarTabs view={sidebarView} onChange={chooseSidebarView} />}
            {...(sidebarAsDrawer ? { onCollapse: closeDrawer } : {})}
            bookmarkedIds={bookmarkedIds}
            documentNotes={documentNotes}
            documents={listedDocuments}
            selectedId={selectedId}
            onSelect={(id, occurrence) => {
              closeDrawer();
              handleSelect(id, occurrence);
            }}
            onOpenSection={(id, anchorId) => {
              closeDrawer();
              handleOpenDocument(id, anchorId);
            }}
            onSearchQueryChange={setSearchQuery}
            grouped={groupByFolder}
            onGroupedChange={setGroupByFolder}
            fullText={searchDocumentText}
            onFullTextChange={setSearchDocumentText}
            focus={focus}
            onFocusChange={setFocus}
            filters={metaFilters}
            filterOptions={metaOptions}
            onFiltersChange={setMetaFilters}
            highlightCounts={highlightCounts}
            loading={listLoading}
            error={listError}
          />
          </div>
        </aside>

        {/* ── Divider ── */}
        {!sidebarAsDrawer && <div
          className={styles.divider}
          onMouseDown={handleDividerMouseDown}
          onDoubleClick={toggleCollapse}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuenow={effectivePanelWidth}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setPanelWidth((w) => Math.max(PANEL_MIN_WIDTH, w - 20));
              setCollapsed(false);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setPanelWidth((w) => Math.min(w + 20, PANEL_MAX_WIDTH));
              setCollapsed(false);
            }
          }}
        />}

        {/* ── Right panel ── */}
        <main className={styles.rightPanel} aria-label="Markdown viewer">
          <header
            className={`${styles.editorHeader} ${sidebarAsDrawer || collapsed ? styles.editorHeaderInset : ""}`}
          >
            <button
              className={styles.iconBtn}
              onClick={toggleSidebar}
              aria-label={toggleLabel}
              aria-pressed={sidebarShown}
              title={toggleLabel}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
                <line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" />
                {sidebarShown && <rect x="2" y="3" width="4" height="10" fill="currentColor" opacity="0.35" />}
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

            <Breadcrumb location={selectedDoc?.location ?? null} onFolderClick={focusFolder} />

            <button
              className={`${styles.iconBtn} ${documentBookmarked ? styles.iconBtnOn : ""}`}
              onClick={() => {
                if (contentId !== null) void toggleBookmark(contentId, null);
              }}
              disabled={contentId === null}
              aria-pressed={documentBookmarked}
              aria-label={`${documentBookmarked ? "Remove bookmark" : "Bookmark document"} (${BOOKMARK_SHORTCUT})`}
              title={`${documentBookmarked ? "Remove bookmark" : "Bookmark document"} (${BOOKMARK_SHORTCUT})`}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 2h8v12l-4-3-4 3z" fill={documentBookmarked ? "currentColor" : "none"} />
              </svg>
            </button>
            <button
              ref={noteButtonRef}
              className={`${styles.iconBtn} ${documentNote !== undefined ? styles.iconBtnOn : ""}`}
              onPointerDown={() => {
                noteEditorWasOpen.current = noteEditor !== null;
              }}
              onClick={() => {
                if (noteEditorWasOpen.current) noteEditorWasOpen.current = false;
                else if (noteEditor === null) openNoteEditor();
              }}
              disabled={contentId === null}
              aria-haspopup="dialog"
              aria-expanded={noteEditor !== null}
              aria-label={documentNote !== undefined ? "Edit the note on this document" : "Note on this document"}
              title={documentNote !== undefined ? "Edit the note on this document" : "Note on this document"}
              type="button"
            >
              <DocumentNoteIcon />
            </button>
            {noteEditor !== null && contentId !== null && (
              <DocumentNoteEditor
                anchor={noteEditor}
                currentStatus={shownStatus}
                note={documentNote}
                workspaceStatuses={workspaceStatuses}
                onSave={(changes) => void marks.saveDocumentNote(contentId, changes)}
                onRemove={() => void marks.removeDocumentNote(contentId)}
                onClose={() => setNoteEditor(null)}
              />
            )}

            {/* Shown even with nothing to copy (disabled), so it's found and the toolbar keeps its place */}
            <button
              className={styles.iconBtn}
              onClick={() => setReview(openDocumentNotes())}
              disabled={!canCopyReview}
              aria-label={`Copy review notes (${REVIEW_SHORTCUT})`}
              title={
                canCopyReview
                  ? `Copy review notes (${REVIEW_SHORTCUT})`
                  : "Copy review notes: highlight a passage, or add a note on the document, first"
              }
              type="button"
            >
              <ReviewNotesIcon />
            </button>

            {editorName !== undefined && (
              <button
                className={styles.iconBtn}
                onClick={() => void window.markdownApi?.openInEditor()}
                disabled={contentValue === null}
                aria-label={`Open in ${editorName ?? "editor"} (${EDITOR_SHORTCUT})`}
                title={`Open in ${editorName ?? "editor"} (${EDITOR_SHORTCUT})`}
                type="button"
              >
                {/* A pencil */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.5 2.5l3 3L6 13H3v-3z" />
                  <path d="M9 4l3 3" />
                </svg>
              </button>
            )}

            <button
              className={`${styles.iconBtn} ${outlinePressed ? styles.iconBtnPressed : ""}`}
              onClick={() => {
                if (outlineAsDrawer) setDrawer((d) => (d === "outline" ? null : "outline"));
                else setShowOutline(!showOutline);
              }}
              aria-pressed={outlinePressed}
              aria-label={outlinePressed ? "Hide outline" : "Show outline"}
              title={outlinePressed ? "Hide outline" : "Show outline"}
              type="button"
            >
              {/* A list of headings, indented by level */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 4h11M5 7.33h8.5M5 10.67h8.5M7.5 14h6" opacity={outlinePressed ? 1 : 0.7} />
              </svg>
            </button>

            <DisplayMenu
              theme={theme}
              onThemeChange={setTheme}
              readingWidth={readingWidth.id}
              onReadingWidthChange={setReadingWidth}
              fontSize={fontSize.id}
              onFontSizeChange={setFontSize}
              docStyle={docStyle.id}
              onDocStyleChange={setDocStyle}
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
            attachments={attachments}
            currentLocation={selectedDoc?.location ?? null}
            onOpenDocument={handleOpenDocument}
            onFilterBy={filterBy}
            documentNote={documentNote}
            onEditDocumentNote={openNoteEditor}
            onClearNoteRequest={() => {
              if (contentId !== null && documentNote !== undefined) {
                void marks.saveDocumentNote(contentId, { text: documentNote.text, requestedStatus: null });
              }
            }}
            searchQuery={searchQuery}
            searchFocus={searchFocus}
            showOutline={showOutline}
            {...(outlineAsDrawer ? { outlineDrawer: { open: drawer === "outline", onClose: closeDrawer } } : {})}
            {...(shownMarks === undefined ? {} : { highlights: shownMarks.highlights, bookmarks: shownMarks.bookmarks })}
            {...(markHandlers === undefined ? {} : { markHandlers })}
            markFocus={markFocus}
            onLocatedChange={handleLocatedChange}
          />
        </main>
      </div>

      {/* Behind an open drawer: a tap outside it closes it */}
      {(sidebarAsDrawer || outlineAsDrawer) && (
        <div
          className={`${styles.scrim} ${drawer !== null ? styles.scrimShown : ""}`}
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <span className={styles.dropLabel}>Drop a Markdown file or folder to open it</span>
        </div>
      )}

      {review !== null && (
        <ReviewNotesPanel
          title={review.title}
          notes={review.notes}
          onClose={() => setReview(null)}
          onOpenNote={(docId, highlightId) => {
            setReview(null);
            openMark(docId, { highlight: highlightId });
          }}
          onShowLeftOut={() => {
            setReview(null);
            chooseSidebarView("marks");
            showSidebar();
          }}
        />
      )}

      {/* ── Status bar ── */}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
          docStyle={docStyle.id}
          onDocStyleChange={setDocStyle}
          readingWidth={readingWidth.id}
          onReadingWidthChange={setReadingWidth}
          fontSize={fontSize.id}
          onFontSizeChange={setFontSize}
          groupByFolder={groupByFolder}
          onGroupByFolderChange={setGroupByFolder}
          showOutline={showOutline}
          onShowOutlineChange={setShowOutline}
          searchDocumentText={searchDocumentText}
          onSearchDocumentTextChange={setSearchDocumentText}
          reviewIntroOn={reviewIntro.on}
          onReviewIntroOnChange={reviewIntro.setOn}
          reviewIntro={reviewIntro.text}
          onReviewIntroChange={reviewIntro.setText}
        />
      )}

      <footer className={styles.statusBar}>
        <button
          type="button"
          className={styles.statusBtn}
          onClick={() => setSettingsOpen(true)}
          aria-label={`Settings (${IS_MAC_DESKTOP || navigator.platform.toUpperCase().includes("MAC") ? "⌘," : "Ctrl+,"})`}
          title="Settings"
        >
          {/* A gear */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" strokeLinecap="round" />
          </svg>
        </button>
        <span className={styles.statusItem} title={selectedDoc?.location}>
          {selectedDoc ? selectedDoc.location : ""}
        </span>
        {statusMessage !== null && (
          <span className={styles.statusItem} role="status">
            {statusMessage}
          </span>
        )}
        {marks.error !== null && (
          <span className={`${styles.statusItem} ${styles.statusError}`} role="alert">
            {marks.error}
          </span>
        )}
        <span className={styles.statusItem} aria-live="polite">
          {listLoading
            ? "Loading…"
            : focus !== null || hasFilters(metaFilters)
              ? `${listedDocuments.length} of ${documents.length} documents`
              : `${documents.length} document${documents.length !== 1 ? "s" : ""}`}
        </span>
      </footer>
    </div>
  );
}
