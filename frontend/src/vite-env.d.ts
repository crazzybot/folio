/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The live demo's first document (vite.config.ts); "" in other builds. */
declare const __DEMO_START__: string;
