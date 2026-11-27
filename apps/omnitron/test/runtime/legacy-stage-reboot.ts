import '@xec-sh/cli/globals';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { provesDifferentHostBoot } from '@omnitron-dev/common/process-identity';
import type { NativeLegacyStageFence } from '../../src/shared/dto/nodes.js';

// Use the sealed CLI twice on one guest disk. The fixture contains only the
// four historical deployment files, so no live installation is ever involved.
assert.equal(process.platform, 'linux', 'Run on a disposable Linux LXD host with KVM');
const [delivery, receipt] = args;
assert(delivery && receipt, 'Expected the verified native delivery directory and a new receipt path');
const manifest = await fs.readJson(path.join(delivery, 'NATIVE.json'));
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const instance = 'local:omnitron-stage-' + randomUUID();
const runtime = '/opt/qualification-runtime';
const adminHome = '/root/.omnitron-maintenance';
const installed = adminHome + '/runtime/releases/' + manifest.runtime;
const cli = (root: string) => ['/usr/bin/env', 'OMNITRON_HOME=' + adminHome, root + '/node',
  root + '/packages/0/dist/cli/omnitron.js', '--json'];
const lxc = (...argv: string[]) => $.execute({
  command: 'sudo', args: ['-n', '--', '/snap/bin/lxc', ...argv], shell: false, timeout: 240_000,
});
const guest = (...argv: string[]) => lxc('exec', instance, '--', ...argv);
const ready = () => $.retry({ maxRetries: 50, initialDelay: 1500, maxDelay: 3000 })
  .execute({ command: 'sudo', args: ['-n', '--', '/snap/bin/lxc', 'exec', instance, '--', '/usr/bin/true'], shell: false, timeout: 8000 });
const observe = async (): Promise<NativeLegacyStageFence> => {
  const answer = JSON.parse((await guest(...cli(installed), 'service', 'inspect-stage-fence')).stdout);
  assert.equal(answer.ok, true);
  return answer.data;
};

await $.withTempDir(async temp => {
  await lxc('init', 'ubuntu:24.04', instance, '--vm', '-c', 'limits.memory=1GiB', '-c', 'limits.cpu=2');
  try {
    const image = (await lxc('config', 'get', instance, 'volatile.base_image')).stdout.trim();
    assert.match(image, /^[a-f0-9]{64}$/);
    await lxc('start', instance);
    await ready();
    await guest('install', '-d', '-m', '0700', runtime, '/opt/omnitron/locks');
    await lxc('file', 'push', path.join(delivery, 'runtime.tgz'), instance + '/root/runtime.tgz');
    const sha = (await guest('sha256sum', '/root/runtime.tgz')).stdout.split(/\s/)[0];
    assert.equal(sha, manifest.archive);
    await guest('tar', '-xzf', '/root/runtime.tgz', '-C', runtime);
    const verified = JSON.parse((await guest(...cli(runtime), 'runtime', 'verify', runtime)).stdout);
    assert.equal(verified.ok, true);
    assert.equal(verified.data.sha256, manifest.runtime);
    const installation = JSON.parse((await guest(...cli(runtime), 'backend', 'install', runtime)).stdout);
    assert.equal(installation.ok, true);
    assert.equal(installation.data.id, manifest.runtime);
    assert.equal(installation.data.selected, false);

    const token = randomUUID(), commandId = randomUUID();
    const lease = JSON.stringify({ token, holder: 'qualification', stack: 'stage managed kernel', startedAt: new Date().toISOString() });
    const intent = JSON.stringify({ schema: 1, id: commandId, token, timeoutMs: 600000 }) + '\n';
    const records = { 'deploy.lease': lease, 'deploy.execution.json': intent, 'deploy.guard': '', 'deploy.execution.guard': '' };
    for (const [name, bytes] of Object.entries(records)) {
      const file = path.join(temp, name);
      await fs.writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
      await lxc('file', 'push', '--uid=0', '--gid=0', '--mode=0600', file, instance + '/opt/omnitron/locks/' + name);
    }
    const before = await observe();
    assert.equal(before.state, 'unresolved-legacy-stage');
    assert.equal(before.commandId, commandId);
    assert.equal(before.leaseSha256, hash(lease));
    assert.equal(before.executionSha256, hash(intent));
    assert.deepEqual(await observe(), before);

    const start = performance.now();
    await lxc('restart', instance, '--timeout=120');
    await ready();
    const after = await observe();
    assert(provesDifferentHostBoot(before.bootId, after.bootId));
    assert.deepEqual(after, { ...before, bootId: after.bootId });
    assert.deepEqual(await observe(), after);
    await fs.writeFile(receipt, JSON.stringify({ commit: manifest.commit, runtime: manifest.runtime,
      guestImage: image, before, after, restartToObservationMs: Math.ceil(performance.now() - start) }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  } finally {
    await lxc('delete', '--force', instance);
  }
});
