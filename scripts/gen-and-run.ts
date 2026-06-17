/**
 * gen-and-run — Foundry dev-loop harness (DEV ONLY).
 *
 * Collapses the manual "generate → install → db:init → run" loop into one
 * command so blueprint templates can be iterated on cheaply. It drives the
 * generator *programmatically* (no running Foundry API needed), emits the
 * `oauth-server` blueprint into a gitignored scratch dir, points it at the
 * compose Postgres, and boots it.
 *
 * This is a developer tool. It is NOT a portal feature and is never wired into
 * the server or docker-compose runtime.
 *
 *   npm run gen:oauth                      # clean regen, default config, then run
 *   npm run gen:oauth -- serviceName=acme  # override config
 *   npm run gen:oauth -- pkce=false integrations=stripe,hubspot
 *   npm run gen:oauth -- --reuse           # keep node_modules, skip reinstall
 *   npm run gen:oauth -- --no-run          # generate + install only (e.g. for tsc)
 *   npm run gen:oauth -- --no-db --no-run  # just generate + install (no Postgres needed)
 *
 * The acceptance loop (per coordination.md) is: generate → npm install →
 * npx tsc --noEmit → Flow Checklist. This harness is the "generate → … → run"
 * part of that loop.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Generator, FolderResolver, kebabCase } from '@foundry/generator';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const BLUEPRINTS_DIR = join(REPO_ROOT, 'blueprints');
const BLUEPRINT_ID = 'oauth-server';

// Default DB target = the compose Postgres (see docker-compose.yml). The
// generated server reads DATABASE_URL and falls back to its own default if
// unset; we always set it so the harness is self-contained.
const DEFAULT_PG = 'postgres://foundry:foundry@localhost:5432';
const DEFAULT_SERVICE_NAME = 'dev-oauth';
const DEFAULT_PORT = 3000; // matches the blueprint's seeded Swagger redirect URI

// ── Portal dogfood (M2) defaults ─────────────────────────────────────────────
// The shared JWT signing config the Foundry portal API also defaults to (see
// packages/server/src/config.ts) — the IdP and the portal must agree on these
// for the portal to verify IdP-issued tokens. They equal the blueprint's own
// config.ts.hbs defaults; we set them explicitly so the seam is visible.
const SHARED_JWT_SECRET = 'dev-secret-change-me';
const SHARED_OAUTH_ISSUER = 'https://auth.example.com';
// The IdP registers Foundry's portal as an OAuth client via the env-driven seed
// (SEED_CLIENT_* — Beta's db-init feature). PKCE public client, Vite dev origin.
const PORTAL_CLIENT_ID = 'foundry-portal';
const PORTAL_REDIRECT_URIS = 'http://localhost:5173/callback';

interface Options {
  out: string;
  port: number;
  dbUrl?: string;
  reuse: boolean;
  install: boolean;
  db: boolean;
  run: boolean;
  portalClient: boolean;
  config: Record<string, unknown>;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    out: join(REPO_ROOT, '.scratch', BLUEPRINT_ID),
    port: DEFAULT_PORT,
    reuse: false,
    install: true,
    db: true,
    run: true,
    portalClient: true,
    config: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '-r':
      case '--reuse':
        opts.reuse = true;
        break;
      case '--no-install':
        opts.install = false;
        break;
      case '--no-db':
        opts.db = false;
        break;
      case '--no-run':
        opts.run = false;
        break;
      case '--no-portal-client':
        opts.portalClient = false;
        break;
      case '--out':
        opts.out = resolve(REPO_ROOT, requireValue(arg, argv[++i]));
        break;
      case '--port':
        opts.port = Number(requireValue(arg, argv[++i]));
        break;
      case '--db-url':
        opts.dbUrl = requireValue(arg, argv[++i]);
        break;
      default:
        if (arg.startsWith('-')) {
          fail(`Unknown flag: ${arg}\nRun with --help for usage.`);
        }
        // key=value config override
        if (!arg.includes('=')) {
          fail(`Unrecognized argument: ${arg}\nConfig overrides must be key=value. Run with --help.`);
        }
        {
          const idx = arg.indexOf('=');
          const key = arg.slice(0, idx);
          opts.config[key] = coerce(arg.slice(idx + 1));
        }
        break;
    }
  }

  return opts;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) fail(`${flag} requires a value.`);
  return value as string;
}

/** Coerce a CLI string into the type an InputField expects. */
function coerce(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // multiselect: comma-separated list. `integrations=` (empty) → [].
  if (raw === '') return [];
  if (raw.includes(',')) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

function printHelp(): void {
  console.log(`gen-and-run — Foundry dev-loop harness (dev only)

Usage:
  npm run gen:oauth -- [flags] [key=value ...]

Config overrides (blueprint inputs):
  serviceName=<name>        default: ${DEFAULT_SERVICE_NAME}
  tokenStrategy=local-jwt|external-idp
  pkce=true|false
  apiDocs=true|false
  integrations=stripe,salesforce,hubspot   (comma list; empty = none)

Flags:
  --reuse, -r        Keep node_modules and skip npm install (fast iteration).
  --no-install       Skip npm install entirely.
  --no-db            Skip "npm run db:init" (no Postgres needed).
  --no-run           Don't start the server (stop after install/db:init).
  --no-portal-client Don't seed the Foundry portal as an OAuth client (M2).
  --out <dir>        Scratch output dir (default: .scratch/${BLUEPRINT_ID}).
  --port <n>         Server PORT (default: ${DEFAULT_PORT}).
  --db-url <url>     DATABASE_URL (default: ${DEFAULT_PG}/<serviceName>).
  --help, -h         Show this help.

Portal dogfood (M2), on by default:
  Sets JWT_SECRET=${SHARED_JWT_SECRET} and OAUTH_ISSUER=${SHARED_OAUTH_ISSUER}
  (shared with the Foundry portal API) and seeds the portal OAuth client
  (SEED_CLIENT_ID=${PORTAL_CLIENT_ID}, redirect ${PORTAL_REDIRECT_URIS}).
  To verify the secured loop: run this IdP, then run the Foundry portal API with
  AUTH_DISABLED=false (matching OAUTH_JWT_SECRET/OAUTH_ISSUER) and the SPA with
  VITE_OAUTH_ENABLED=true. Each value is overridable via the caller's env.

Default behavior: clean regenerate (wipe scratch) so template edits are picked up.`);
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Wipe the scratch dir. With `preserveDeps`, keep node_modules in place. */
function resetScratch(dir: string, preserveDeps: boolean): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (!preserveDeps) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return;
  }
  // Reuse mode: remove everything except node_modules so stale generated files
  // (e.g. integration stubs from a prior config) don't linger.
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Spawn a command, inheriting stdio. Resolves on exit 0. With `okOnSignal`,
 * termination by a signal (e.g. Ctrl-C of the long-running dev server) is
 * treated as a clean stop rather than an error.
 */
function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  okOnSignal = false,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0 || (okOnSignal && signal)) resolvePromise();
      else rejectPromise(new Error(`\`${cmd} ${args.join(' ')}\` exited with ${signal ?? code}`));
    });
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // serviceName is a required input with no default — supply one if the caller
  // didn't, so the generator's validation passes for a bare invocation.
  if (opts.config.serviceName === undefined) {
    opts.config.serviceName = DEFAULT_SERVICE_NAME;
  }

  const gen = new Generator(new FolderResolver(BLUEPRINTS_DIR));
  let result;
  try {
    result = await gen.generate(BLUEPRINT_ID, opts.config);
  } catch (err) {
    fail(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const cfg = result.config;
  const serviceSlug = kebabCase(String(cfg.serviceName));
  const clientId = `${serviceSlug}-client`;
  const dbUrl = opts.dbUrl ?? `${DEFAULT_PG}/${serviceSlug}`;
  const docsEnabled = cfg.apiDocs !== false;

  console.log(`\n▸ gen-and-run (${BLUEPRINT_ID})
  scratch dir : ${opts.out}
  serviceName : ${cfg.serviceName}
  tokenStrategy=${cfg.tokenStrategy}  pkce=${cfg.pkce}  apiDocs=${cfg.apiDocs}
  DATABASE_URL: ${dbUrl}
  mode        : ${opts.reuse ? 'reuse (keep node_modules)' : 'clean regenerate'}\n`);

  // 1. Emit generated files into the scratch dir.
  resetScratch(opts.out, opts.reuse);
  for (const file of result.files) {
    const dest = join(opts.out, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.contents);
  }
  console.log(`✓ wrote ${result.files.length} files`);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: dbUrl,
    PORT: String(opts.port),
    // Placeholders so the external-idp variant's config loader doesn't throw on
    // a bare run; harmless for the default local-jwt strategy.
    IDP_CLIENT_ID: process.env.IDP_CLIENT_ID ?? 'dev-idp-client',
    IDP_CLIENT_SECRET: process.env.IDP_CLIENT_SECRET ?? 'dev-idp-secret',
    // ── Portal dogfood (M2) ─────────────────────────────────────────────────
    // Default-on: share the JWT signing config with the Foundry portal API and
    // seed the portal as an OAuth client so `db:init` registers it. The portal
    // API (AUTH_DISABLED=false) then verifies tokens this IdP issues. Each is
    // overridable from the caller's env. `--no-portal-client` skips the seed.
    JWT_SECRET: process.env.JWT_SECRET ?? SHARED_JWT_SECRET,
    OAUTH_ISSUER: process.env.OAUTH_ISSUER ?? SHARED_OAUTH_ISSUER,
    ...(opts.portalClient
      ? {
          SEED_CLIENT_ID: process.env.SEED_CLIENT_ID ?? PORTAL_CLIENT_ID,
          SEED_CLIENT_REDIRECT_URIS:
            process.env.SEED_CLIENT_REDIRECT_URIS ?? PORTAL_REDIRECT_URIS,
        }
      : {}),
  };

  // 2. npm install (skipped on --no-install, or in --reuse when deps exist).
  const depsPresent = existsSync(join(opts.out, 'node_modules'));
  if (opts.install && !(opts.reuse && depsPresent)) {
    console.log('\n▸ npm install');
    await run('npm', ['install'], opts.out, childEnv);
  } else {
    console.log(`\n▸ skipping npm install${opts.reuse && depsPresent ? ' (reusing node_modules)' : ''}`);
  }

  // 3. db:init (drop/create/migrate/seed against the compose Postgres).
  if (opts.db) {
    console.log('\n▸ npm run db:init');
    await run('npm', ['run', 'db:init'], opts.out, childEnv);
  }

  if (!opts.run) {
    console.log(`\n✓ done (--no-run). Output at ${opts.out}\n`);
    return;
  }

  // 4. Boot the server. Long-running; Ctrl-C stops it (and this harness).
  console.log(`\n▸ npm run dev  →  starting ${cfg.serviceName} on :${opts.port}
${docsEnabled ? `  Swagger UI : http://localhost:${opts.port}/docs\n` : ''}  authorize  : http://localhost:${opts.port}/oauth/authorize
  token      : http://localhost:${opts.port}/oauth/token
  client_id  : ${clientId}${
    opts.portalClient
      ? `\n  portal client : ${PORTAL_CLIENT_ID} (redirect ${PORTAL_REDIRECT_URIS}) — M2 dogfood`
      : ''
  }
`);
  await run('npm', ['run', 'dev'], opts.out, childEnv, /* okOnSignal */ true);
  console.log('\n✓ server stopped\n');
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
