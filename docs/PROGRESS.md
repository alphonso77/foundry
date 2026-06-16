# Foundry — Spec Tracking

Detailed feature-level status against [`project-spec.md`](../project-spec.md). Top-level milestone checkboxes live in [`README.md`](../README.md#status).

---

## M0 / M1 — Feature Coverage

### OAuth Server blueprint — config inputs

| Spec input | Key | Implemented |
|------------|-----|-------------|
| Service name | `serviceName` | ✅ |
| Token strategy (local-JWT vs. external IdP) | `tokenStrategy` | ✅ |
| PKCE support | `pkce` | ✅ |
| Integrations (Stripe, Salesforce, HubSpot) | `integrations` | ✅ |
| Datastore (PostgreSQL) | `datastore` | ✅ |
| API docs / Swagger UI | `apiDocs` | ✅ |

### OAuth Server blueprint — generated output

| Spec output | Implemented |
|-------------|-------------|
| Express app — access/refresh token flows + PKCE | ✅ |
| Postgres schema + migrations | ✅ |
| `.env` template + secrets wiring | ✅ |
| Dockerfile + AWS ECS deploy config (Terraform) | ✅ |
| CI/CD pipeline (GitHub Actions) | ✅ |
| OpenAPI 3 spec + Swagger UI at `/docs`; PKCE pre-wired (`usePkceWithAuthorizationCodeGrant`) | ✅ |

### Portal

| Spec requirement | Implemented |
|------------------|-------------|
| List blueprints | ✅ |
| Dynamic config form driven by `InputSchema` | ✅ |
| Generate → download ZIP | ✅ |
| Dockerized local dev (`docker compose up`) | ✅ |
| Auth bypass for local/dev (`AUTH_DISABLED=true`) | ✅ |
| 400 error surfacing on invalid config | ✅ |

### Generator / architecture

| Spec requirement | Implemented |
|------------------|-------------|
| `BlueprintResolver` interface (`list`, `getManifest`, `getFiles`) | ✅ `packages/shared` |
| `FolderResolver` — reads `blueprints/<id>/` | ✅ `packages/generator` |
| `Generator` — validate config → Handlebars template → ZIP | ✅ `packages/generator` |
| Handlebars helpers: `ifEquals`, `ifIncludes`, `kebabCase`, `pascalCase`, `camelCase` | ✅ `packages/generator/src/helpers.ts` |
| Defaults applied before required-field validation | ✅ |
| `.hbs` suffix stripped on emit; all other files copied verbatim | ✅ |
| HTTP API: `GET /api/blueprints`, `GET /api/blueprints/:id`, `POST /api/generate` | ✅ `packages/server` |
| `GitRefResolver` | ⬜ Not started (deferred per spec decision) |
| `PackageResolver` | ⬜ Not started (deferred per spec decision) |

### Tests

| Suite | Count | Status |
|-------|-------|--------|
| Generator (FolderResolver, Generator, validation, helpers) | ~25 | ✅ |
| Server (all HTTP endpoints) | ~16 | ✅ |
| Portal (`apps/portal-web`) | — | ⬜ None yet |

---

## Spec decisions — implementation status

| Decision | Spec stance | Implemented |
|----------|-------------|-------------|
| Blueprint storage | Plain dirs in-repo, versioned with foundry | ✅ `FolderResolver` |
| Generator output | Download-only ZIP first | ✅ |
| Generated code location | Single-output download first | ✅ |
| Portal auth | `AUTH_DISABLED` bypass for local/dev | ✅ |
| Independent blueprint versioning (git-ref / packages) | Deferred until real need | ⬜ Deferred |
| Deploy-from-portal | Later phase | ⬜ M3 |
| New-repo-per-generation | Later phase | ⬜ M4 |

---

## Blueprint sequencing — spec vs. reality

| Step | Spec | Status |
|------|------|--------|
| 1. OAuth Server | Proves the generation loop works | ✅ |
| 2. Bare Express API *(optional)* | Generator smoke-test without OAuth complexity | ⬜ Not started |
| 3. Second real blueprint | Proves the abstraction generalizes past one example | ⬜ Not started |
| 4. Foundry self-host *(capstone)* | Extracted from proven hand-built AWS deploy | ⬜ Not started |
