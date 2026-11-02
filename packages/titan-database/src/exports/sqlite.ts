import { createRequire } from 'node:module';
import type Sqlite from 'better-sqlite3';

const require = createRequire(import.meta.url);

/** Open the optional native driver only on a runtime that implements its ABI. */
export function openSqliteDatabase(filename: string, options?: Sqlite.Options): Sqlite.Database {
  // better-sqlite3 13 uses Node-API 10. Loading its native binary on an
  // older runtime may terminate the process before JavaScript can catch it.
  const napi = process.versions['napi'];
  if (!(Number(napi) >= 10)) {
    throw new Error(
      `SQLite requires Node-API 10 (Node.js 22.14+ on 22.x or 23.6+). ` +
      `Node.js ${process.versions.node} provides Node-API ${napi ?? 'unknown'}.`,
    );
  }
  let Driver: typeof Sqlite;
  try {
    Driver = require('better-sqlite3') as typeof Sqlite;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND' ||
        !(cause instanceof Error && cause.message.startsWith("Cannot find module 'better-sqlite3'"))) throw cause;
    throw new Error("Install the optional peer dependency 'better-sqlite3' to use the SQLite dialect.", { cause });
  }
  return new Driver(filename, options);
}
