import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const dist = path.resolve(process.argv[2] ?? 'dist');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-recovery-'));
const guard = pathToFileURL(path.join(dist, 'daemon/entry-guard.js')).href;
let stderr;
const before = Date.now();
try {
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import {guardEntry} from ${JSON.stringify(guard)}; await guardEntry('fixture',()=>import('missing-startup-fixture'));`], { env: { ...process.env, OMNITRON_HOME: home } });
  assert.fail('Missing import must fail startup');
} catch (error) { assert.equal(error.code, 1); stderr = error.stderr; }
const event = JSON.parse(stderr);
assert.equal(event.event, 'runtime.startup_failed');
assert(Date.parse(event.time) >= before && Date.parse(event.time) <= Date.now());
assert(event.err.stack.includes('ERR_MODULE_NOT_FOUND'));
const source = path.join(home, 'data/startup-failures', event._omnitron.id + '.json');
assert.equal((await fs.stat(source)).mode & 0o777, 0o600);
assert.deepEqual(JSON.parse(await fs.readFile(source, 'utf8')), event);
const require = createRequire(path.join(dist, 'index.js'));
const { Kysely, SqliteDialect } = await import(pathToFileURL(require.resolve('kysely')));
const Database = require('better-sqlite3');
const sqlite = new Database(path.join(home, 'db.sqlite'));
sqlite.pragma('journal_mode=WAL'); sqlite.pragma('synchronous=FULL');
sqlite.exec('CREATE TABLE logs(id TEXT PRIMARY KEY,timestamp TEXT NOT NULL,nodeId TEXT,app TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL,labels TEXT,traceId TEXT,spanId TEXT,metadata TEXT)');
const { withDateBinding } = await import(pathToFileURL(path.join(dist, 'database/sqlite-date-binding.js')));
const { LogCollectorService } = await import(pathToFileURL(path.join(dist, 'services/log-collector.service.js')));
const { LogJournal } = await import(pathToFileURL(path.join(dist, 'monitoring/log-journal.js')));
const db = new Kysely({ dialect: new SqliteDialect({ database: withDateBinding(sqlite) }) });
const collector = new LogCollectorService(db);
collector.useJournal(new LogJournal(path.join(home, 'queue.sqlite')));
collector.setStartupDirectory(path.dirname(source));
const interrupted = { ...event, _omnitron: { ...event._omnitron, id: randomUUID() } };
const partial = path.join(path.dirname(source), interrupted._omnitron.id + '.partial');
const malformed = path.join(path.dirname(source), randomUUID() + '.json');
await fs.writeFile(partial, JSON.stringify(interrupted), { mode: 0o600 });
await fs.writeFile(malformed, '{unfinished', { mode: 0o600 });
try {
  await collector.flush(); await collector.flush();
  let rows = await db.selectFrom('logs').selectAll().execute();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.id === event._omnitron.id).timestamp, event.time);
  assert(collector.getIngestionStats().lastError.includes(path.basename(malformed)));
  assert.equal(await fs.readFile(malformed, 'utf8'), '{unfinished');
  await fs.unlink(malformed); // Only this test's deliberately damaged fixture.
  await collector.flush();
  assert.equal(collector.getIngestionStats().lastError, null);
  await db.deleteFrom('logs').execute(); // Simulate retention on this isolated fixture.
  await collector.flush();
  rows = await db.selectFrom('logs').selectAll().execute();
  assert.equal(rows.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(source, 'utf8')), event);
  console.log(JSON.stringify({ test: 'native-import-failure-recovery', time: event.time, id: event._omnitron.id, duplicateRows: 0, sourcePreserved: true, partialRecovered: true, damagedSourceIsolated: true, retentionRespected: true, directory: home }));
} finally { await collector.dispose(); await db.destroy(); }
