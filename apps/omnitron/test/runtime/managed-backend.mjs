import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reserveDaemonPorts } from './fixture-ports.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';

assert.ok(['darwin', 'linux'].includes(process.platform), 'This fixture requires native service supervision');
const linux = process.platform === 'linux';
if (linux) assert.equal(process.getuid(), 0, 'Linux fixture needs an isolated system service, independent of SSH login');
const dist = path.resolve(process.argv[2]);
assert.ok(dist.includes('omnitron-handoff-'), 'Use a disposable sealed test artifact');
const managementDist = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (managementDist) assert.ok(managementDist.includes('omnitron-handoff-'), 'Use a disposable management artifact');
// Qualify an exact baseline -> candidate -> baseline with the baseline owner and
// guardian retained. This is the same CLI path used by a backend-only rollout.
const backendOnly = process.argv.includes('--backend-only');
if (backendOnly) assert.ok(managementDist, 'Provide the candidate artifact before --backend-only');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-managed-'));
const instance = path.join(root, 'i'), execution = path.join(root, 'e');
for (const directory of [instance, execution]) await fs.mkdir(directory, { mode: 0o700 });
process.env.OMNITRON_HOME = instance;
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { RuntimeInstallation } = await load('daemon/runtime-installation.js');
const { renderLaunchdPlist, renderSystemdUnit } = await load('commands/service-units.js');
const { createDaemonClient } = await load('daemon/daemon-client.js');
const { privateControlClient } = await load('daemon/private-control-client.js');
const { PidManager } = await load('daemon/pid-manager.js');
const run = promisify(execFile);
const native = args => run(linux ? 'systemctl' : '/bin/launchctl', args, { timeout: 45_000, maxBuffer: 1024 * 1024 });
const domain = `gui/${process.getuid()}`;
const id = randomUUID();
const installation = await RuntimeInstallation.open(instance);
let artifact;
try {
  artifact = await installation.exclusive(async () => {
    const installed = await installation.install(path.resolve(dist, '../../..'));
    await installation.select(installed.runtimeHash, 0);
    await installation.writeLauncher();
    return installed;
  });
} finally { await installation.close(); }
const { httpPort: port, ports: [tcpPort, counterPort], release } = await reserveDaemonPorts(2);
const readiness = { intervalMs: 1000, timeoutMs: 1000, probes: [
  { name: 'counter HTTP', type: 'http', url: `http://127.0.0.1:${counterPort}/health`, expect: { fixture: id, ready: true } },
] };
const config = { protocol: 1, instanceHome: instance, directory: execution, scope: linux ? 'system' : 'user', cwd: root,
  environment: { OMNITRON_HOME: instance, OMNITRON_NO_INFRA: '1', OMNITRON_NO_WATCH: '1', PATH: process.env.PATH },
  owner: { label: `dev.omnitron.fixture.${id}.owner`, unit: `omnitron-fixture-${id}-owner.service`, artifact: artifact.runtimeHash },
  backend: { label: `dev.omnitron.fixture.${id}.backend`, unit: `omnitron-fixture-${id}-backend.service`, artifact: artifact.runtimeHash },
};
await fs.writeFile(path.join(instance, 'config.json'), JSON.stringify({ role: 'slave', port: tcpPort, httpPort: port,
  executionHost: { enabled: true, directory: execution } }), { mode: 0o600 });
