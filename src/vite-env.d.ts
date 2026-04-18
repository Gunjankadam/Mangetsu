/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional default manga-flow Node API origin for static web deploys (no trailing slash). */
  readonly VITE_MANGA_FLOW_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
