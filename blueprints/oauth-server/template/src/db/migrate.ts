import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './pool';

async function migrate(): Promise<void> {
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
