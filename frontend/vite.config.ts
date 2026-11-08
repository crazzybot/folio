import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vendor packages split into their own long-cached chunks
const CHUNKS = {
  react: ["react", "react-dom", "scheduler"],
  router: ["react-router", "react-router-dom"],
  markdown: ["react-markdown", "remark-gfm", "rehype-highlight", "highlight.js"],
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The live demo's bundle.json and workspace/ (desktop/scripts/demo-bundle.mjs),
  // served next to the app; other builds have no public files
  publicDir: mode === "demo" ? "../demo/build" : "public",
  build: {
    target: "es2022",
    sourcemap: true,
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
