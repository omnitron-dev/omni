/** Native Docker evidence, grace and recovery on one disposable Alpine container.
 * node test/runtime/native-health-recovery.mjs dist [receipt.json]
 * Uses cached alpine:3.24, no ports/volumes/network, and no working daemon.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const dist = path.resolve(process.argv[2] || 'dist');
const { getContainerState, startContainer } = await import(pathToFileURL(path.join(dist, 'infrastructure/container-runtime.js')));
const { observeUnhealthy, UNHEALTHY_GRACE_MS } = await import(pathToFileURL(path.join(dist, 'infrastructure/health-recovery.js')));
const nonce = randomBytes(12).toString('hex');
const name = `omnitron-health-qa-${nonce}`;
const exec = async args => {
  const started = Date.now();
  const child = run('docker', args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
  child.child.stdin.end(); // These non-interactive commands never consume input.
  try { return (await child).stdout.trim(); }
  finally { console.log(JSON.stringify({ operation: args[0], durationMs: Date.now() - started })); }
};
const provider = await exec(['info', '--format', '{{.ID}}']);
const image = await exec(['image', 'inspect', 'alpine:3.24', '--format', '{{.Id}}']);
const report = { test: 'native-health-recovery', nonce, passed: false, liveActivation: false, checks: [] };
let id, failure;
const inspect = async () => {
  assert.equal(await exec(['info', '--format', '{{.ID}}']), provider);
  const [value] = JSON.parse(await exec(['inspect', id]));
  assert.equal(value.Id, id); assert.equal(value.Image, image);
  assert.equal(value.Config.Labels['omnitron.test'], nonce);
  assert.equal(value.HostConfig.NetworkMode, 'none');
  assert.equal(value.Mounts.length, 0);
  assert.equal(Object.keys(value.HostConfig.PortBindings ?? {}).length, 0);
  return value;
};
const wait = async (operation, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Native health fixture deadline exceeded');
};
const read = () => getContainerState(name, { fullId: true, orThrow: true });
try {
  id = await exec(['create', '--pull=never', '--name', name, '--label', `omnitron.test=${nonce}`,
    '--network=none', '--cpus=0.25', '--memory=32m', '--memory-swap=32m', '--pids-limit=32',
    '--restart=no', '--health-cmd=test -f /healthy', '--health-interval=1s', '--health-timeout=1s',
    '--health-retries=1', image, 'sh', '-c', 'touch /healthy; while :; do sleep 1; done']);
  await inspect();
  const starting = Date.now();
  await startContainer(id);
  report.startMs = Date.now() - starting;
  await wait(async () => (await read())?.health === 'healthy');
  await exec(['exec', id, 'rm', '/healthy']);
  const initial = await wait(async () => { const state = await read(); return state?.health === 'unhealthy' && state.healthCheck ? state : null; });
  assert.equal(initial.containerId, id); assert.equal(initial.healthCheck.exitCode, 1);
  let observation = observeUnhealthy(undefined, initial, Date.now());
  const firstObservedAt = observation.evidence.firstObservedAt;
  for (let poll = 0; poll < 20; poll++) {
    observation = observeUnhealthy(observation.evidence, initial, Date.now());
    assert.equal(observation.restart, false); assert.equal(observation.evidence.confirmations, 1);
  }
  report.checks.push('Repeated cached native result cannot authorize recreation');
  let samples = 0;
  const allowed = await wait(async () => {
    const state = await read(); samples++;
    assert.equal(state.containerId, id);
    observation = observeUnhealthy(observation.evidence, state, Date.now());
    if (Date.now() - firstObservedAt < UNHEALTHY_GRACE_MS) assert.equal(observation.restart, false);
    return observation.restart ? state : null;
  }, UNHEALTHY_GRACE_MS + 30_000);
  assert.equal(allowed.containerId, id);
  report.elapsedGraceMs = Date.now() - firstObservedAt; report.samples = samples;
  report.checks.push('Different real failed probes authorize recovery only after elapsed grace');
  await inspect(); await exec(['exec', id, 'touch', '/healthy']);
  const recovered = await wait(async () => { const state = await read(); return state?.health === 'healthy' ? state : null; });
  assert.equal(observeUnhealthy(observation.evidence, recovered, Date.now()).restart, false);
  assert.equal(recovered.healthCheck.exitCode, 0);
  assert.equal((await inspect()).RestartCount, 0);
  report.checks.push('Real native recovery cancels the pending decision without restarting the container');
  report.passed = true;
} catch (error) {
  failure = error; report.failure = { message: error.message, code: error.code };
} finally {
  try {
    if (id) {
      const current = await inspect();
      if (current.State.Running) await exec(['stop', '--time', '5', id]);
      await exec(['rm', id]);
      assert.equal(await exec(['ps', '-aq', '--filter', `name=^/${name}$`]), '');
    }
    report.cleanup = { passed: true, container: id, volumes: false };
  } catch (error) {
    report.cleanup = { passed: false, container: id, message: error.message };
    failure = failure ? new AggregateError([failure, error], 'Native check and fixture cleanup failed') : error;
  }
  if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
}

if (failure) throw failure;
