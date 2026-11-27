import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function waitForFile(file) {
  const deadline = performance.now() + 90_000;
  while (performance.now() < deadline) {
    try { await access(file); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await sleep(75);
  }
  throw Error('Timed out waiting for ' + basename(file));
}

// The runner opens and closes its only read descriptor before delivering the
// close acknowledgement. The first real reply stays with the guest sender.
export async function deliverToClosedPeer(directory, receive) {
  const pipe = openSync(join(directory, 'reply.pipe'), constants.O_WRONLY);
  try {
    await waitForFile(join(directory, 'peer-closed'));
    const reply = receive();
    writeFileSync(join(directory, 'sender.json'), reply, { mode: 0o600, flag: 'wx' });
    assert.throws(() => writeSync(pipe, reply), { code: 'EPIPE' });
    writeFileSync(join(directory, 'undelivered.json'), JSON.stringify({
      code: 'EPIPE', sha256: createHash('sha256').update(reply).digest('hex'),
    }), { mode: 0o600, flag: 'wx' });
  } finally { closeSync(pipe); }
}

async function run(mode) {
  assert.equal(process.platform, 'linux');
  const dist = join(dirname(process.execPath), 'packages/0/dist');
  if (mode === 'hold-selection') {
    assert(process.getuid() > 0);
    const home = process.env.OMNITRON_HOME;
    const action = process.argv[3];
    assert(['prepare', 'finish', 'abandoned'].includes(action));
    const marker = join(home, 'foreign-' + action);
    const { RuntimeInstallation } = await import(pathToFileURL(join(dist, 'daemon/runtime-installation.js')).href);
    const registry = await RuntimeInstallation.open(home, { existing: true });
    assert(registry);
    try {
      await registry.exclusive(async () => {
        writeFileSync(marker + '-ready', String(process.pid), { mode: 0o600, flag: 'wx' });
        if (action === 'abandoned') process.exit(0); // Exit while holding the actual committed installation lease.
        await waitForFile(marker + '-release');
      });
    } finally { await registry.close(); }
    return;
  }
  assert.equal(process.getuid(), 0);
  const transport = '/run/omnitron-qualification';
  const { record, scope, observation } = JSON.parse(readFileSync(join(transport, 'request.json'), 'utf8'));
  if (mode === 'read-archive') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync('/opt/omnitron/locks/stage-fence-recovery/archive.db', { readOnly: true });
    try {
      const row = db.prepare('SELECT phase, scope, decision, lease, execution FROM incident WHERE id = ?').get(record);
      assert(row);
      const digest = bytes => createHash('sha256').update(bytes).digest('hex');
      process.stdout.write(JSON.stringify({ phase: row.phase, scope: row.scope, decision: JSON.parse(row.decision),
        leaseSha256: digest(row.lease), executionSha256: digest(row.execution) }) + '\n');
    } finally { db.close(); }
    return;
  }
  assert.equal(mode, 'lose-finish-response');
  await deliverToClosedPeer(transport, () => {
    const result = spawnSync(process.execPath, [join(dist, 'cli/omnitron.js'), '--json',
      'service', 'recover-stage-fence', 'finish', '--record', record, '--scope', scope,
      '--boot', observation.bootId, '--machine', observation.machineIdSha256, '--command-id', observation.commandId,
      '--timeout-ms', String(observation.timeoutMs), '--lease', observation.leaseSha256, '--execution', observation.executionSha256,
    ], { timeout: 90_000, maxBuffer: 64 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr.toString());
    const answer = JSON.parse(result.stdout.toString());
    assert.equal(answer.ok, true);
    assert.equal(answer.data.recordId, record);
    assert.equal(answer.data.state, 'interrupted');
    return result.stdout;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run(process.argv[2]);