await fs.writeFile(path.join(instance, 'runtime/supervision.json'), JSON.stringify(config), { mode: 0o600 });
await fs.writeFile(path.join(root, 'counter.mjs'), `import http from 'node:http';import fs from 'node:fs';
 let value=0,sequence=0,paused=false;setInterval(()=>value++,5);
 setInterval(()=>{if(paused)return;const record={level:30,time:new Date().toISOString(),msg:'fixture:${id}:'+sequence+++'\\n  first continuation\\n  second continuation'};
 const began=performance.now();fs.appendFileSync(${JSON.stringify(path.join(root, 'expected.jsonl'))},JSON.stringify(record)+'\\n');
 const evidenceWriteMs=performance.now()-began;if(evidenceWriteMs>=500)process.stderr.write(JSON.stringify({level:40,time:new Date().toISOString(),msg:'fixture evidence write blocked',evidenceWriteMs})+'\\n');
 process.stdout.write(JSON.stringify(record)+'\\n');},50);
 const server=http.createServer((q,r)=>{if(q.url==='/pause')paused=true;r.end(JSON.stringify({pid:process.pid,parent:process.ppid,value,fixture:${JSON.stringify(id)},ready:true,timestamp:new Date().toISOString()}));});
 server.listen(${counterPort},'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(root, 'address.json'))},JSON.stringify(server.address()));process.send?.({type:'ready'});});
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
await fs.writeFile(path.join(root, 'omnitron.config.mjs'), `export default {apps:[{name:'counter',script:'./counter.mjs',cwd:${JSON.stringify(root)},enabled:true,readiness:${JSON.stringify(readiness)}}]};`);
const units = [];
for (const mode of ['owner', 'backend']) {
  const systemUnitDir = managementDist ? '/etc/systemd/system' : '/run/systemd/system';
  const file = linux ? path.join(systemUnitDir, config[mode].unit) : path.join(root, `${mode}.plist`);
  const render = linux ? renderSystemdUnit : renderLaunchdPlist;
  await fs.writeFile(file, render({ scope: config.scope, execPath: artifact.execPath,
    entryPath: path.join(artifact.directory, 'daemon/managed-entry.js'), args: [mode], label: config[mode].label,
    nodeArgs: [],
    restart: mode === 'backend', workdir: path.dirname(artifact.directory), path: process.env.PATH,
    identity: linux ? { user: 'root', home: os.homedir() } : undefined,
    environment: { OMNITRON_HOME: instance }, stderrLog: path.join(root, `${mode}.log`) }));
  await run(linux ? 'systemd-analyze' : '/usr/bin/plutil', linux ? ['verify', file] : ['-lint', file]);
  units.push({ file, job: linux ? config[mode].unit : `${domain}/${config[mode].label}` });
}
const socket = path.join(instance, 'daemon.sock');
const status = async () => {
  await fs.access(socket);
  const client = createDaemonClient(socket, 3000);
  try { return await client.status(); } finally { await client.disconnect(); }
};
const until = async (work, message, ms = 150_000) => {
  const deadline = Date.now() + ms; let cause;
  while (Date.now() < deadline) {
    try { const value = await work(); if (value) return value; } catch (error) { cause = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${message}; inspect ${root}; ${cause?.message ?? ''}`);
};
const waitCertificate = () => until(async () => (await status()).execution?.recovery?.status === 'ready', 'No recovery certificate');
let sampler, inFlight = false, samples = 0, failures = 0, ownerPid, applicationPid, ownerClient;
let samplingStage = 'cold-start';
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const mark = event => {
  samplingStage = event.stage ?? samplingStage;
  console.log(JSON.stringify(event));
};
const failureDetails = error => ({ name: error?.name, message: error?.message ?? String(error),
  ...(error?.code !== undefined && { code: error.code }), ...(error?.cause && { cause: String(error.cause) }) });
