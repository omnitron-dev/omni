import '@xec-sh/cli/globals';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { provesDifferentHostBoot } from '@omnitron-dev/common/process-identity';
import type { NativeLegacyStageFence, StageRecoveryReceipt } from '../../src/shared/dto/nodes.js';

// Exercise the installed administrative CLI and a separately enrolled service
// account across two genuine kernel boots of one disposable guest.
assert.equal(process.platform, 'linux', 'Run on a disposable Linux LXD host with KVM');
const [delivery, receipt, fixture] = args;
assert(delivery && receipt && fixture, 'Expected native delivery, a new receipt path and the reviewed guest fixture');
const manifest = await fs.readJson(path.join(delivery, 'NATIVE.json'));
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const instance = 'local:omnitron-stage-' + randomUUID();
const runtime = '/opt/qualification-runtime';
const adminHome = '/root/.omnitron-maintenance';
const installed = adminHome + '/runtime/releases/' + manifest.runtime;
const account = 'qa-omnitron';
const home = '/home/' + account;
const serviceHome = home + '/.omnitron';
const serviceInstalled = serviceHome + '/runtime/releases/' + manifest.runtime;
const transport = '/run/omnitron-qualification';
// The helper executes outside a package boundary on the guest.
const probe = '/opt/qualification-stage-probe.mjs';
const asService = ['runuser', '-u', account, '--', '/usr/bin/env', '-i', '-C', home, 'PATH=/usr/bin:/bin',
  'HOME=' + home, 'USER=' + account, 'LOGNAME=' + account, 'OMNITRON_HOME=' + serviceHome];
const serviceCli = (root: string) => [...asService, root + '/node', root + '/packages/0/dist/cli/omnitron.js'];
const cli = (root: string) => ['/usr/bin/env', 'OMNITRON_HOME=' + adminHome, root + '/node',
  root + '/packages/0/dist/cli/omnitron.js', '--json'];
const lxc = (...argv: string[]) => $.execute({
  command: 'sudo', args: ['-n', '--', '/snap/bin/lxc', ...argv], shell: false, timeout: 240_000,
});
const guest = (...argv: string[]) => lxc('exec', instance, '--', ...argv);
const waitGuest = (...argv: string[]) => $.retry({ maxRetries: 40, initialDelay: 800, maxDelay: 2500 })
  .execute({ command: 'sudo', args: ['-n', '--', '/snap/bin/lxc', 'exec', instance, '--', ...argv], shell: false, timeout: 8000 });
const units = ['omnitron-owner.service', 'omnitron-daemon.service'];
const expectRefusal = async (reason: string, ...argv: string[]) => {
  const result = await $.execute({ command: 'sudo', args: ['-n', '--', '/snap/bin/lxc', 'exec', instance, '--', ...argv],
    shell: false, timeout: 60_000, nothrow: true });
  assert.notEqual(result.exitCode, 0);
  assert.equal(JSON.parse(result.stderr).error, reason);
  return reason;
};
const observe = async (): Promise<NativeLegacyStageFence> => {
  const answer = JSON.parse((await guest(...cli(installed), 'service', 'inspect-stage-fence')).stdout);
  assert.equal(answer.ok, true);
  return answer.data;
};

