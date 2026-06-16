# Foundry — Agent Guide

Foundry generates production-ready Node/Express services from **blueprints** (pick → configure → generate → download zip). Product intent: `project-spec.md`. Dev/run/API reference: `README.md`. This file is orientation + the invariants that are easy to break.

## Commands
- `npm install` — resolve workspaces
- `npm run dev` — API on :4000 (tsx watch; source-only TS, no build step)
- `npm test` — Vitest (generator + server) · `npm run typecheck` · `npm run lint`
- `docker compose up` — full topology (portal :5173 + API :4000 + Postgres), auth bypassed

## Layout
- `packages/shared` (`@foundry/shared`) — contract types: the single source of truth (interfaces + HTTP DTOs).
- `packages/generator` — `FolderResolver` + `Generator` (Handlebars + validation + jszip).
- `packages/server` — Express API implementing `/api`.
- `apps/portal-web` — Vite + React SPA; renders the config form dynamically from a blueprint's `InputSchema`.
- `blueprints/<id>/` — payload: `blueprint.json` manifest + `template/` files.

## Invariants (don't break these)
1. **The generator talks only to `BlueprintResolver`** — never to the filesystem/storage layout. New storage backends (git-ref, package) are new resolver impls; the generator stays untouched. This ports-and-adapters boundary is the core design.
2. **`blueprints/**` is template payload, not Foundry source.** It contains `{{handlebars}}` and intentionally-partial code; it's excluded from workspaces, tsconfig, ESLint, Prettier, and Vitest. Never make Foundry's own tooling compile it. Verify a blueprint by generating → `npm install && npx tsc --noEmit` in the *output*, not by linting templates.
3. **Handlebars helpers are a fixed contract:** `ifEquals`, `ifIncludes`, `kebabCase`, `pascalCase`, `camelCase` — only these. `packages/generator/src/helpers.ts` and blueprint templates must agree; never add a helper on one side only.
4. **`InputSchema` is the single source of truth** for both portal form rendering and generator validation. A blueprint's `inputs` drives the UI and the 400-on-invalid-config check. Field types: `string` (+`pattern`), `boolean`, `select`, `multiselect`.
5. **Defaults resolve before validation.** `required` means "has a value *after* defaults applied" — a field with a `default` always satisfies `required` (see `Generator.generate`).
6. **Templating:** `.hbs` files are rendered then the suffix stripped on emit; all other files copied verbatim. Context = the validated config keyed by `InputField.key`.

## Adding to a blueprint
- New config option → add an `InputField` to `blueprint.json` `inputs.fields` (the portal renders it automatically — no frontend change) and list any new template files in `files[]`.
- Gate optional content with `{{#ifEquals key true}}` / `{{#ifIncludes arr "x"}}`. For conditional deps in a generated `package.json.hbs`, mind JSON comma placement (leading comma for last-position entries).

## Auth
`AUTH_DISABLED=true` (dev) opens all routes; the enabled branch in `packages/server/src/auth.ts` is the seam where a real OAuth/IdP check slots in (the OAuth blueprint is intended to eventually secure the portal — dogfooding). No real IdP is wired yet.
