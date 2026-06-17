# Foundry — Spec Tracking

Milestone × capability status against [`project-spec.md`](../project-spec.md).
**[`README.md`](../README.md#status)** holds the milestone checkboxes; **this file** tracks what
works per milestone; **the code + [`CLAUDE.md`](../CLAUDE.md)** are the source of truth for *how*.
Implementation mechanics (file paths, test counts, helper names) are deliberately omitted here —
they live in the code and go stale when mirrored.

---

## Milestones

- ✅ **M0** — OAuth blueprint generates a buildable project; single-output ZIP download. Generator reads from the blueprint manifest.
- ✅ **M1** — Portal UI: list → configure → generate → download; dockerized local dev (auth bypassed). Generated project ships an interactive Swagger UI (`/docs`) with PKCE pre-wired.
- ✅ **M1.5 — M2 enablement** — the generated OAuth server is a functionally-complete, Postgres-persisted authorization-code + PKCE IdP; a one-command dev-loop harness (`npm run gen:oauth`) collapses generate → install → `db:init` → run.
- ⬜ **M2** — Dogfood OAuth: secure the portal with the OAuth blueprint (bypass flag remains for local/dev).
- ⬜ **M3** — Deploy-from-portal to AWS.
- ⬜ **M4** — New repo per generation; second real blueprint; self-host capstone.

---

## Next: M2 (dogfood OAuth) — entry notes for a future session

M1.5 left the generated OAuth server as a verified, standalone IdP. **M2 wires it in front of the
Foundry portal.** A future session can pick up from here:

**How to start.** Run `/alpha` (latest Opus). It reads the coordination file (currently "No active
effort") + this doc, then writes the M2 session plan into coordination — that's where session
prompts belong, not here. The M1.5 work landed on branch `m1.5-idp`.

**Open seam (the main thing M2 builds).** The generated server seeds exactly one dev client whose
`redirect_uri` is Swagger-only (`http://localhost:3000/docs/oauth2-redirect.html`). M2 must register
the **portal** as its own OAuth client with the portal's own callback. The seed is a single `INSERT`
block in `blueprints/oauth-server/template/src/db/schema.sql.hbs` — easy to extend (add a row, an
env-driven seed, or a register step).

**Constraints to carry in (not obvious from a quick read):**
- Refresh tokens are **stateless JWT** — no server-side revocation. "Log out everywhere" needs the
  stateful-refresh work that was deliberately deferred (the `refresh_tokens` table was dropped).
- `subject = client_id` — there is **no per-user login/consent**. M2's dogfood must not depend on
  per-user identity; it secures the portal at the client / single-principal level.
- `redirect_uri` binding is RFC-precise (§4.1.3): required at `/token` only if it was sent at
  `/authorize`.
- The seeded flow assumes `PORT=3000` (the seed `redirect_uri` hardcodes it).

**Verify like a user, not just curl.** Two M1.5 bugs (a missing `/token` schema field; over-strict
`redirect_uri`) passed the curl checklist but only surfaced in the browser. Run the **E2E checklist
below in Swagger UI**, not just via curl.

**Where the pieces are.** Generated IdP: `blueprints/oauth-server/**`. The portal/server seam where a
real auth check slots in: `packages/server/src/auth.ts` (the `AUTH_DISABLED` branch). Dev-loop:
`npm run gen:oauth`.

---

## Capability coverage (vs spec)

### OAuth Server blueprint
- **Config inputs** ✅ — all six: `serviceName`, `tokenStrategy` (local-jwt | external-idp), `pkce`, `integrations` (Stripe / Salesforce / HubSpot), `datastore`, `apiDocs`.
- **Generated output** ✅
  - Express app with a **persisted authorization-code + PKCE flow** — redirect-based `/authorize` (client + `redirect_uri` validation, `state` echo), one-time codes, `/token` exchange with PKCE verification and `redirect_uri` match, refresh that preserves scope, RFC 6749 §5.1 snake_case token bodies. (`local-jwt` strategy; `external-idp` exchange is a documented stub.)
  - Postgres schema + `db:init` (drop / create / migrate / seed a dev client).
  - `.env` template + secrets wiring.
  - Dockerfile.
  - Terraform IaC, `aws-ecs` deploy target — this is *generated-output* IaC (ships inside the project), distinct from M3 portal deploy.
  - GitHub Actions CI.
  - OpenAPI 3 spec + Swagger UI at `/docs`, PKCE pre-wired and exercisable in-browser (gated on `apiDocs`).

### Portal ✅
List blueprints · dynamic config form driven by `InputSchema` · generate → download ZIP · dockerized local dev (`docker compose up`) · auth bypass (`AUTH_DISABLED=true`) · 400 surfacing on invalid config.

### Generator / architecture ✅
`BlueprintResolver` port (`list` / `getManifest` / `getFiles`) · `FolderResolver` storage backend · validate config → Handlebars → ZIP · defaults applied before required-field validation · `.hbs` rendered + suffix-stripped, other files copied verbatim · HTTP API (`/api/blueprints`, `/api/blueprints/:id`, `/api/generate`).

### Dev tooling (M1.5) ✅
`npm run gen:oauth` — generate the OAuth blueprint into a gitignored scratch dir, install, `db:init` against the compose Postgres, and run. Flags for reuse / no-db / no-run / config overrides (`-- --help`). Dev-only; drives the generator programmatically (never reaches into blueprint storage).

---

## E2E verification checklist

Two ways to exercise Foundry end-to-end. **Path A** is the product loop a real user walks;
**Path B** is the fast inner loop for iterating on the blueprint. Both end in the same
**OAuth flow assertions**.

### Path A — full product loop (portal → generate → run → authenticate)
1. `cp .env.example .env && docker compose up` → portal (`:5173`), API (`:4000`), Postgres (`:5432`) all up.
2. Open `http://localhost:5173` → blueprint list shows **OAuth Server**.
3. Select it → config form renders from the blueprint's `InputSchema` (all six inputs).
4. Submit an invalid config (e.g. blank `serviceName`) → **400 surfaced in the UI**.
5. Fill a valid config → **Generate** → ZIP downloads.
6. Unzip → `npm install` → `cp .env.example .env` → set `DATABASE_URL` to the compose Postgres (`postgres://foundry:foundry@localhost:5432/<db>`) → `npm run db:init` → `npm run dev` (on `PORT=3000`).
7. Open `/docs` → run the **OAuth flow assertions** below in Swagger UI (Authorize → redirect → token).

### Path B — dev-loop harness (fast iteration)
1. Compose Postgres up (`docker compose up`, or just the `postgres` service).
2. `npm run gen:oauth` → generates, installs, `db:init`, boots on `:3000`. The banner prints the `/docs` URL and the seeded `client_id`.
3. Run the **OAuth flow assertions** below.

### OAuth flow assertions (default config: local-jwt, pkce=true, apiDocs=true)
Against the generated server on `PORT=3000` with the seeded dev client (`<serviceName>-client`).

1. **Build:** generated project `npm install` + `npx tsc --noEmit` → clean.
2. **db:init:** drops / creates / migrates and seeds the dev client; idempotent on re-run.
3. **Authorize:** `GET /oauth/authorize?response_type=code&client_id=<seeded>&redirect_uri=<registered>&code_challenge=<S256>&code_challenge_method=S256&state=xyz` → `302` to `redirect_uri` with `?code=…&state=xyz`.
4. **Authorize rejects bad input:** unknown `client_id` → 400 `invalid_client`; unregistered `redirect_uri` → 400 (no redirect); missing `code_challenge` → redirect with `error=invalid_request`.
5. **Token exchange:** `POST /oauth/token` (`grant_type=authorization_code`, `code`, `code_verifier`, matching `redirect_uri`) → `200` with snake_case `access_token` / `refresh_token` / `token_type: Bearer` / `expires_in`.
6. **One-time + expiry:** replaying a `code` → 400 `invalid_grant`; expired `code` → 400 `invalid_grant`. (A code is consumed on *any* token attempt, including ones that then fail PKCE / `redirect_uri` — by design.)
7. **PKCE enforced:** wrong `code_verifier` → 400 `invalid_grant`.
8. **Refresh:** `grant_type=refresh_token` → new tokens, original scope preserved. An access token replayed as a refresh token → 400 `invalid_grant` (token-type guard).
9. **Token verifiable:** access token verifies against the server's secret + issuer.
10. **Swagger smoke:** `/docs` loads; the seeded client + PKCE flow is exercisable in-browser.

---

## Deferred / not yet started

- **Portal automated tests** — none yet.
- **`GitRefResolver` / `PackageResolver`** — deferred per spec decision (blueprints stay in-repo until a real need).
- **Bare Express API blueprint** (optional generator smoke-test) — not started.
- **Second real blueprint** (proves the abstraction generalizes) — M4.
- **Foundry self-host blueprint** (capstone) — M4.
- **Deploy-from-portal** — M3.
- **New-repo-per-generation** — M4.

---

## Spec decisions — status

| Decision | Spec stance | Status |
|----------|-------------|--------|
| Blueprint storage | Plain dirs in-repo, versioned with foundry | ✅ `FolderResolver` |
| Generator output | Download-only ZIP first | ✅ |
| Generated code location | Single-output download first | ✅ |
| Portal auth | `AUTH_DISABLED` bypass for local/dev | ✅ (real OAuth = M2) |
| Refresh-token strategy | — | ✅ Stateless JWT — no server-side revocation (deliberate prototype choice; revisit when a real principal model lands) |
| Independent blueprint versioning (git-ref / packages) | Deferred until real need | ⬜ Deferred |
| Deploy-from-portal | Later phase | ⬜ M3 |
| New-repo-per-generation | Later phase | ⬜ M4 |
