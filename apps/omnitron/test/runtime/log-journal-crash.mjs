import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const dist = path.resolve(process.argv[2] ?? 'dist');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'log-journal-crash-'));
const journalModule = pathToFileURL(path.join(dist, 'monitoring/log-journal.js')).href;
const assemblyModule = pathToFileURL(path.join(dist, 'monitoring/log-line.js')).href;
const script = path.join(directory, 'writer.mjs');
const filename = path.join(directory, 'journal.sqlite');
await fs.writeFile(script, `
import { LogJournal } from ${JSON.stringify(journalModule)};
import { LineAssembler } from ${JSON.stringify(assemblyModule)};
const journal = new LogJournal(${JSON.stringify(filename)});
const assembler = new LineAssembler((app, record) => journal.put(record.id, { app, record }), {
 idleMs: 60000, onPending: (app,record) => journal.put(record.id,{app,record},false)
});
assembler.push('fixture', 'Error: interrupted');
assembler.push('fixture', '    at writer');
process.send({ready:true});
setInterval(()=>{},1000);
`);
const child = fork(script, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
const closed = once(child, 'close');
try {
  await Promise.race([once(child, 'message'), closed.then(() => { throw new Error('Fixture exited before durable capture'); })]);
  child.kill('SIGKILL');
  await closed;
  const { LogJournal } = await import(journalModule);
  const journal = new LogJournal(filename);
  try {
    const rows = journal.peek();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value.record.message, 'Error: interrupted\n    at writer');
    assert.equal(rows[0].value.record.capture.timeBasis, 'captured');
    assert.equal(journal.stats().assembling, 0);
    console.log(JSON.stringify({ test: 'unfinished-log-survives-sigkill', rows: rows.length, id: rows[0].id, directory }));
  } finally { journal.close(); }
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
}
