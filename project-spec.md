# Foundry — Spec

**Status:** Prototype
**Owner:** Fratelli Software

## Summary

Foundry is a web-based developer portal for bootstrapping production-ready Node.js / Express APIs. Developers pick a **blueprint**, configure it through the UI, and Foundry generates a working, deployable service on AWS.

## Goals

- Go from "I need an X service" to a running, deployed API in minutes, not days.
- Encode opinionated, battle-tested defaults (auth, structure, CI/CD, observability) into reusable blueprints.
- Keep generated code readable and owned by the developer — no lock-in, no magic runtime.

## Non-Goals (for prototype)

- No multi-language support (Node.js / Express only).
- No GUI-based ongoing management of deployed services after generation.
- No billing, teams, or org/permission model.

## Core Concepts

| Term | Meaning |
|------|---------|
| **Blueprint** | A configurable template for a service type (e.g. OAuth Server). Defines inputs, generated code, and deploy target. |
| **Generation** | The act of turning a configured blueprint into a project. |
| **Deployment** | Pushing a generated project to AWS. |

## User Flow

1. Developer opens Foundry portal.
2. Selects a blueprint (e.g. **OAuth Server**).
3. Fills in config (name, integrations, options) via a form.
4. Foundry generates the project (source + IaC + CI/CD).
5. Developer reviews, then deploys to AWS (or downloads the repo).

## First Blueprint: OAuth Server

An OAuth 2.0 / OIDC identity provider scaffold.

**Config inputs (proposed):**
- Service name
- Token strategy (local JWT generation vs. external IdP backing)
- PKCE support (on/off)
- Integrations to wire up (Stripe, Salesforce, HubSpot, …)
- Datastore (PostgreSQL default)
- API docs (Swagger UI) — on/off (default on; lets the docs route be disabled in production)

