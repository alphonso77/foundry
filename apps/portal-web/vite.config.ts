import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The portal expects the Foundry server (Beta's package) on port 4000 by default
// (see Beta's `.env.example`). Override with VITE_SERVER_ORIGIN, or set an absolute
// VITE_API_BASE to bypass the proxy entirely.
const SERVER_ORIGIN = process.env.VITE_SERVER_ORIGIN ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
    },
  },
});
