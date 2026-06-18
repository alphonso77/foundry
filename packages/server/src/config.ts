import os from 'node:os';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  authDisabled: boolean;
  corsOrigin: string;
  blueprintsDir: string;
  /**
   * Symmetric HS256 secret used to verify access tokens issued by the dogfooded
   * IdP. Must equal the IdP's own `JWT_SECRET` (prototype coupling — the
   * documented upgrade path is RS256 + JWKS, out of scope for M2).
   */
  oauthJwtSecret: string;
  /** Expected `iss` claim — must equal the IdP's `OAUTH_ISSUER`. */
  oauthIssuer: string;
  /**
   * When true, deploys simulate every phase (no terraform/docker/AWS calls) so
   * the UI and verification can run the full loop without AWS spend.
   */
  deployDryRun: boolean;
  /** Base dir for per-deployment workdirs (each is `<root>/<id>`). */
  deployWorkdirRoot: string;
}

/**
 * Resolve runtime config from the environment, with dev-friendly defaults that
 * match `.env.example`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.SERVER_PORT ?? 4000),
    // Default-on bypass for local dev. Anything other than the literal "false"
    // keeps auth disabled — flipping it to "false" arms the (stub) real check.
    authDisabled: (env.AUTH_DISABLED ?? 'true').toLowerCase() !== 'false',
    corsOrigin: env.PORTAL_ORIGIN ?? 'http://localhost:5173',
    blueprintsDir: env.FOUNDRY_BLUEPRINTS_DIR ?? defaultBlueprintsDir(),
    // Match the IdP's defaults (blueprint config.ts.hbs) so the local dogfood
    // loop verifies out of the box with no extra env.
    oauthJwtSecret: env.OAUTH_JWT_SECRET ?? 'dev-secret-change-me',
    oauthIssuer: env.OAUTH_ISSUER ?? 'https://auth.example.com',
    // Off by default — a deploy hits real AWS unless explicitly set to "true".
    deployDryRun: (env.DEPLOY_DRY_RUN ?? 'false').toLowerCase() === 'true',
    deployWorkdirRoot: env.DEPLOY_WORKDIR_ROOT ?? path.join(os.tmpdir(), 'foundry-deploys'),
  };
}

/**
 * <repo>/blueprints, resolved relative to this file (packages/server/src) so it
 * works regardless of the cwd a workspace script runs from.
 */
function defaultBlueprintsDir(): string {
  return path.resolve(import.meta.dirname, '..', '..', '..', 'blueprints');
}
