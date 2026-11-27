import assert from 'node:assert/strict';
import { ExecutionEngine } from '@xec-sh/core';
import { serviceGroups } from '../../src/infrastructure/private-host-config.js';

async function verify() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid?.(), 0);
  if (process.argv[2] === 'alias') {
    const engine = new ExecutionEngine({ quiet: true, enableEvents: false });
    try {
      const observer = await engine.execute({ adapter: 'local', command: '/usr/bin/id', args: ['-G', '--', 'observer'],
        shell: false, envMode: 'replace', env: { LC_ALL: 'C' } });
      assert.ok(observer.stdout.trim().split(/ +/).includes('994'));
    } finally { await engine.dispose(); }
    await assert.rejects(serviceGroups('bitcoin', { dedicated: true }), /identity and group/);
    return;
  }
  assert.equal(process.argv[2], 'separate');
  assert.deepEqual(await serviceGroups('bitcoin', { dedicated: true, directory: '/tmp' }), {
    serviceUid: 994n, serviceGid: 994n, readerUid: 995n, readerGid: 995n,
  });
  await assert.rejects(serviceGroups('bitcoin', { directory: '/closed' }), /identity and group/);
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
