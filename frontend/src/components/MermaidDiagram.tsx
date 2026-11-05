import React, { useEffect, useState } from "react";
import { useAppliedTheme } from "../theme";
import styles from "./MermaidDiagram.module.css";

/**
 * A ```mermaid code block, rendered as a diagram. Mermaid is large, so it is
 * loaded on first use only. It renders with securityLevel "strict" (labels
 * sanitized, no click handlers or scripts); the app's Content-Security-Policy
 * blocks inline script on top of that.
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
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const { svg } = await mermaid.render(`folio-mermaid-${nextId++}`, code);
    return svg;
  };
  const result = renderQueue.then(run, run);
  renderQueue = result.catch(() => undefined);
  return result;
}

type State = { status: "rendering" } | { status: "done"; svg: string } | { status: "error"; message: string };

export default function MermaidDiagram({ code }: { code: string }): React.ReactElement {
  const theme = useAppliedTheme();
  const [state, setState] = useState<State>({ status: "rendering" });

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
    <div
      className={styles.diagram}
      role="img"
      aria-label="Mermaid diagram"
      // Mermaid's output, sanitized by Mermaid in strict mode
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
