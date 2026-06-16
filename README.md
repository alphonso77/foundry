# Foundry

Web portal for bootstrapping production-ready Node/Express services from **blueprints**: pick a blueprint, configure it in the UI, generate a working project, download the zip. See [`project-spec.md`](./project-spec.md).

This repo is an npm-workspaces monorepo (TypeScript, strict).

```
packages/shared      @foundry/shared      contract types (single source of truth)
packages/generator   @foundry/generator   FolderResolver + Handlebars + validation + zip
packages/server      @foundry/server      Express HTTP API (the /api contract)
apps/portal-web      portal-web           Vite + React SPA            (Gamma)
blueprints/          template payload — NOT part of Foundry's build   (Gamma)
```

> **Boundary:** `blueprints/**` is template payload (it contains `{{handlebars}}` and intentionally-partial source). It is excluded from workspaces, tsconfig, ESLint, Prettier, and Vitest — Foundry's own tooling never compiles it. The generator reads it at runtime via `FolderResolver`.

## Status

- [x] **M0** — OAuth blueprint generates a buildable project; single-output ZIP download
- [x] **M1** — Portal UI: list → configure → generate → download; dockerized local dev; Swagger UI at `/docs` with PKCE pre-wired
- [ ] **M2** *(if time)* — Dogfood OAuth: secure the portal with the OAuth blueprint
- [ ] **M3** *(if time)* — Deploy-from-portal to AWS
- [ ] **M4** *(if time)* — New repo per generation; second blueprint; self-host capstone

Full feature-level breakdown: [`docs/PROGRESS.md`](./docs/PROGRESS.md)

## Develop

```bash
npm install            # resolve all workspaces
npm run dev            # API server on :4000 (tsx watch)
npm test               # Vitest across generator + server
npm run typecheck      # tsc --noEmit across all workspaces
npm run lint           # eslint
```

Or the full dockerized topology (portal + API + Postgres, auth bypassed):

```bash
cp .env.example .env
docker compose up
```

Postgres mirrors the real topology and backs _generated_ projects; the generator itself never opens a DB connection, so generation works even if Postgres is down.

## HTTP API (`/api`)

| Method | Path                  | Result                                                            |
| ------ | --------------------- | ----------------------------------------------------------------- |
| GET    | `/api/health`         | `{ ok: true }`                                                    |
| GET    | `/api/blueprints`     | `BlueprintSummary[]`                                              |
| GET    | `/api/blueprints/:id` | `BlueprintManifest` · `404 { error }`                             |
| POST   | `/api/generate`       | `application/zip` attachment · `400 { errors }` · `404 { error }` |

`POST /api/generate` body: `{ blueprintId, version?, config }`. All DTOs live in `@foundry/shared`.

### Handlebars helpers available to templates

`ifEquals`, `ifIncludes`, `kebabCase`, `pascalCase`, `camelCase` — and only these (see coordination contract). `.hbs` files are templated (suffix stripped on emit); all other files are copied verbatim.

**Zip:** built in-memory with `jszip`.
