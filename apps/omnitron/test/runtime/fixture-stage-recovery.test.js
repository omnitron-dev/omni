import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { deliverToClosedPeer } from './fixture-stage-recovery.js';

const exec = promisify(execFile);
test('the receiver retains the exact first reply after its only peer closes the FIFO', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'stage-reply-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pipe = join(directory, 'reply.pipe');
  await exec('mkfifo', ['-m', '0600', pipe]);
  const bytes = Buffer.from('portable response-check\n');
  const peer = (async () => {
    await exec('dd', ['if=' + pipe, 'of=/dev/null', 'bs=1', 'count=0'], { timeout: 8000 });
    await writeFile(join(directory, 'peer-closed'), '', { flag: 'wx' });
  })();
  await Promise.all([peer, deliverToClosedPeer(directory, () => bytes)]);
  assert.deepEqual(await readFile(join(directory, 'sender.json')), bytes);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'undelivered.json'), 'utf8')), {
    code: 'EPIPE', sha256: createHash('sha256').update(bytes).digest('hex'),
  });
});
