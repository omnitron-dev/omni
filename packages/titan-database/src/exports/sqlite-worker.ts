import { Worker } from 'node:worker_threads';
import { deserialize, serialize } from 'node:v8';
import { SqliteDialect, SqliteDriver, SelectQueryNode, type CompiledQuery, type DatabaseConnection, type QueryResult } from 'kysely';
import { sqliteFile, type SqliteRequest, type SqliteReply } from '../sqlite/worker-protocol.js';

type PrepareBindings = (values: readonly unknown[]) => readonly unknown[];

/** One file connection with Kysely's SQLite transaction lock, savepoints and query compiler.
 * Native reads, commits and busy waits execute on its own thread. */
export class WorkerSqliteDialect extends SqliteDialect {
  constructor(private readonly filename: string, private readonly bindings: PrepareBindings = values => values) {
    super(sqliteFile(filename));
  }
  override createDriver(): SqliteDriver {
    return new WorkerDriver(this.filename, this.bindings);
  }
}

class WorkerDriver extends SqliteDriver implements DatabaseConnection {
  private worker?: Worker;
  private failure: Error | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (cause: Error) => void }>();

  constructor(private readonly filename: string, private readonly bindings: PrepareBindings) {
    super(sqliteFile(filename));
  }
  override async init(): Promise<void> {
    this.failure = null;
    const worker = new Worker(new URL('../sqlite/query-worker.js', import.meta.url), {
      workerData: { filename: this.filename }, execArgv: [], name: 'sqlite',
    });
    this.worker = worker;
    worker.on('error', error => this.fail(error instanceof Error ? error : Error(String(error))));
    worker.on('exit', code => this.fail(Error('SQLite worker exited with code ' + code)));
    worker.on('message', (reply: SqliteReply) => {
      const call = this.pending.get(reply.id);
      if (!call) return;
      this.pending.delete(reply.id);
      if ('error' in reply) call.reject(Object.assign(reply.error, reply.code && { code: reply.code }));
      else call.resolve(deserialize(reply.value));
    });
    try { await this.call({ action: 'open' }); }
    catch (cause) { await worker.terminate(); throw cause; }
  }
  private fail(error: Error): void {
    this.failure = error;
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }
  private async call<T>(request: SqliteRequest): Promise<T> {
    if (this.failure) throw this.failure;
    const worker = this.worker;
    if (!worker) throw Error('SQLite connection is closed');
    const id = ++this.sequence;
    // V8's serializer preserves Buffer bindings and BLOB results across worker isolates.
    const data = serialize(request);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject });
      try { worker.postMessage({ id, data }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  override async acquireConnection(): Promise<DatabaseConnection> { return this; }
  executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    return this.call({ action: 'execute', sql: query.sql, parameters: this.bindings(query.parameters) });
  }
  async *streamQuery<R>(query: CompiledQuery, chunkSize: number): AsyncIterableIterator<QueryResult<R>> {
    if (!SelectQueryNode.is(query.query)) throw Error('SQLite only supports streaming select queries');
    const size = Math.min(1024, Math.max(1, Math.floor(chunkSize) || 1));
    const cursor = await this.call<number>({ action: 'stream', sql: query.sql, parameters: this.bindings(query.parameters) });
    try {
      for (;;) {
        const rows = await this.call<R[]>({ action: 'next', cursor, size });
        if (rows.length) yield { rows };
        if (rows.length < size) break;
      }
    } finally { await this.call({ action: 'return', cursor }); }
  }
  override async destroy(): Promise<void> {
    if (!this.worker) return;
    try { if (!this.failure) await this.call({ action: 'close' }); }
    finally { await this.worker.terminate(); }
  }
}