await $.withTempDir(async temp => {
  await lxc('init', 'ubuntu:24.04', instance, '--vm', '-c', 'limits.memory=2GiB', '-c', 'limits.cpu=2');
  try {
    const image = (await lxc('config', 'get', instance, 'volatile.base_image')).stdout.trim();
    assert.match(image, /^[a-f0-9]{64}$/);
    await lxc('start', instance);
    await waitGuest('/usr/bin/true');
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

    await guest('useradd', '--system', '--user-group', '--create-home', '--home-dir', home, '--shell', '/usr/sbin/nologin', account);
    const uid = (await guest('id', '-u', account)).stdout.trim();
    const gid = (await guest('id', '-g', account)).stdout.trim();
    const source = home + '/source';
    await guest('chmod', '0700', home);
    await guest('install', '-d', '-m', '0700', '-o', account, '-g', account, source, serviceHome, serviceHome + '/execution');
    await guest('install', '-o', account, '-g', account, '-m', '0400', '/root/runtime.tgz', home + '/runtime.tgz');
    await guest(...asService, '/usr/bin/tar', '-xzf', home + '/runtime.tgz', '-C', source);
    const config = path.join(temp, 'config.json');
    await fs.writeJson(config, { role: 'slave', port: 19711, httpPort: 19712, executionHost: { enabled: true, directory: serviceHome + '/execution' } });
    await lxc('file', 'push', '--uid=' + uid, '--gid=' + gid, '--mode=0600', config, instance + serviceHome + '/config.json');
    await guest('install', '-d', '-m', '0700', '/root/.omnitron');
    await guest('ln', '-s', serviceHome + '/config.json', '/root/.omnitron/config.json');
    await lxc('file', 'push', '--uid=0', '--gid=0', '--mode=0644', fixture, instance + probe);
    await guest(...serviceCli(source), '--json', 'backend', 'install', source);
    const selected = JSON.parse((await guest(...serviceCli(serviceInstalled), '--json', 'backend', 'select', manifest.runtime)).stdout).data.selection;
    assert.equal(selected.current, manifest.runtime);
    await guest(...serviceCli(serviceInstalled), 'service', 'install', '--scope', 'system', '--prepare');
    const plan = serviceHome + '/runtime/supervision-plan';
    await guest(...asService, 'install', '-m', '0600', plan + '/supervision.json', serviceHome + '/runtime/supervision.json');
    await guest('install', '-m', '0644', plan + '/owner.unit', '/etc/systemd/system/' + units[0]);
    await guest('install', '-m', '0644', plan + '/backend.unit', '/etc/systemd/system/' + units[1]);
    await guest('systemctl', 'daemon-reload');
    await guest('systemctl', 'enable', '--now', ...units);
    for (const unit of units) await waitGuest('systemctl', 'is-active', '--quiet', unit);

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

    const record = randomUUID(), scope = hash(JSON.stringify([instance, manifest.runtime, record]));
    const recover = (action: 'prepare' | 'finish') => [...cli(installed), 'service', 'recover-stage-fence', action,
      '--record', record, '--scope', scope, '--boot', before.bootId, '--machine', before.machineIdSha256,
      '--command-id', commandId, '--timeout-ms', String(before.timeoutMs), '--lease', before.leaseSha256, '--execution', before.executionSha256];
    const readRecovery = async (action: 'prepare' | 'finish'): Promise<StageRecoveryReceipt> => {
      const answer = JSON.parse((await guest(...recover(action))).stdout);
      assert.equal(answer.ok, true);
      assert.equal(answer.data.recordId, record);
      assert.equal(answer.data.scope, scope);
      assert.deepEqual(answer.data.observation, before);
      return answer.data;
    };
    const checkForeignLease = async (action: 'prepare' | 'finish', current: NativeLegacyStageFence) => {
      const marker = serviceHome + '/foreign-' + action;
      const [, reason] = await Promise.all([
        guest(...asService, serviceInstalled + '/node', probe, 'hold-selection', action),
        (async () => {
          await waitGuest('test', '-s', marker + '-ready');
          try {
            const refusal = await expectRefusal('The runtime registry has an unrelated installation lease', ...recover(action));
            assert.deepEqual(await observe(), current);
            return refusal;
          } finally { await guest(...asService, 'touch', marker + '-release'); }
        })(),
      ]);
      return reason;
    };
    const prepareWithForeignLease = await checkForeignLease('prepare', before);
    const prepared = await readRecovery('prepare');
    assert.equal(prepared.state, 'prepared');
    assert.equal(prepared.decision, null);
    assert.equal(prepared.selection.uid, Number(uid));
    assert.equal(prepared.selection.gid, Number(gid));
    assert.equal(prepared.selection.current, selected.current);
    assert.equal(prepared.selection.revision, selected.revision);
    assert.deepEqual(await readRecovery('prepare'), prepared);
    const sameBootRefusal = await expectRefusal('Recovery requires a different Linux boot on the same host', ...recover('finish'));
    assert.deepEqual(await observe(), before);

    const start = performance.now();
    await lxc('restart', instance, '--timeout=120');
    await waitGuest('/usr/bin/true');
    const after = await observe();
    assert(provesDifferentHostBoot(before.bootId, after.bootId));
    assert.deepEqual(after, { ...before, bootId: after.bootId });
    assert.deepEqual(await observe(), after);
    const restartToObservationMs = Math.ceil(performance.now() - start);
    for (const unit of units) await waitGuest('systemctl', 'is-active', '--quiet', unit);
    const finishWithForeignLease = await checkForeignLease('finish', after);
    await guest('install', '-d', '-m', '0700', transport);
    const request = path.join(temp, 'recovery.json');
    await fs.writeJson(request, { record, scope, observation: before });
    await lxc('file', 'push', '--uid=0', '--gid=0', '--mode=0600', request, instance + transport + '/request.json');
    await guest('mkfifo', '-m', '0600', transport + '/reply.pipe');
    await Promise.all([
      guest('/usr/bin/env', 'OMNITRON_HOME=' + adminHome, installed + '/node', probe, 'lose-finish-response'),
      (async () => {
        await guest('dd', 'if=' + transport + '/reply.pipe', 'of=/dev/null', 'bs=1', 'count=0', 'status=none');
        await guest('touch', transport + '/peer-closed');
      })(),
    ]);
    const resumed = await readRecovery('finish');
    assert.equal(resumed.state, 'interrupted');
    assert.equal(resumed.decision?.bootId, after.bootId);
    assert.equal(resumed.decision?.commandOutcome, 'unknown');
    assert.deepEqual(resumed.selection, prepared.selection);
    assert.equal(resumed.preparedAt, prepared.preparedAt);
    const undelivered = JSON.parse((await guest('cat', transport + '/undelivered.json')).stdout);
    // Read the guest's private receipt as bytes without exporting its root-owned mode onto the runner.
    const encoded = await guest('base64', '--wrap=0', transport + '/sender.json');
    const original = Buffer.from(encoded.stdout, 'base64').toString('utf8');
    assert.deepEqual(undelivered, { code: 'EPIPE', sha256: hash(original) });
    assert.deepEqual(JSON.parse(original).data, resumed);
    const archive = JSON.parse((await guest(installed + '/node', probe, 'read-archive')).stdout);
    assert.deepEqual(archive, { phase: 'finished', scope, decision: resumed.decision,
      leaseSha256: hash(lease), executionSha256: hash(intent) });
    for (const file of ['deploy.lease', 'deploy.execution.json']) await guest('test', '!', '-e', '/opt/omnitron/locks/' + file);
    await fs.writeFile(receipt, JSON.stringify({ commit: manifest.commit, runtime: manifest.runtime,
      guestImage: image, before, after, restartToObservationMs, prepareWithForeignLease, finishWithForeignLease, sameBootRefusal,
      prepared, undelivered, resumed, archive }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  } finally {
    await lxc('delete', '--force', instance);
  }
});
