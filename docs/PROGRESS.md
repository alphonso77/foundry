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
- ✅ **M2** — Dogfood OAuth: the generated IdP secures the Foundry portal (client-level identity; `AUTH_DISABLED` bypass remains for local/dev).
- ⬜ **M3** — Deploy-from-portal to AWS.
- ⬜ **M4** — New repo per generation; second real blueprint; self-host capstone.

---

## M2 — dogfood OAuth (complete)

The generated IdP now secures the Foundry portal:
- **Portal API** (`packages/server`) verifies real IdP-issued bearer tokens when `AUTH_DISABLED=false`
  (HS256 signature + issuer + `type==='access'`; refresh-as-bearer rejected). `AUTH_DISABLED=true` stays
  the dev default. Verification is **local** — the API never calls the IdP, so a still-valid token works
  even if the IdP is down (the IdP is only needed to *obtain* tokens).
- **Portal SPA** (`apps/portal-web`) runs the auth-code + PKCE flow against the IdP when
  `VITE_OAUTH_ENABLED=true`, stores the access token in `sessionStorage`, attaches it to API calls, and
  re-auths on 401. Because identity is client-level (no login/consent screen), the round-trip is invisible
  — a flash, then the portal renders.
- **IdP** registers the portal as a client via a generic env-driven seed (`SEED_CLIENT_*`), adds the
  protected `GET /oauth/userinfo` showcase endpoint, and drops the hard-to-demo `/oauth/token` doc + PKCE
  recipe from Swagger (the route + Authorize button are unchanged).
- **Harness** `npm run gen:oauth` wires the whole secured loop by default (shared JWT config + seeds
  `foundry-portal`). See **M2 — secured portal loop** under the E2E checklist.

Identity is client-level (`subject = client_id`) — see **M2 security posture** below for the accepted
limitation. Carried-forward M1.5 constraints still hold: refresh tokens are stateless JWT (no server-side
revocation); `redirect_uri` binding is RFC-precise (§4.1.3, required at `/token` only if sent at
`/authorize`); the seeded flow assumes `PORT=3000`.

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

### M2 — secured portal loop (Foundry portal behind the IdP)

Dogfood check: Foundry's own API + SPA secured by a locally-running generated IdP (local-jwt, pkce=true).
Prereq: Postgres up (`docker compose up -d postgres` — just Postgres, not the full topology, which would
grab `:4000`). Three processes:

1. **IdP** — `npm run gen:oauth` → generates + runs the OAuth server on `:3000`, seeds the `foundry-portal`
   client, sets the shared JWT config (harness handles `DATABASE_URL`).
2. **Foundry API, auth armed** — `AUTH_DISABLED=false npm run dev` (`:4000`). `OAUTH_JWT_SECRET` /
   `OAUTH_ISSUER` default to the IdP's values, so no other env is needed.
3. **Foundry SPA, OAuth on** — `VITE_OAUTH_ENABLED=true npm run dev -w @foundry/portal-web` (`:5173`).
   Client id / redirect / IdP-proxy target all default correctly.

**Browser walk:** open `http://localhost:5173` → SPA (no token) redirects to IdP `/oauth/authorize` → IdP
redirects to `/callback?code=…` → SPA exchanges the code (PKCE) for an access token → blueprint list loads
authenticated. The round-trip is invisible (no login/consent screen) — expect a flash, not a login page.
Reload does not re-trigger login (token in `sessionStorage`).

**curl assertions:**

| Assertion | Command | Expect |
|---|---|---|
| No token → 401 | `curl -i localhost:4000/api/blueprints` | 401 + `WWW-Authenticate: Bearer` |
| Garbage token → 401 | `curl -i -H "Authorization: Bearer xxx" localhost:4000/api/blueprints` | 401 |
| Valid token → 200 | mint via the script below | 200 + blueprint list |
| Bypass intact | `AUTH_DISABLED=true npm run dev`, then curl with no token | 200 |

**Mint a valid access token via curl (PKCE) and exercise the API + userinfo:**

```bash
V=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
C=$(printf %s "$V" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
CODE=$(curl -s -i "http://localhost:3000/oauth/authorize?response_type=code&client_id=foundry-portal&redirect_uri=http://localhost:5173/callback&code_challenge=$C&code_challenge_method=S256&state=xyz" \
  | grep -i '^location:' | sed -E 's/.*[?&]code=([^&]+).*/\1/' | tr -d '\r')
TOKEN=$(curl -s -X POST http://localhost:3000/oauth/token \
  -d grant_type=authorization_code -d code=$CODE \
  -d redirect_uri=http://localhost:5173/callback -d client_id=foundry-portal -d code_verifier=$V \
  | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/blueprints   # → blueprint JSON (200)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/oauth/userinfo   # → { sub, client_id, scope }
```

**Diagnosing "it loads the same with or without auth":** the symptoms of *working* (invisible flash; a
cached token keeps the SPA + API working even with the IdP stopped — verification is local) overlap with
*not engaged*. To disambiguate: (a) `curl -i localhost:4000/api/blueprints` must be **401**; (b) in the
browser, `sessionStorage.clear()` then reload with the Network tab open — a real `/oauth/authorize` →
`/callback` → `/oauth/token` round-trip means it's working; no `/oauth/authorize` request means
`VITE_OAUTH_ENABLED` isn't reaching Vite.

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

---

## M2 security posture (accepted limitation — not a defect)

M2 dogfoods the OAuth blueprint in front of the portal as a **structural milestone, not a security
boundary.** Identity is client-level (`subject = client_id`); the IdP has no per-user login or consent
step, and the portal is a public PKCE client. The flow therefore authenticates the *token* but not the
*caller*: anyone who knows a valid `client_id` plus one of its registered (public) `redirect_uri`s can
run the flow and mint a valid token. PKCE doesn't prevent this — it binds a code to whoever started the
flow, but anyone can start one with their own verifier/challenge.

- **What M2 secures:** forged tokens (HS256 signature + issuer + `type`/expiry are verified) and the
  previously wide-open `AUTH_DISABLED` door.
- **The real fix (deferred to the next milestone):** user authentication + consent at `/authorize`, so a
  token's `sub` is an authenticated user and running the flow yields tokens only for whoever logs in.
- **Also deferred:** symmetric HS256 couples portal and IdP to a shared secret; the documented upgrade is
  RS256 + a JWKS endpoint on the IdP.
