import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { formatNotices, packageDirOf, readPackage } from "./scripts/licenses.mjs";

// Vendor packages split into their own long-cached chunks
const CHUNKS = {
  react: ["react", "react-dom", "scheduler"],
  router: ["react-router", "react-router-dom"],
  markdown: ["react-markdown", "remark-gfm", "rehype-highlight", "highlight.js"],
};

/**
 * Writes third-party-licenses.txt next to the app: the license notices of
 * every package whose code is in the build (scripts/licenses.mjs). The
 * desktop app adds its own dependencies to it (desktop/scripts/copy-renderer.mjs).
 */
function thirdPartyNotices(): Plugin {
  return {
    name: "folio-third-party-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const dirs = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of output.moduleIds) {
          const dir = packageDirOf(id);
          if (dir !== null) dirs.add(dir);
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "third-party-licenses.txt",
        source: formatNotices(
          "Folio includes the following open-source software. Their licenses ask for these\n" +
            "notices to be kept with every copy.",
          [...dirs].map(readPackage),
        ),
      });
    },
  };
}

/**
 * The live demo's link preview (Open Graph), for when its URL is shared. Only
 * the demo build: the desktop app's page has no URL to share.
 */
function demoLinkPreview(): Plugin {
  const site = "https://crazzybot.github.io/folio/";
  const meta = {
    "og:type": "website",
    "og:site_name": "Folio",
    "og:url": `${site}demo/`,
    "og:title": "Folio live demo",
    "og:description": "Read, search and mark up a sample repository of specs and ADRs in your browser, with nothing to install.",
    "og:image": `${site}img/og.png`,
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:alt": "Folio: read and review folders of Markdown, beside a screenshot of the app",
    "twitter:card": "summary_large_image",
  };
  return {
    name: "folio-demo-link-preview",
    apply: (_config, { mode }) => mode === "demo",
    transformIndexHtml: () =>
      Object.entries(meta).map(([key, content]) => ({
        tag: "meta",
        attrs: key.startsWith("twitter:") ? { name: key, content } : { property: key, content },
        injectTo: "head" as const,
      })),
  };
}

// The live demo's data, made by `npm run demo:bundle` in desktop/. Another
// bundle (e.g. of another workspace) with FOLIO_DEMO_DATA, relative to frontend/
const DEMO_DATA = process.env.FOLIO_DEMO_DATA ?? "../demo/build";

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
  plugins: [react(), thirdPartyNotices(), demoLinkPreview()],
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
    // The shared core's browser-safe modules (sourceMap.ts) are imported from source
    fs: { allow: [".", "../packages/core/src"] },
  },
  preview: {
    historyApiFallback: true,
  },
}));
