/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_OAUTH_ENABLED?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
  // VITE_OAUTH_ISSUER is consumed by vite.config.ts (proxy target), not the SPA.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
