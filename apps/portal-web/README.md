# Foundry Portal (`@foundry/portal-web`)

Vite + React + TypeScript SPA for the Foundry M1 flow: list blueprints → configure → generate → download.

## Develop

```bash
npm install            # from the repo root (npm workspaces)
npm run dev -w @foundry/portal-web
```

The dev server runs on **http://localhost:5173** and proxies `/api` to the Foundry
server (default port **4000**). Point the proxy at a non-default origin with:

```bash
VITE_SERVER_ORIGIN=http://localhost:4000 npm run dev -w @foundry/portal-web
```

Or bypass the proxy entirely by setting an absolute API base:

```bash
VITE_API_BASE=http://localhost:4000/api npm run dev -w @foundry/portal-web
```

The server enables CORS for `http://localhost:5173`, so both the proxied and the
direct-origin modes work.

## Contract types

`src/types.ts` re-exports the contract types from `@foundry/shared` — the single
source of truth shared with the generator and server.

## Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Vite dev server (port 5173, `/api` proxy). |
| `build` | Production build to `dist/`. |
| `typecheck` | `tsc --noEmit`. |
| `preview` | Serve the production build locally. |
