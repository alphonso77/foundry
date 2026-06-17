import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The portal expects the Foundry server (@foundry/server) on port 4000 by default
// (see packages/server/.env.example). Override with VITE_SERVER_ORIGIN, or set an
// absolute VITE_API_BASE to bypass the proxy entirely.
const SERVER_ORIGIN = process.env.VITE_SERVER_ORIGIN ?? 'http://localhost:4000';

// The dogfooded IdP (the OAuth blueprint). The SPA's auth-code + PKCE calls hit
// same-origin `/oauth/*` paths so the browser never makes a cross-origin request
// to the IdP — the dev proxy forwards them here. (The IdP enables no CORS, and a
// cross-origin token fetch would have its response blocked anyway.) The gen:oauth
// harness runs the IdP on :3000; override with VITE_OAUTH_ISSUER.
const OAUTH_ORIGIN = process.env.VITE_OAUTH_ISSUER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
      '/oauth': {
        target: OAUTH_ORIGIN,
        changeOrigin: true,
      },
    },
  },
});
