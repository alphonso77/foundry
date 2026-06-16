# Foundry — Progress Tracker

Operator-visibility dashboard for the current effort. Sessions update their rows on completion; Alpha owns the milestone/status columns. Source of truth for *task detail* is the coordination file (`~/.claude/projects/-Users-johnny-foundry/memory/coordination.md`); this doc is the *at-a-glance* view.

**Effort:** Foundry M0 + M1 — generator core + portal UI → working end-to-end demo (select OAuth blueprint → configure → generate → download a buildable project).
**Started:** 2026-06-16
**Target:** Working browser demo; downloaded OAuth project builds clean (`npm install && tsc --noEmit`).

---

## Milestone status

| Milestone | Definition of done | Owner(s) | Status |
|-----------|--------------------|----------|--------|
| **M0 — Generator core** | OAuth blueprint generates a buildable project via FolderResolver + Handlebars; single-output zip. | Beta (engine) + Gamma (blueprint) | ✅ Done — Delta R2 green; P1 fixed & reviewed |
| **M1 — Portal UI** | Browser flow: list → configure (form from input schema) → generate → download; dockerized local dev, auth bypassed. | Beta (API/infra) + Gamma (frontend) | ✅ Done — Delta R2 green; flow works |
| **M1.1 — Swagger UI (PKCE)** | Generated OAuth project serves interactive Swagger UI at `/docs`, PKCE pre-wired; gated on new `apiDocs` input. | Gamma (blueprint) | ✅ Done — Delta R3 green; reviewed |

Legend: ⬜ Not started · 🟡 In progress · 🔵 In review (Delta/Alpha) · ✅ Done · 🔴 Blocked

---

## Session status board

| Session | Role | Status | Last update | Notes |
|---------|------|--------|-------------|-------|
| Alpha | Orchestration / design review | 🟡 Active | 2026-06-16 | All rounds reviewed & passing (M0/M1/P1/M1.1). Ready to wrap up (CLAUDE.md + reset) on user's go. |
| Beta | Backend platform (types, generator, API, infra) | ✅ Done | 2026-06-16 | M0/M1 + P1 complete & reviewed. Not engaged in M1.1. |
| Gamma | OAuth blueprint + portal frontend | ✅ Done | 2026-06-16 | M0/M1 + M1.1 Swagger UI done & reviewed. Verified through real generator. |
| Delta | Mechanical verification | ✅ Pass (R3) | 2026-06-16 | R3 green: 30/30, Swagger smoke both ways (apiDocs on→/docs 200+PKCE; off→404+dep absent), no regression. |

---

## Workstream checklist

### Beta — backend platform
- [x] Monorepo scaffold (root `package.json` workspaces, `tsconfig.base`, ESLint/Prettier, `.env.example`)
- [x] `packages/shared` — contract types exported as `@foundry/shared`
- [x] `packages/generator` — FolderResolver, Generator, Handlebars helpers, validation, zip
- [x] Generator unit tests (own fixtures, not Gamma's blueprint) — 18 tests
- [x] `packages/server` — Express HTTP API per contract + CORS + `AUTH_DISABLED` shim
- [x] Server integration tests — 9 tests
- [x] `docker-compose.yml` (postgres + server + portal-web) + dev docs (`README.md`)

### Gamma — blueprint + frontend
- [x] `blueprints/oauth-server/blueprint.json` (manifest + input schema)
- [x] OAuth Express/TS scaffold templates (token flows, PKCE, strategy branch)
- [x] Postgres schema/migrations, `.env.example`, Dockerfile
- [x] AWS (ECS) IaC skeleton + GitHub Actions workflow
- [x] Integration wiring stubs (conditional on `integrations`)
- [x] Generated `package.json`/`tsconfig` so output builds clean
- [x] `apps/portal-web` — list → dynamic form → generate → download; 400 error surfacing

### Gamma — M1.1 Swagger UI
- [ ] `apiDocs` boolean input added to `blueprint.json`
- [ ] OpenAPI 3 doc (authorize/token endpoints; PKCE params when `pkce` on)
- [ ] `/docs` Swagger UI mounted in `app.ts`, gated on `apiDocs`, `usePkceWithAuthorizationCodeGrant: true`
- [ ] `swagger-ui-express` conditional dep in generated `package.json`
- [ ] Generated README: open `/docs`, run PKCE flow

### Delta — gate
- [x] R2: `npm install` / typecheck / lint / tests pass (30/30)
- [x] R2: Smoke generate→unzip→builds clean + P1 assertions
- [ ] R3: Swagger smoke (`apiDocs` on → `/docs` 200 + PKCE; off → route absent, dep absent)

---

## Handoff log

Append one line per handoff. Format: `YYYY-MM-DD — FROM → TO — what changed / what's next`.

- 2026-06-16 — Alpha → Beta, Gamma — Plan, contracts, and ownership split published in coordination file. Ready to launch coding sessions (Beta first, Gamma in parallel).
- 2026-06-16 — Beta, Gamma → Delta — Both coding sessions reported complete; handed to Delta for the mechanical gate.
- 2026-06-16 — Delta → Alpha — Round 1 ALL PASS (27/27 tests, smoke builds clean). Handed to Alpha for design review.
- 2026-06-16 — Alpha → Beta — Design review complete. One polish item (P1: defaults-before-validation) in Beta's coordination section. Next: `/polish` in Beta → quick `/delta` re-run → wrap up.
- 2026-06-16 — Beta → Delta — P1 polish applied (defaults before validation; +3 tests → 30/30). Handed back to Delta for re-verification.
- 2026-06-16 — Delta → Alpha — Round 2 ALL PASS (30/30, P1 smoke assertions confirmed). M0/M1 core verified.
- 2026-06-16 — Alpha → Gamma — Reviewed P1 (correct) + Delta R2 (green). Scope extended to M1.1: Swagger UI w/ PKCE in the OAuth blueprint. Spec updated; "Gamma Prompt — M1.1" written. Gamma-only round (Beta not engaged). Next: `/gamma` → `/delta` (R3) → Alpha review.
- 2026-06-16 — Gamma → Delta — M1.1 Swagger UI complete (apiDocs input + openapi.ts + gated /docs mount + conditional deps). Self-verified through real generator. Handed to Delta for R3.
- 2026-06-16 — Delta → Alpha — Round 3 ALL PASS (Swagger smoke both ways, no regression). Handed to Alpha.
- 2026-06-16 — Alpha — M1.1 design review complete: clean, contract-respecting, no required changes (one optional non-PKCE-mode note). All scope done & verified. Effort ready for wrap-up on user's signal.

---

## Open questions / blockers

_(Sessions log contract questions or blockers here; Alpha resolves. None open.)_
