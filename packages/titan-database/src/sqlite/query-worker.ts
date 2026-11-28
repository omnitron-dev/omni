import { parentPort, workerData } from 'node:worker_threads';
import { deserialize, serialize } from 'node:v8';
import { CompiledQuery, SelectQueryNode, SqliteDriver, type DatabaseConnection, type QueryResult } from 'kysely';
import { sqliteFile, type SqliteRequest, type SqliteReply } from './worker-protocol.js';

const port = parentPort!;
const driver = new SqliteDriver(sqliteFile(workerData.filename));
const cursors = new Map<number, AsyncIterableIterator<QueryResult<unknown>>>();
let connection: DatabaseConnection;

async function run(id: number, request: SqliteRequest) {
  switch (request.action) {
    case 'open':
      await driver.init();
      connection = await driver.acquireConnection();
      return undefined;
    case 'close':
      for (const stream of cursors.values()) await stream.return?.();
      cursors.clear();
      return driver.destroy();
    case 'execute':
      return connection.executeQuery(CompiledQuery.raw(request.sql, [...request.parameters]));
    case 'stream': {
      const query = CompiledQuery.raw(request.sql, [...request.parameters]);
      cursors.set(id, connection.streamQuery({ ...query, query: SelectQueryNode.create() }, 1));
      return id;
    }
    case 'next': {
      const stream = cursors.get(request.cursor);
      if (!stream) throw Error('SQLite cursor is closed');
      const rows: unknown[] = [];
      while (rows.length < request.size) {
        const step = await stream.next();
        if (step.done) {
          cursors.delete(request.cursor);
          break;
        }
        rows.push(...step.value.rows);
      }
      return rows;
    }
    case 'return':
      await cursors.get(request.cursor)?.return?.();
      cursors.delete(request.cursor);
      return undefined;
    default:
      throw Error('Unknown SQLite worker request');
  }
}

port.on('message', async ({ id, data }: { id: number; data: Uint8Array }) => {
  try {
    const request = deserialize(data) as SqliteRequest;
    const value = await run(id, request);
    port.postMessage({ id, value: serialize(value) } satisfies SqliteReply);
    if (request.action === 'close') port.close();
  } catch (cause) {
    const error = cause instanceof Error ? cause : Error(String(cause));
    const code = (error as NodeJS.ErrnoException).code;
    port.postMessage({ id, error, ...(code && { code }) } satisfies SqliteReply);
  }
});
