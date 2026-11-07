import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vendor packages split into their own long-cached chunks
const CHUNKS = {
  react: ["react", "react-dom", "scheduler"],
  router: ["react-router", "react-router-dom"],
  markdown: ["react-markdown", "remark-gfm", "rehype-highlight", "highlight.js"],
};

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
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
});
