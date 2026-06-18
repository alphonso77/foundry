# Foundry — Demo Guide

How to run Foundry locally and walk each demo. Targets the **current state of the tree**
(M0–M2 complete + M3 deploy built/verified-dry-run). The single-`docker compose up` unification
and the deploy build-strategy work are **deferred follow-ons** — not reflected here.

---

## 1. Topology

Foundry is three processes (plus the generated/deployed services they produce):

| Process | Port | How it's started (current state) |
|---------|------|----------------------------------|
| **Postgres** | 5432 | `docker compose up -d postgres` (container; backs generated servers + the dev-loop) |
| **Foundry API** | 4000 | `npm run dev` (host-side; Express + generator + deploy executor) |
| **Foundry SPA** | 5173 | `npm run dev -w @foundry/portal-web` (host-side; Vite) |
| *(M2 only)* **Generated IdP** | 3000 | `npm run gen:oauth` (host-side; the OAuth server, used to secure the portal) |

**Recommended local workflow (what you'll use going forward):**
> `docker compose up -d postgres` for the database, then run the **API** and **SPA** directly
> from the host. The Postgres container mounts only its own data volume — it never touches the
> repo or `node_modules`, so the host and container stay completely independent (see Note A).

There are two *other* ways to run things, both still supported:
- **Full `docker compose up`** — runs Postgres + API + SPA all in containers, auth bypassed. Quick
  click-around, but see Note A before mixing it with host-side runs.
- **`npm run gen:oauth`** — a one-command dev-loop harness that generates the OAuth blueprint into
  `.scratch/`, installs, `db:init`s, and runs it. Used by the dev-loop demo and the M2 loop.

### Prerequisites (verified on this machine ✓)

| Tool | Needed for | Status |
|------|------------|--------|
| Node + npm | everything | ✓ |
| Docker (daemon running) | Postgres; AWS deploy image build | ✓ `docker 27.5.1`, daemon up |
| Terraform | AWS deploy | ✓ `v1.15.6` |
| AWS CLI v2 | AWS deploy (ECR login) | ✓ `2.35.7` |
| AWS credentials | AWS deploy | **you provide** — see Demo A |

### Note A — host vs container `node_modules`

- **Your recommended workflow is safe today.** `docker compose up -d postgres` starts only the
  Postgres container, which mounts no repo files — so it can never overwrite the host's
  `node_modules`. Host-side `npm run dev` uses the host's (macOS/arm64) install. No conflict.
- **The full-stack `docker compose up` is *not* yet bulletproof.** Compose's anonymous-volume trick
  covers only the **root** `node_modules`, not the nested `apps/portal-web/node_modules`; a
  container `npm install` there leaks **linux** binaries onto the host (and a host install leaks
  darwin into the container). A one-line `docker-compose.yml` fix
  (`- /app/apps/portal-web/node_modules`) closes this — it's captured as a pending polish item.
  Until it lands, avoid mixing full-stack compose with host-side runs.

---

## 2. Demos available

| # | Demo | What it shows | Status |
|---|------|---------------|--------|
| **A** | **Deploy to AWS** | Portal **Deploy** button → real ECS/Fargate + ALB + Postgres sidecar; live `/docs` at an AWS URL; **Teardown** | **Built + dry-run-verified; ready for first live apply** |
| B | Generate + download | Pick blueprint → config form → **Generate & download** a buildable project zip | Proven |
| C | Dev-loop harness | `npm run gen:oauth` → generate→install→db:init→run in one command (`.scratch/`) | Proven |
| D | Secured portal loop (M2) | Portal + API secured by the generated IdP (auth-code + PKCE, client-level identity) | Proven |

---

## 3. Demo steps

### Demo A — Deploy to AWS *(your priority; not yet run live)*

Provisions a real, reachable OAuth service on your AWS account from the portal, then tears it down.

**Prereqs**
- `terraform`, `aws`, `docker` installed (✓) and **Docker Desktop running** (✓).
- **AWS credentials available to the API process.** Either run `aws configure` once (writes
  `~/.aws/credentials`), or export `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the *same shell*
  that starts the API. Root-user keys are fine for a PoC.
- Ensure `DEPLOY_DRY_RUN` is **not** set to `true` (default is live).

**Steps**
1. *(Optional)* `docker compose up -d postgres` — not required for deploy (the API/generator open no
   DB), but harmless if it's your standard setup.
2. Start the API host-side with creds visible:
   ```bash
   aws configure                       # once, OR export the two keys in this shell
   npm run dev                         # API on :4000
   ```
   Confirm the startup banner ends with **`deploy live`** (not `deploy DRY-RUN`).
3. Start the SPA host-side:
   ```bash
   npm run dev -w @foundry/portal-web  # :5173
   ```
4. Open `http://localhost:5173` → select **OAuth Server** → fill the config (set a `serviceName`) →
   set **Region** (default `us-east-1`) → click **Deploy to AWS**.
5. Watch the Deployment panel walk the phases — streaming logs at each step:
   `generating → tf-init → provisioning (ECR) → building → pushing → deploying → succeeded`.
6. On **succeeded**, the panel shows the ALB URL. Give the ECS task **~1–3 min** to pull images,
   start, and pass ALB health checks, then open the URL and hit **`/docs`** (Swagger UI served from
   AWS) — and `/health`.
7. **Teardown:** click **Teardown** → `destroying → destroyed`. Confirm in the AWS console that the
   ECS service, ALB, ECR repo, log group, IAM role, and security groups are gone (so you don't burn
   credits — the ALB + Fargate accrue cost while running).

**Architecture note — arm64 build → ARM Fargate (the fix).** Your machine is **arm64**, so the
executor's `docker build` produces a native **arm64** image. To match it, the generated Fargate task
runs on **ARM64** — a `runtime_platform { operating_system_family = "LINUX", cpu_architecture =
"ARM64" }` block in the task definition. Native build, **no QEMU emulation**, so the image builds
fast and the task starts cleanly. (`node:20-alpine` and `postgres:16-alpine` are both multi-arch;
ARM Fargate is supported in us-east-1.)

> **Note — the arm64 fix is included by default.** The `runtime_platform` block ships in the
> generated task definition (`blueprints/oauth-server/template/infra/main.tf.hbs`), so no extra step
> is needed. **Without it**, the task def would default to **linux/x86_64**, the arm64 image wouldn't
> run (`exec format error` in CloudWatch, ALB targets never become healthy), and the deploy would
> reach `succeeded` but the URL would never serve.

**Where Terraform state lives:** each deploy writes to `<tmpdir>/foundry-deploys/<id>/infra`
(override with `DEPLOY_WORKDIR_ROOT`). Teardown reads that workdir's `meta.json`, so don't clear
your temp dir between deploy and teardown.

---

### Demo B — Generate + download a project

1. Start the API and SPA host-side (auth bypassed by default):
   ```bash
   npm run dev                         # :4000
   npm run dev -w @foundry/portal-web  # :5173
   ```
2. Open `http://localhost:5173` → select **OAuth Server** → the config form renders from the
   blueprint's input schema.
3. *(Optional)* Submit an invalid config (e.g. blank `serviceName`) → a **400** surfaces inline.
4. Fill a valid config → **Generate & download** → a `<serviceName>.zip` downloads.
5. Bring the generated server up:
   ```bash
   unzip <serviceName>.zip -d <serviceName> && cd <serviceName>
   npm install
   cp .env.example .env
   # set DATABASE_URL to the compose Postgres:
   #   postgres://foundry:foundry@localhost:5432/<db>
   npm run db:init
   PORT=3000 npm run dev
   ```
6. Open `http://localhost:3000/docs` → exercise the OAuth Authorize → token (PKCE) flow in Swagger.

---

### Demo C — Dev-loop harness (`gen:oauth`)

Fast inner loop: generate → install → `db:init` → run, in one command (skips the UI).

1. `docker compose up -d postgres`
2. `npm run gen:oauth` → generates the OAuth blueprint into `.scratch/`, installs, `db:init`s
   against the compose Postgres, and boots on `:3000`. The banner prints the `/docs` URL + seeded
   `client_id`. (Flags: `npm run gen:oauth -- --help` — `--no-db`, `--no-run`, reuse, config
   overrides.)
3. Open the printed `/docs` URL → run the OAuth flow in Swagger.

---

### Demo D — Secured portal loop (M2)

Foundry's own API + SPA secured by a locally-running generated IdP (client-level identity).

1. `docker compose up -d postgres`
2. **IdP:** `npm run gen:oauth` → OAuth server on `:3000`, seeds the `foundry-portal` client, sets
   the shared JWT config.
3. **API (auth armed):** `AUTH_DISABLED=false npm run dev` → `:4000`. (`OAUTH_JWT_SECRET` /
   `OAUTH_ISSUER` default to the IdP's values — no extra env needed.)
4. **SPA (OAuth on):** `VITE_OAUTH_ENABLED=true npm run dev -w @foundry/portal-web` → `:5173`.
5. Open `http://localhost:5173`: the SPA (no token) redirects to the IdP `/oauth/authorize` →
   `/callback?code=…` → exchanges the code (PKCE) for an access token → the authenticated blueprint
   list loads. No login/consent screen — expect a **flash**, not a login page. Reload doesn't
   re-trigger login (token in `sessionStorage`). The **token-status** indicator (key icon) dogfoods
   `/oauth/userinfo`.

**Disambiguate "working" vs "not engaged":** `curl -i localhost:4000/api/blueprints` must be **401**
without a token; in the browser, `sessionStorage.clear()` then reload with the Network tab open — a
real `/oauth/authorize → /callback → /oauth/token` round-trip means it's working.