try {
  if (linux) await native(['daemon-reload']);
  // Linux btime is rounded to seconds. Keep sealed file timestamps strictly before
  // the conservative process birth used by legacy-owner attestation.
  if (linux && managementDist) await new Promise(resolve => setTimeout(resolve, 1100));
  await release();
  for (const unit of units) await native(linux ? ['start', unit.job] : ['bootstrap', domain, unit.file]);
  let first = await until(status, 'Initial managed backend did not start');
  mark({ stage: 'cold-start', root, backend: first.pid, owner: first.execution.owner.pid });
  ownerPid = first.execution.owner.pid;
  const client = createDaemonClient(socket, 30_000);
  try { await client.startApp({ name: 'counter' }); } finally { await client.disconnect(); }
  const address = await until(async () => JSON.parse(await fs.readFile(path.join(root, 'address.json'), 'utf8')), 'Counter did not start');
  const probe = async () => (await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(1000) })).json();
  const before = await probe(); applicationPid = before.pid;
  // 9ec's classic applications use declared readiness, rather than a Titan IPC health channel.
  const { checkReadiness } = await load('health/readiness.js');
  const unknown = await checkReadiness(undefined, root);
  assert.equal(unknown.status, 'degraded');
  assert.match(unknown.checks[0].message, /readiness_not_configured/);
  const healthClient = createDaemonClient(socket, 30_000);
  try {
    await until(async () => {
      const report = await healthClient.getHealth({});
      const health = report.apps?.counter;
      assert.equal(health?.status, 'healthy');
      assert(health.checks.some(check => check.name === 'counter HTTP' && check.status === 'pass'));
      return true;
    }, 'Counter HTTP readiness did not pass');
  } finally { await healthClient.disconnect(); }
  mark({ stage: 'application-ready', applicationPid, unknownReadiness: unknown.status });
  assert.equal(before.parent, ownerPid);
  ownerClient = await privateControlClient(path.join(execution, 'owner.sock'), 'OmnitronExecution', 3000);
  eventLoop.enable();
  sampler = setInterval(async () => {
    if (inFlight) return; inFlight = true;
    const started = performance.now(), at = new Date().toISOString(), stage = samplingStage;
    const evidence = {};
    const measured = async (name, work, describe) => {
      const began = performance.now();
      try {
        const result = await work();
        evidence[name] = { elapsedMs: performance.now() - began, result: describe(result) };
        return result;
      } catch (error) {
        evidence[name] = { elapsedMs: performance.now() - began, error: failureDetails(error) };
        throw error;
      }
    };
    try {
      const [http, rpc] = await Promise.allSettled([
        measured('http', probe, result => ({ pid: result.pid, parent: result.parent, value: result.value, timestamp: result.timestamp })),
        measured('rpc', () => ownerClient.service.snapshot(), result => ({ owner: result.status.owner, phase: result.status.phase, inventoryDigest: result.inventoryDigest })),
      ]);
      if (http.status === 'rejected') throw http.reason;
      if (rpc.status === 'rejected') throw rpc.reason;
      const now = http.value, snapshot = rpc.value;
      assert.equal(now.pid, applicationPid); assert.equal(now.parent, ownerPid);
      assert.equal(snapshot.status.owner.pid, ownerPid); samples++;
    }
    catch (error) {
      failures++;
      // A failed native qualification must identify the transport/identity and
      // timing involved. Preserve the strict zero-failure acceptance criterion.
      if (failures <= 20) {
        const report = { stage: 'availability-probe-failed', during: stage, at, elapsedMs: performance.now() - started,
          eventLoopMaxMs: eventLoop.max / 1e6, error: failureDetails(error), probes: evidence };
        console.error(JSON.stringify(report));
        try { await fs.appendFile(path.join(root, 'probe-failures.jsonl'), JSON.stringify(report) + '\n'); }
        catch (writeError) { console.error(JSON.stringify({ stage: 'availability-evidence-write-failed', error: failureDetails(writeError) })); }
      }
    } finally { inFlight = false; }
  }, 20);
  const cli = (...args) => run(artifact.execPath, [path.join(artifact.directory, 'cli/omnitron.js'), ...args, '--json'], {
    env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 600_000, maxBuffer: 1024 * 1024,
  });
  // Upgrade the independent guardian first: a backend replacement cannot change
  // the guardian code already supervising it. Keep the baseline owner throughout.
  const guardianTransition = managementDist && !backendOnly ? await (async () => {
    samplingStage = 'guardian-prepare';
    await waitCertificate();
    const settled = await status();
    const { prepareSupervisorTransition, applySupervisorTransition } = await import(pathToFileURL(path.join(managementDist, 'daemon/supervisor-transition.js')).href);
    const { RuntimeInstallation: candidateInstallation } = await import(pathToFileURL(path.join(managementDist, 'daemon/runtime-installation.js')).href);
    // Historical candidates predate --check. Never give their apply command a forward plan as a dry run.
    const supportsCheck = typeof candidateInstallation.openReadOnly === 'function';
    const runner = path.resolve(managementDist, '../../../node');
    const checkPlan = async (file, expected, backendPid) => {
      if (!supportsCheck) return;
      const before = await fs.readFile(file);
      const { stdout } = await run(runner, [path.join(managementDist, 'cli/omnitron.js'), 'backend', 'guardian', 'apply', file, '--check', '--json'], {
        env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 90_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(JSON.parse(stdout).data.checked, expected);
      assert.deepEqual(await fs.readFile(file), before, 'Readiness check changed the saved plan');
      assert.equal((await status()).pid, backendPid, 'Readiness check changed the backend');
    };
    const plan = await prepareSupervisorTransition(path.resolve(managementDist, '../../..'), socket);
    assert.equal((await status()).pid, settled.pid, 'Preparation changed the backend');
    await checkPlan(plan.file, true, settled.pid);
    const prepared = JSON.parse(await fs.readFile(plan.file, 'utf8'));
    // Refuse edited native units BEFORE draining a backend.
    await fs.appendFile(prepared.unit.file, '\n<!-- changed after preparation -->\n');
    if (supportsCheck) await assert.rejects(applySupervisorTransition(plan.file, { checkOnly: true }), /unit changed since preparation|changed system guardian unit/);
    await assert.rejects(applySupervisorTransition(plan.file), /unit changed since preparation|changed system guardian unit/);
    assert.equal((await status()).pid, settled.pid);
    await fs.writeFile(prepared.unit.file, prepared.unit.before);
    if (linux) await native(['daemon-reload']);
    samplingStage = 'guardian-transition';
    const transitioned = await applySupervisorTransition(plan.file);
    assert.equal(transitioned.phase, 'complete');
    assert.equal(transitioned.result.ownerPid, ownerPid);
    assert.notEqual(transitioned.result.backendPid, settled.pid);
    assert.notEqual(transitioned.result.guardianPid, prepared.guardianPid);
    await checkPlan(plan.file, false, transitioned.result.backendPid);
    assert.equal((await applySupervisorTransition(plan.file)).result.backendPid, transitioned.result.backendPid, 'A repeated apply started another backend');
    mark({ stage: 'guardian-transition-complete', result: transitioned.result });
    await waitCertificate();
    return { prepareSupervisorTransition, applySupervisorTransition, checkPlan, runner };
  })() : null;
  if (managementDist) {
    const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
    try {
      const initialGuardian = await supervisor.service.status();
      const runner = path.resolve(managementDist, '../../../node');
      const invoke = async (...args) => JSON.parse((await run(runner, [path.join(managementDist, 'cli/omnitron.js'),
        '--json', 'backend', 'upgrade', ...args], { cwd: root, env: process.env, timeout: 300_000, maxBuffer: 1024 * 1024 })).stdout).data;
      for (const [stage, target] of [['backend-forward', managementDist], ['backend-rollback', artifact.directory]]) {
        samplingStage = stage + '-check';
        const before = await until(async () => {
          const current = await status(), guardian = await supervisor.service.status();
          return current.execution.recovery.status === 'ready' && guardian.state === 'ready' &&
            !guardian.operationPending && guardian.backendPid === current.pid ? current : null;
        }, 'Backend did not settle before qualification');
        const stamp = JSON.parse(await fs.readFile(path.join(target, 'BUILD.json'), 'utf8'));
        const checked = await invoke(target, '--check');
        assert.equal(checked.checked, true); assert.equal(checked.build.commit, stamp.commit);
        assert.equal((await status()).pid, before.pid, 'Qualification check changed the backend');
        samplingStage = stage;
        const changed = await invoke(target);
        const current = await until(async () => {
          const current = await status(), guardian = await supervisor.service.status();
          return current.pid === changed.pid && current.execution.recovery.status === 'ready' &&
            guardian.state === 'ready' && !guardian.operationPending && guardian.backendPid === current.pid ? current : null;
        }, 'Qualified backend did not settle');
        assert.equal(current.build.commit, stamp.commit); assert.equal(current.execution.owner.pid, ownerPid);
        assert.equal((await supervisor.service.status()).pid, initialGuardian.pid, 'Backend update replaced its guardian');
        assert.equal((await probe()).pid, applicationPid);
        mark({ stage, commit: stamp.commit, backendPid: current.pid, ownerPid, applicationPid, guardianPid: initialGuardian.pid });
      }
    } finally { await supervisor.close(); }
  }
  // A regular CLI must delegate, so a replacement remains a child of the OS job.
  const upgraded = JSON.parse((await cli('backend', 'upgrade', dist)).stdout).data;
  mark({ stage: 'upgraded', pid: upgraded.pid });
  assert.notEqual(upgraded.pid, first.pid); assert.equal(upgraded.ownerPid, ownerPid);
  await waitCertificate();
  samplingStage = 'backend-crash-recovery';
  process.kill(upgraded.pid, 'SIGKILL');
  const recovered = await until(async () => { const value = await status(); return value.pid !== upgraded.pid ? value : null; }, 'Killed backend was not recovered');
  assert.equal(recovered.execution.owner.pid, ownerPid);
  mark({ stage: 'backend-crash-recovered', pid: recovered.pid });
  await waitCertificate();
  const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
  const guardian = await until(async () => {
    const value = await supervisor.service.status();
    return value.state === 'ready' && value.backendPid === recovered.pid ? value : null;
  }, 'Supervisor did not commit the recovered backend');
  await supervisor.close();
  samplingStage = 'guardian-crash-recovery';
  process.kill(guardian.pid, 'SIGKILL');
  const afterGuardian = await until(async () => { const value = await status(); return value.pid !== recovered.pid ? value : null; }, 'OS did not recover the killed guardian');
  assert.equal(afterGuardian.execution.owner.pid, ownerPid);
  await waitCertificate();
  const committedGuardian = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
  try {
    await until(async () => {
      const value = await committedGuardian.service.status();
      return value.state === 'ready' && value.backendPid === afterGuardian.pid;
    }, 'Guardian has not committed its recovered backend selection');
  } finally { await committedGuardian.close(); }
  if (guardianTransition) {
    const settledGuardian = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
    try {
      await until(async () => {
        const state = await settledGuardian.service.status();
        return state.state === 'ready' && state.backendPid === afterGuardian.pid;
      }, 'Guardian has not finished publishing the recovered selection');
    } finally { await settledGuardian.close(); }
    const { prepareSupervisorTransition, applySupervisorTransition, checkPlan, runner } = guardianTransition;
    if (linux) {
      const { activateManagedTarget, managedHostCommand, planManagedRollout, reconcileManagedTarget } = await import(
        pathToFileURL(path.join(managementDist, 'services/managed-rollout.js')).href);
      const readStamp = async directory => JSON.parse(await fs.readFile(path.join(directory, 'BUILD.json'), 'utf8')).commit;
      const invoke = async request => JSON.parse((await run('/bin/sh', ['-c', managedHostCommand(request)], {
        env: { ...process.env, OMNITRON_HOME: instance, PATH: path.dirname(artifact.execPath) + ':' + process.env.PATH },
        cwd: root, timeout: 480_000, maxBuffer: 1024 * 1024,
      })).stdout);
      const next = await planManagedRollout(invoke, await readStamp(managementDist));
      assert.notEqual(next.previous, next.candidate, 'Use distinct old and new builds for managed fleet qualification');
      assert.equal(next.ownerPid, ownerPid);
      await activateManagedTarget(invoke, next);
      assert.equal(await reconcileManagedTarget(invoke, next), 'candidate');
      const { createDaemonClient: connectCandidate } = await import(pathToFileURL(path.join(managementDist, 'daemon/daemon-client.js')).href);
      const candidate = connectCandidate(socket, 90_000);
      try {
        const { execution } = await candidate.status();
        assert.equal(execution.owner.pid, ownerPid);
        const observation = { owner: execution.owner, epoch: execution.epoch };
        const build = await candidate.attestApplicationOwner(observation);
        assert.equal(build.commit, await readStamp(dist));
        assert.equal(build.dirty, false);
        await assert.rejects(candidate.attestApplicationOwner({ ...observation, epoch: observation.epoch + 1 }));
      } finally { await candidate.disconnect(); }
      const stale = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor', 150_000);
      try {
        await assert.rejects(stale.service.upgradeIfCurrent({ current: next.previous, candidate: next.candidate,
          selectionRevision: next.selectionRevision, backendPid: next.backendPid, ownerId: next.ownerId,
          ownerPid, appsDigest: next.appsDigest }), /selection changed since rollout planning/);
      } finally { await stale.close(); }
      await waitCertificate();
      const previous = await planManagedRollout(invoke, await readStamp(dist));
      assert.equal(previous.previous, next.candidate); assert.equal(previous.candidate, next.previous);
      await activateManagedTarget(invoke, previous);
      assert.equal(await reconcileManagedTarget(invoke, previous), 'candidate');
      mark({ stage: 'fenced-managed-kernel-returned', ownerPid, applicationPid, candidate: next.candidate });
      await waitCertificate();
    }
    samplingStage = 'guardian-rollback';
    const rollback = await prepareSupervisorTransition(path.resolve(dist, '../../..'), socket);
    await checkPlan(rollback.file, true, (await status()).pid);
    const script = `import { applySupervisorTransition } from ${JSON.stringify(pathToFileURL(path.join(managementDist, 'daemon/supervisor-transition.js')).href)};await applySupervisorTransition(${JSON.stringify(rollback.file)});`;
    let completed;
    const interruptionBudgetMs = 180_000;
    const coordinator = execFile(runner, ['--input-type=module', '--eval', script], {
      env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: interruptionBudgetMs + 5000, maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => { completed = { ...(error && { error: failureDetails(error) }), stdout, stderr }; });
    try {
      // Include full sealed-artifact verification in the coordinator's budget.
      // A terminal child failure must not be swallowed by the retrying readiness helper.
      const deadline = Date.now() + interruptionBudgetMs;
      let interrupted, saved;
      while (Date.now() < deadline) {
        saved = JSON.parse(await fs.readFile(rollback.file, 'utf8'));
        if (completed) throw new Error('Coordinator exited before interruption: ' + JSON.stringify(completed));
        if (['retired', 'stopped', 'configured', 'started'].includes(saved.phase)) { interrupted = saved; break; }
        if (saved.phase === 'complete') throw new Error('Coordinator finished before interruption');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(interrupted, `Coordinator did not reach a recoverable phase within ${interruptionBudgetMs} ms; last phase=${saved?.phase}; inspect ${root}`);
      coordinator.kill('SIGKILL');
      await until(() => completed, 'Fixture coordinator did not exit', 5000);
      mark({ stage: 'guardian-coordinator-killed', phase: interrupted.phase });
      const resumed = await applySupervisorTransition(rollback.file);
      assert.equal(resumed.phase, 'complete'); assert.equal(resumed.result.ownerPid, ownerPid);
      mark({ stage: 'guardian-transition-resumed', result: resumed.result });
    } finally {
      if (!completed) coordinator.kill('SIGKILL');
      await until(() => completed, 'Fixture coordinator did not exit after cleanup', 5000);
      await fs.writeFile(path.join(root, 'coordinator-result.json'), JSON.stringify(completed, null, 2) + '\n');
    }
  }
  const after = await probe();
  console.log(JSON.stringify({ stage: 'availability-summary', samples, failures, eventLoopMaxMs: eventLoop.max / 1e6 }));
  assert.ok(after.value > before.value); assert.equal(failures, 0);
  if (linux && process.env.OMNITRON_RUNTIME_PROBE) {
    const { runtimeProbeCommand } = await import(pathToFileURL(process.env.OMNITRON_RUNTIME_PROBE).href);
    const bundle = { root: path.dirname(dist), version: first.version, commit: first.build.commit };
    const options = { env: { ...process.env, OMNITRON_HOME: instance }, timeout: 60_000, maxBuffer: 1024 * 1024 };
    const detected = JSON.parse((await run('/bin/sh', ['-c', runtimeProbeCommand(bundle, (await status()).pid)], options)).stdout);
    assert.equal(detected.kind, 'managed'); assert.equal(detected.ownerPid, ownerPid);
    await assert.rejects(run('/bin/sh', ['-c', runtimeProbeCommand(bundle, applicationPid)], options), /no recognized entry/);
    console.log(JSON.stringify({ stage: 'remote-inspection-verified', ownerPid, backendPid: afterGuardian.pid }));
  }
  await fetch(`http://127.0.0.1:${address.port}/pause`);
  const expected = (await fs.readFile(path.join(root, 'expected.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const require = createRequire(path.join(artifact.directory, '../package.json'));
  const Database = require('better-sqlite3');
  await until(async () => {
    const db = new Database(path.join(instance, 'data/slave.db'), { readonly: true, fileMustExist: true });
    try {
      const records = db.prepare("SELECT payload FROM sync_buffer WHERE category='logs'").all()
        .map(row => JSON.parse(row.payload)).filter(row => row.message?.startsWith(`fixture:${id}:`));
      if (records.length < expected.length) return false;
      assert.equal(records.length, expected.length, 'Duplicate fixture log deliveries');
      const actual = records.map(row => ({ time: new Date(row.timestamp).toISOString(), msg: row.message }))
        .sort((a, b) => a.msg.localeCompare(b.msg));
      assert.deepEqual(actual, expected.map(({ time, msg }) => ({ time, msg })).sort((a, b) => a.msg.localeCompare(b.msg)));
      return true;
    } finally { db.close(); }
  }, 'Exact multiline logs did not reach the durable outbox');
  console.log(JSON.stringify({ test: linux ? 'independent-systemd-supervision' : 'independent-launchd-supervision', root, ownerPid, applicationPid,
    backends: [first.pid, upgraded.pid, recovered.pid, afterGuardian.pid], killedGuardian: guardian.pid, samples, failures, verifiedLogs: expected.length }));
} finally {
  if (sampler) clearInterval(sampler);
  while (inFlight) await new Promise(resolve => setTimeout(resolve, 10));
  if (sampler) {
    const summary = { stage: 'availability-final', during: samplingStage, samples, failures, eventLoopMaxMs: eventLoop.max / 1e6 };
    console.log(JSON.stringify(summary));
    await fs.writeFile(path.join(root, 'availability-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  eventLoop.disable();
  await ownerClient?.close();
  for (const unit of units.toReversed()) await native(linux ? ['stop', unit.job] : ['bootout', unit.job]).catch(() => {});
  if (ownerPid) await until(() => !PidManager.isProcessAlive(ownerPid), 'Fixture owner did not stop', 35_000);
  if (applicationPid) assert.equal(PidManager.isProcessAlive(applicationPid), false, 'Fixture app survived normal owner shutdown');
  if (linux) {
    for (const unit of units) await fs.unlink(unit.file);
    await native(['daemon-reload']);
    await native(['reset-failed', ...units.map(unit => unit.job)]).catch(() => {});
  }
}
// Retain failed fixtures for diagnosis. Successful runs release their private runtime copies.
if (process.env.OMNITRON_KEEP_TEST_ARTIFACTS !== '1') await fs.rm(root, { recursive: true, force: true });
