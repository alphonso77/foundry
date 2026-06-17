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

async function migrate(): Promise<void> {
  await ensureDatabase();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  // eslint-disable-next-line no-console
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
