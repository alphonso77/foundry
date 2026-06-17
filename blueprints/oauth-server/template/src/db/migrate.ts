import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { pool } from './pool';
import { config } from '../config';

async function ensureDatabase(): Promise<void> {
  const url = new URL(config.databaseUrl);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const adminPool = new Pool({ connectionString: url.toString() });
  try {
    const { rowCount } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) {
      await adminPool.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      // eslint-disable-next-line no-console
      console.log(`Database "${dbName}" created.`);
    }
  } finally {
    await adminPool.end();
  }
}

// Optionally register one additional OAuth client from the environment, on top of the static
// client seeded by schema.sql. This keeps the blueprint generic — schema.sql can't read env —
// while letting a deployment (e.g. Foundry's own portal) register itself via env vars:
//   SEED_CLIENT_ID, SEED_CLIENT_REDIRECT_URIS (comma-separated), SEED_CLIENT_SECRET (optional).
// No-op unless SEED_CLIENT_ID is set, so default single-client behavior is unchanged.
async function seedExtraClient(): Promise<void> {
  const clientId = process.env.SEED_CLIENT_ID;
  if (!clientId) return;

  const redirectUris = (process.env.SEED_CLIENT_REDIRECT_URIS ?? '')
    .split(',')
    .map((uri) => uri.trim())
    .filter(Boolean);
  const clientSecret = process.env.SEED_CLIENT_SECRET ?? null;

  await pool.query(
    `INSERT INTO oauth_clients (client_id, client_secret, redirect_uris)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id) DO NOTHING`,
    [clientId, clientSecret, redirectUris],
  );
  // eslint-disable-next-line no-console
  console.log(`Seeded extra OAuth client "${clientId}".`);
}

async function migrate(): Promise<void> {
  await ensureDatabase();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  await seedExtraClient();
  // eslint-disable-next-line no-console
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
