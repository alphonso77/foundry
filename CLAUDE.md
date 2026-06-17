# Foundry — Agent Guide

Foundry generates production-ready Node/Express services from **blueprints** (pick → configure → generate → download zip). Product intent: `project-spec.md`. Dev/run/API reference: `README.md`. This file is orientation + the invariants that are easy to break.

## Commands
- `npm install` — resolve workspaces
- `npm run dev` — API on :4000 (tsx watch; source-only TS, no build step)
- `npm test` — Vitest (generator + server) · `npm run typecheck` · `npm run lint`
- `docker compose up` — full topology (portal :5173 + API :4000 + Postgres), auth bypassed
- `npm run gen:oauth` — dev-loop harness: generate the OAuth blueprint into `.scratch/` → install → `db:init` → run (against the compose Postgres). `-- --help` for flags. Dev-only; drives the generator programmatically.

## Layout
- `packages/shared` (`@foundry/shared`) — contract types: the single source of truth (interfaces + HTTP DTOs).
- `packages/generator` — `FolderResolver` + `Generator` (Handlebars + validation + jszip).
- `packages/server` — Express API implementing `/api`.
- `apps/portal-web` — Vite + React SPA; renders the config form dynamically from a blueprint's `InputSchema`.
- `blueprints/<id>/` — payload: `blueprint.json` manifest + `template/` files.

## Invariants (don't break these)
1. **The generator talks only to `BlueprintResolver`** — never to the filesystem/storage layout. New storage backends (git-ref, package) are new resolver impls; the generator stays untouched. This ports-and-adapters boundary is the core design.
2. **`blueprints/**` is template payload, not Foundry source.** It contains `{{handlebars}}` and intentionally-partial code; it's excluded from workspaces, tsconfig, ESLint, Prettier, and Vitest. Never make Foundry's own tooling compile it. Verify a blueprint by generating → `npm install && npx tsc --noEmit` in the *output*, not by linting templates. (The `gen:oauth` harness emits generated output to `.scratch/` — gitignored and ESLint-ignored, same rationale.)
3. **Handlebars helpers are a fixed contract:** `ifEquals`, `ifIncludes`, `kebabCase`, `pascalCase`, `camelCase` — only these. `packages/generator/src/helpers.ts` and blueprint templates must agree; never add a helper on one side only.
4. **`InputSchema` is the single source of truth** for both portal form rendering and generator validation. A blueprint's `inputs` drives the UI and the 400-on-invalid-config check. Field types: `string` (+`pattern`), `boolean`, `select`, `multiselect`.
5. **Defaults resolve before validation.** `required` means "has a value *after* defaults applied" — a field with a `default` always satisfies `required` (see `Generator.generate`).
6. **Templating:** `.hbs` files are rendered then the suffix stripped on emit; all other files copied verbatim. Context = the validated config keyed by `InputField.key`.

## Adding to a blueprint
- New config option → add an `InputField` to `blueprint.json` `inputs.fields` (the portal renders it automatically — no frontend change) and list any new template files in `files[]`.
- Gate optional content with `{{#ifEquals key true}}` / `{{#ifIncludes arr "x"}}`. For conditional deps in a generated `package.json.hbs`, mind JSON comma placement (leading comma for last-position entries).

## Auth
The portal is dogfooded behind its own OAuth blueprint (M2). Two run modes:
- **Bypassed (dev default):** `AUTH_DISABLED=true` opens all `/api` routes — what `docker compose up` runs.
- **Armed:** `AUTH_DISABLED=false` makes `packages/server/src/auth.ts` verify a real bearer access token
  from the generated IdP — HS256 signature + `OAUTH_ISSUER` + `type==='access'` (refresh-as-bearer
  rejected). `OAUTH_JWT_SECRET`/`OAUTH_ISSUER` must equal the IdP's `JWT_SECRET`/`OAUTH_ISSUER` (local
  defaults align).

Secured loop is **host-side, not compose** (compose stays bypassed): `npm run gen:oauth` (IdP on :3000,
seeds the `foundry-portal` client via `SEED_CLIENT_*`) · `AUTH_DISABLED=false npm run dev` (API) ·
`VITE_OAUTH_ENABLED=true npm run dev -w @foundry/portal-web` (SPA runs auth-code + PKCE, attaches the
bearer). See `docs/PROGRESS.md` → "M2 — secured portal loop".

Identity is **client-level** (`subject = client_id`) — no per-user login/consent. This blocks forged
tokens and accidental open access, but is a **structural/dogfooding** milestone, not a hardened boundary:
anyone with the public `client_id` + a registered `redirect_uri` can mint a token. User auth at
`/authorize` and RS256+JWKS (replacing the shared HS256 secret) are deferred — see `project-spec.md` →
Decisions.

Generated IdP endpoints: `/oauth/authorize`, `/oauth/token`, and `/oauth/userinfo` (protected showcase —
Swagger Authorize → Execute). Register extra clients at `db:init` via env: `SEED_CLIENT_ID`,
`SEED_CLIENT_REDIRECT_URIS`, `SEED_CLIENT_SECRET`.
