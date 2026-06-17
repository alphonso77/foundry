import { Pool } from 'pg';
import { config } from '../config';

async function dropDatabase(): Promise<void> {
  const url = new URL(config.databaseUrl);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const adminPool = new Pool({ connectionString: url.toString() });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS "${dbName.replace(/"/g, '""')}"`);
    // eslint-disable-next-line no-console
    console.log(`Database "${dbName}" dropped.`);
  } finally {
    await adminPool.end();
  }
}

dropDatabase().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
