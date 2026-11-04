/* A fresh in-memory board database for the server verb tests. */
import { openDb } from '../../server/db.mjs';
import { migrate } from '../../server/migrate.mjs';

process.removeAllListeners('warning');

export function freshBoard() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}
