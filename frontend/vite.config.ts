import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vendor packages split into their own long-cached chunks
const CHUNKS = {
  react: ["react", "react-dom", "scheduler"],
  router: ["react-router", "react-router-dom"],
  markdown: ["react-markdown", "remark-gfm", "rehype-highlight", "highlight.js"],
};

// The live demo's data, made by `npm run demo:bundle` in desktop/
const DEMO_DATA = "../demo/build";

/**
 * The document the demo opens on: the sample repository's README. Read from
 * the bundle, so a demo build without one fails here rather than in the browser.
 */
function demoStart(): string {
  const file = `${DEMO_DATA}/bundle.json`;
  if (!existsSync(file)) throw new Error(`No demo data in ${DEMO_DATA}: run \`npm run demo:bundle\` in desktop/ first`);
  const { documents } = JSON.parse(readFileSync(file, "utf8")) as { documents: { id: string; location: string }[] };
  const start = documents.find((doc) => doc.location === "README.md") ?? documents[0];
  if (start === undefined) throw new Error(`The demo bundle in ${DEMO_DATA} has no documents`);
  return start.id;
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __DEMO_START__: JSON.stringify(mode === "demo" ? demoStart() : ""),
  },
  // The live demo's bundle.json and workspace/ (desktop/scripts/demo-bundle.mjs),
  // served next to the app; other builds have no public files
  publicDir: mode === "demo" ? DEMO_DATA : "public",
  build: {
    target: "es2022",
    // Not for the live demo: it's published to the site, maps and all
    sourcemap: mode !== "demo",
    // The chunks above 500 kB are Mermaid's (its parser and the elk layout
    // engine, ~1.5 MB), loaded only for documents with a diagram. The entry
    // chunk is well under this; keep it that way by loading heavy libraries
    // on demand (see MermaidDiagram.tsx, katexLoader.ts).
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Function form: Vite 8 (Rolldown) doesn't accept the object form
        manualChunks(id) {
          const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id)?.[1];
          if (pkg === undefined) return undefined;
          if (CHUNKS.react.includes(pkg)) return "react";
          if (CHUNKS.router.includes(pkg)) return "router";
          if (CHUNKS.markdown.includes(pkg)) return "markdown";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    historyApiFallback: true,
    proxy: {
      "/api": {
        target: process.env["VITE_API_BASE_URL"] ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    historyApiFallback: true,
  },
}));
