import React, { useEffect, useMemo, useRef, useState } from "react";
import { authoredTheme } from "../mermaidTheme";
import { useAppliedTheme } from "../theme";
import DiagramViewer from "./DiagramViewer";
import styles from "./MermaidDiagram.module.css";

/**
 * A ```mermaid code block, rendered as a diagram. Mermaid is large, so it is
 * loaded on first use only. It renders with securityLevel "strict" (labels
 * sanitized, no click handlers or scripts); the app's Content-Security-Policy
 * blocks inline script on top of that.
 *
 * Diagrams follow the app's light / dark theme, except those that set their
 * own colours or theme: they're drawn in the theme they were written for, on
 * a card of that theme's background, so their text stays readable.
 */

type MermaidApi = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidApi> | null = null;
// mermaid.render isn't safe to run concurrently: queue renders one at a time
let renderQueue: Promise<unknown> = Promise.resolve();
let nextId = 0;

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

function renderDiagram(code: string, theme: "light" | "dark"): Promise<string> {
  const run = async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // Errors are shown by this component; Mermaid would otherwise append
      // its own error graphic to <body>
      suppressErrorRendering: true,
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const id = `folio-mermaid-${nextId++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      // Mermaid renders in a temporary element on <body>; make sure none is left
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  };
  const result = renderQueue.then(run, run);
  renderQueue = result.catch(() => undefined);
  return result;
}

/** The diagram's own title: front-matter `title:` or a `title …` line (gantt, pie, journey…). */
function diagramTitle(code: string): string | null {
  const match =
    /^\s*---[\s\S]*?^\s*title\s*:\s*["']?(.+?)["']?\s*$/m.exec(code) ?? /^\s*(?:pie\s+)?title\s+(.+?)\s*$/m.exec(code);
  return match?.[1] ?? null;
}

/**
 * The caption for the full-window view: the document's title, then the
 * diagram's own title or else the nearest heading above it.
 */
function diagramCaption(figure: HTMLElement, code: string): string {
  const article = figure.closest("article");
  const headings = article === null ? [] : [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  const documentTitle = headings[0]?.textContent?.trim() ?? "";
  const above = headings.filter((h) => h.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  const own = diagramTitle(code) ?? above?.textContent?.trim() ?? "";
  const parts = [documentTitle, own].filter((part, i, all) => part !== "" && all.indexOf(part) === i);
  return parts.length > 0 ? parts.join(" — ") : "Diagram";
}

type State = { status: "rendering" } | { status: "done"; svg: string } | { status: "error"; message: string };

export default function MermaidDiagram({ code }: { code: string }): React.ReactElement {
  const appTheme = useAppliedTheme();
  const authored = useMemo(() => authoredTheme(code), [code]);
  const theme = authored ?? appTheme;
  // Drawn for the other background: show it on a card of its own
  const card = theme !== appTheme ? (theme === "dark" ? styles.darkCard : styles.lightCard) : "";
  const [state, setState] = useState<State>({ status: "rendering" });
  const [fullWindow, setFullWindow] = useState(false);
  const figureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    renderDiagram(code, theme)
      .then((svg) => {
        if (!cancelled) setState({ status: "done", svg });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (state.status === "error") {
    return (
      <div className={styles.error} role="note">
        <p className={styles.errorTitle}>Couldn't draw this Mermaid diagram</p>
        <p className={styles.errorMessage}>{state.message}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  if (state.status === "rendering") {
    return (
      <div className={styles.placeholder} aria-busy="true">
        Drawing diagram…
      </div>
    );
  }
  return (
    <div className={styles.figure} ref={figureRef}>
      <div
        className={`${styles.diagram} ${card}`}
        role="img"
        aria-label="Mermaid diagram"
        onDoubleClick={() => setFullWindow(true)}
        // Mermaid's output, sanitized by Mermaid in strict mode
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      <button
        type="button"
        className={styles.expandBtn}
        onClick={() => setFullWindow(true)}
        aria-label="Open diagram in full window"
        title="Open in full window (or double-click the diagram)"
      >
        {/* Arrows to the corners */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9" />
        </svg>
      </button>
      {fullWindow && (
        <DiagramViewer
          svg={state.svg}
          caption={figureRef.current === null ? "Diagram" : diagramCaption(figureRef.current, code)}
          // The card's colour for a diagram drawn for the other theme
          background={card === "" ? "var(--color-bg)" : theme === "dark" ? "#1f1f1f" : "#ffffff"}
          onClose={() => setFullWindow(false)}
        />
      )}
    </div>
  );
}