**Generates:**
- Express app with access/refresh token flows + PKCE
- Postgres schema + migrations
- `.env` template + secrets wiring
- Dockerfile + AWS deploy config (IaC)
- CI/CD pipeline (GitHub Actions)
- OpenAPI 3 spec + Swagger UI at `/docs`, with the OAuth2 Authorization Code + **PKCE** flow pre-wired (Swagger UI's built-in PKCE, `usePkceWithAuthorizationCodeGrant`) so the token/PKCE flow is exercisable in-browser — not just documented. Gated on the API-docs input.

## Architecture (high level)

```
Portal (web UI)
   │  blueprint + config
   ▼
Generator service  ──►  Generated project (source + IaC + CI/CD)
   │
   ▼
AWS deploy
```

- **Portal** — web frontend; lists blueprints, renders config forms.
- **Generator** — takes a blueprint + config, emits a project (templating engine over blueprint definitions).
- **Blueprints** — stored as plain directories in the foundry repo (`foundry/blueprints/<name>/`), versioned by foundry's own git history. No nested git, no submodules.
- **Deploy** — provisions/ships the generated service to AWS.

### Blueprint manifest (abstraction boundary)

Every blueprint declares a `blueprint.json` manifest: input schema, file list, and deploy target. **The generator only ever talks to the manifest** — never to the storage layout directly.

This keeps storage swappable: today blueprints are folders in-repo; later they can move to git-ref resolution or published packages without touching the generator, as long as the manifest contract holds.

### Generator / Blueprint contract

The generator depends on a `BlueprintResolver` interface, not on storage. Each storage backend is one implementation of that interface; all of them return the same normalized data shapes. This is the ports-and-adapters boundary that makes storage swappable.

```typescript
interface BlueprintResolver {
  list(): Promise<BlueprintSummary[]>;                          // what blueprints exist
  getManifest(id: string, version?: string): Promise<BlueprintManifest>;  // input schema, files, deploy target
  getFiles(id: string, version?: string): Promise<BlueprintFile[]>;       // the template bytes
}

interface BlueprintSummary {
  id: string;
  name: string;
  description: string;
}

interface BlueprintManifest {
  id: string;
  name: string;
  version: string;
  inputs: InputSchema;        // fields the portal renders + the generator validates against
  files: string[];            // relative file ids only — never absolute paths
  deployTarget: string;       // named target (e.g. "aws-ecs"), resolved elsewhere
}

interface BlueprintFile {
  path: string;               // relative output path
  contents: string;           // template source
}
```

The generator's only job: `getManifest` → validate user config against `inputs` → `getFiles` → run the template engine → emit the project. None of those steps reference folders, git, or npm.

Storage backends implement the interface independently:

```typescript
class FolderResolver  implements BlueprintResolver { /* reads foundry/blueprints/<id>/ */ }
class GitRefResolver  implements BlueprintResolver { /* degit/clone at a tag */ }
class PackageResolver implements BlueprintResolver { /* resolves @fratelli/blueprint-* */ }
```

Swapping storage is a wiring change, not a code change:

```typescript
const resolver = config.blueprintSource === 'git'
  ? new GitRefResolver(...)
  : new FolderResolver(...);
const generator = new Generator(resolver);   // generator unchanged
```

**Contract rules (so the abstraction actually holds):**

- The manifest must be **storage-agnostic** — files addressed by relative id, deploy targets by name. Nothing in it may imply *where* the blueprint lives (no absolute paths, no git URLs). A leaked storage detail is what breaks the swap.
- The **resolver owns versioning**, not the generator. The generator passes `version` through; each backend interprets it (`FolderResolver` ignores it, `GitRefResolver` maps it to a git tag, `PackageResolver` to a SemVer range).

## Tech Stack (proposed)

- **Backend:** Node.js / TypeScript / Express
- **Datastore:** PostgreSQL
- **Templating:** TBD (e.g. Handlebars / EJS / custom)
- **Generated-output IaC:** TBD (Terraform / CDK / Serverless) — the infra blueprints emit. Distinct from portal infra (see Portal Infrastructure).
- **CI/CD:** GitHub Actions

## Portal Infrastructure

How **Foundry itself** is provisioned and deployed — distinct from the IaC that blueprints emit. Two separate concerns that are easy to conflate:

- **Generated-output IaC** — infra that ships *inside* a generated project so the developer can deploy their new service.
- **Portal IaC** — infra that runs *Foundry*: the portal frontend, the generator service, its Postgres, secrets, and the container host.

**Prototype stance: local-Docker-first.** At M0–M1 Foundry runs via `docker compose` locally — portal + generator + Postgres, with OAuth bypassed in dev (see Decisions). No cloud portal infra is required to build and demo the prototype.

**When it needs real infra:** the moment Foundry must be reachable by anyone other than the author, it needs its own deploy story — container host, managed Postgres, secrets management, and OAuth enabled. This is its own IaC, owned separately from any blueprint.

**Future direction — self-hosting via blueprint:** Foundry is itself a Node/Express app with Postgres and OAuth — exactly what its blueprints produce. A self-host blueprint is the *capstone*, not an early goal: it's extracted from Foundry's own proven, hand-built AWS deploy once that's known-good — a distillation of working reality, not a guess. Note the bootstrap paradox: the first Foundry can't be generated by a blueprint (blueprints need a running generator), so it's hand-built, and its first deploy is applied out-of-band; only after that is the AWS portal self-sustaining via its repo's CI/CD. See Blueprint Sequencing.

## Decisions

- **Blueprint storage/versioning:** Plain directories in the foundry repo, versioned with foundry. Defer independent versioning (git-ref or packages) until there's a real need.
- **Generator output:** Download-only repo first. Deploy-from-portal **shipped in M3** — host-side terraform/docker pipeline to ECS/Fargate, PoC-grade (see `docs/PROGRESS.md` → M3). New-repo-per-generation is still later.
- **Generated code location:** Single-output download first. New-repo-per-generation later if time allows.
- **Portal auth:** Dogfood the OAuth blueprint to secure the portal — but support a dockerized local/dev mode that bypasses OAuth entirely (e.g. an `AUTH_DISABLED` / local-dev flag) so the portal runs without an IdP in development.
- **M2 is a structural / dogfooding milestone, not a security boundary.** Identity is client-level (`subject = client_id`); the IdP has no per-user login or consent step and the portal is a public PKCE client. So the flow authenticates the *token* but not the *caller*: anyone who knows a valid `client_id` plus one of its registered (public) `redirect_uri`s can run the flow and mint a valid token. PKCE does not prevent this — it binds a code to whoever started the flow, but anyone can start one with their own verifier/challenge. What M2 *does* secure: forged tokens (HS256 signature + issuer + `type`/expiry are verified) and the previously wide-open `AUTH_DISABLED` door. **The real fix — user authentication + consent at `/authorize`, so a token's `sub` is an authenticated user — is deferred to the next milestone.** (Symmetric HS256 also couples portal and IdP to a shared secret; the documented upgrade is RS256 + a JWKS endpoint, likewise deferred.)

## Blueprint Sequencing

Order is deliberate: each blueprint validates one thing, simplest/known-good first, hardest/most-recursive last.

1. **OAuth Server** — proves the generation loop works. Self-contained, production-proven artifact whose output is easy to verify.
2. *(optional)* **Bare Express API** — even simpler generator smoke-test, if useful to isolate the loop from OAuth's complexity.
3. **Second real blueprint** — proves the abstraction generalizes past one example.
4. **Foundry self-host** — capstone. Proves the platform can produce and deploy itself; extracted from Foundry's proven hand-built deploy (see Portal Infrastructure).

Rationale: a first blueprint should validate generation in isolation, not conflate it with deploy and novel infra. Self-host is the forcing function you build *toward*, with the OAuth server as the rung that gets you off the ground.

## Milestones

1. **M0** — OAuth Server blueprint generates a working project locally; single-output download. Generator reads from the blueprint manifest.
2. **M1** — Portal UI: select blueprint → configure → generate → download. Portal runs in dockerized local/dev mode with auth bypassed. The generated OAuth project ships an interactive Swagger UI (`/docs`) with the PKCE flow pre-wired, so a developer can exercise the token + PKCE flows in-browser immediately after generating.
3. **M2** — Dogfood OAuth: secure the portal with the OAuth blueprint (bypass flag remains for local/dev).
4. **M3** — Deploy-from-portal to AWS.
5. **M4** — New repo per generation; second real blueprint (proves the abstraction generalizes); self-host blueprint as the eventual capstone (see Blueprint Sequencing).