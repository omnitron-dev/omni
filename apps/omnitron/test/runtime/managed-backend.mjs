import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reserveDaemonPorts } from './fixture-ports.mjs';
import { applicationSdkOption } from './managed-project-runtime.mjs';
import { initialRuntimeDirectories, readMasterFixture, removeOwnedFixtureRoot } from './fixture-master-options.mjs';
import { preparationOption, prepareFixture, claimPreparedFixture, consumeFixture, verifyPreparedFixture,
  assertPreparedFixtureIdle } from './fixture-preparation.mjs';
import { verifyFixtureLogs } from './fixture-log-evidence.mjs';
import { createFixtureUnitFiles, assertFixtureUnitFilesOwned, removeFixtureUnitFiles, authorizeFixtureUnitWrite, authorizeFixtureGuardianReplacement } from './fixture-unit-files.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { prepareRecoveryTopology, managedReviewedRecovery } from './managed-reviewed-recovery.mjs';

assert.ok(['darwin', 'linux'].includes(process.platform), 'This fixture requires native service supervision');
const linux = process.platform === 'linux';
if (linux) assert.equal(process.getuid(), 0, 'Linux fixture needs an isolated system service, independent of SSH login');
const preparation = preparationOption(process.argv.slice(2));
const masterFixture = await readMasterFixture(process.argv.slice(2), process.env);
let dist = path.resolve(process.argv[2]);
assert.ok(dist.includes('omnitron-handoff-'), 'Use a disposable sealed test artifact');
let managementDist = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (managementDist) assert.ok(managementDist.includes('omnitron-handoff-'), 'Use a disposable management artifact');
// Qualify an exact baseline -> candidate -> baseline with the baseline owner and
// guardian retained. This is the same CLI path used by a backend-only rollout.
const backendOnly = process.argv.includes('--backend-only');
if (backendOnly) assert.ok(managementDist, 'Provide the candidate artifact before --backend-only');
const ownerRoundtrip = process.argv.includes('--owner-roundtrip');
const reviewedRecovery = process.argv.includes('--reviewed-recovery');
assert.ok(!reviewedRecovery || managementDist && !backendOnly && !ownerRoundtrip && !masterFixture,
  'Reviewed recovery requires its exact isolated guardian scenario');
assert.ok(!(backendOnly && ownerRoundtrip), 'Choose backend-only or owner-roundtrip qualification');
if (ownerRoundtrip) assert.ok(managementDist, 'Owner replacement requires an independently built candidate');
const applicationSdk = await applicationSdkOption(process.argv.slice(2), managementDist ?? dist);
const { initialBackendDist, initialGuardianDist } = initialRuntimeDirectories(process.argv.slice(2), dist, managementDist);
const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));
const inputs = { owner: path.resolve(dist, '../../..'), backend: path.resolve(initialBackendDist, '../../..'),
  guardian: path.resolve(initialGuardianDist, '../../..'), candidate: managementDist ? path.resolve(managementDist, '../../..') : null };
const prepared = preparation?.mode === 'execute'
  ? await claimPreparedFixture({ file: preparation.receipt, inputs, fixtureDirectory,
    scenario: reviewedRecovery ? 'reviewed-recovery' : 'ordinary' }) : undefined;
const root = prepared?.root ?? (masterFixture ? masterFixture.root : await fs.mkdtemp(path.join(os.tmpdir(), 'omni-managed-')));
if (masterFixture) await fs.mkdir(root, { mode: 0o700 });
const rootIdentity = prepared?.rootIdentity ?? await fs.lstat(root);
const id = prepared?.receipt.id ?? randomUUID();
console.log(JSON.stringify({ stage: 'fixture-created', root, pid: process.pid }));
// Independent registered projects must be siblings, not nested registrations.
const projectDirectory = applicationSdk ? path.join(root, 'probe') : root;
if (projectDirectory !== root) await fs.mkdir(projectDirectory, { mode: 0o700 });
const instance = path.join(root, 'i'), execution = path.join(root, 'e');
if (!prepared) for (const directory of [instance, execution]) await fs.mkdir(directory, { mode: 0o700 });
const applicationTemporary = applicationSdk ? path.join(root, 't') : undefined;
if (applicationTemporary) {
  await fs.mkdir(applicationTemporary, { mode: 0o700 });
  process.env.TMPDIR = applicationTemporary;
}
process.env.OMNITRON_HOME = instance;
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { RuntimeInstallation } = await load('daemon/runtime-installation.js');
const execute = promisify(execFile);
const reportPreparation = event => console.log(JSON.stringify({ ...event, at: new Date().toISOString() }));
let artifacts;
if (prepared) {
  await assertPreparedFixtureIdle(prepared, execute);
  artifacts = await verifyPreparedFixture(prepared, RuntimeInstallation, reportPreparation);
} else {
  const result = await prepareFixture({ root, id, inputs, RuntimeInstallation, fixtureDirectory, mark: reportPreparation,
    scenario: masterFixture ? 'master' : ownerRoundtrip ? 'owner-roundtrip' : backendOnly ? 'backend-only' : reviewedRecovery ? 'reviewed-recovery' : 'ordinary' });
  if (preparation?.mode === 'prepare') {
    reportPreparation({ stage: 'fixture-prepared', root, receipt: result.file, elapsedMs: result.receipt.elapsedMs,
      inputs: result.receipt.inputs, servicesStarted: false });
    process.exit(0);
  }
  await consumeFixture(result);
  artifacts = result.artifacts;
}
const artifact = artifacts.owner, initialBackend = artifacts.backend, initialGuardian = artifacts.guardian;
// Subsequent fixture imports and CLI operations use the verified private copies.
dist = artifact.directory;
managementDist = artifacts.candidate?.directory;
const { renderLaunchdPlist, renderSystemdUnit: nativeSystemdUnit } = await load('commands/service-units.js');
const renderSystemdUnit = inputs => {
  const unit = nativeSystemdUnit(inputs);
  if (!ownerRoundtrip && !masterFixture) return unit;
  // Every cold-roundtrip unit is rendered here, including rollback. These
  // limits cover each service's descendants, independently of the SSH shell.
  assert.ok(unit.includes('[Service]\n'));
  const memory = applicationSdk && inputs.args?.[0] === 'owner' ? '4G' : '2G';
  return unit.replace('[Service]\n', `[Service]\nMemoryMax=${memory}\nCPUQuota=100%\nTasksMax=128\n`);
};
const { createDaemonClient } = await load('daemon/daemon-client.js');
const { privateControlClient } = await load('daemon/private-control-client.js');
const { PidManager } = await load('daemon/pid-manager.js');
let interrupted = false;
const assertActive = () => { if (interrupted) throw new Error('Private native fixture was interrupted'); };
const run = (...args) => { assertActive(); return execute(...args); };
const native = (args, cleanup = false) => {
  if (!cleanup) assertActive();
  return execute(linux ? 'systemctl' : '/bin/launchctl', args, { timeout: 45_000, maxBuffer: 1024 * 1024 });
};
const domain = `gui/${process.getuid()}`;
const { httpPort: port, ports: [tcpPort, counterPort], release } = await reserveDaemonPorts(masterFixture ? 1 : 2, masterFixture?.requestedPorts);
const readiness = { intervalMs: 1000, timeoutMs: 1000, probes: [
  { name: 'counter HTTP', type: 'http', url: `http://127.0.0.1:${counterPort}/health`, expect: { fixture: id, ready: true } },
] };
const config = { protocol: 1, instanceHome: instance, directory: execution, scope: linux ? 'system' : 'user', cwd: root,
  environment: { OMNITRON_HOME: instance, OMNITRON_NO_INFRA: '1', OMNITRON_NO_WATCH: applicationSdk ? '0' : '1', PATH: process.env.PATH,
    ...(applicationTemporary && { TMPDIR: applicationTemporary }),
    ...(masterFixture && { OMNITRON_DATABASE_URL: masterFixture.databaseUrl, ...masterFixture.dockerEnvironment }) },
  owner: { label: `dev.omnitron.fixture.${id}.owner`, unit: `omnitron-fixture-${id}-owner.service`, artifact: artifact.runtimeHash },
  backend: { label: `dev.omnitron.fixture.${id}.backend`, unit: `omnitron-fixture-${id}-backend.service`, artifact: initialGuardian.runtimeHash },
};
const units = [];
let nativeActivationStarted = false, unitSetupPromise;
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
let sampler, inFlight = false, samples = 0, failures = 0, ownerPid, ownerId, applicationPid, ownerClient;
const ownerRoundtripPids = new Set();
let samplingStage = 'cold-start';
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const mark = event => {
  samplingStage = event.stage ?? samplingStage;
  console.log(JSON.stringify(event));
};
const failureDetails = error => ({ name: error?.name, message: error?.message ?? String(error),
  ...(error?.code !== undefined && { code: error.code }), ...(error?.cause && { cause: String(error.cause) }) });
let cleanupPromise;
const cleanup = () => cleanupPromise ??= (async () => {
  await release();
  // A signal during an asynchronous write must wait before inspecting owned files.
  await unitSetupPromise?.catch(() => {});
  if (sampler) clearInterval(sampler);
  while (inFlight) await new Promise(resolve => setTimeout(resolve, 10));
  if (sampler) {
    const summary = { stage: 'availability-final', during: samplingStage, samples, failures, eventLoopMaxMs: eventLoop.max / 1e6 };
    console.log(JSON.stringify(summary));
    await fs.writeFile(path.join(root, 'availability-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  eventLoop.disable();
  await ownerClient?.close();
  await assertFixtureUnitFilesOwned(units);
  if (nativeActivationStarted) for (const unit of units.toReversed()) await native(linux ? ['stop', unit.job] : ['bootout', unit.job], true).catch(() => {});
  if (ownerPid) await until(() => !PidManager.isProcessAlive(ownerPid), 'Fixture owner did not stop', 35_000);
  if (applicationPid) assert.equal(PidManager.isProcessAlive(applicationPid), false, 'Fixture app survived normal owner shutdown');
  for (const pid of ownerRoundtripPids) await until(() => !PidManager.isProcessAlive(pid), `Owner-roundtrip fixture process ${pid} survived cleanup`, 35_000);
  await removeFixtureUnitFiles(units);
  if (linux && nativeActivationStarted) {
    await native(['daemon-reload'], true);
    await native(['reset-failed', ...units.map(unit => unit.job)], true).catch(() => {});
  }
})();
const interrupt = signal => {
  if (interrupted) return;
  interrupted = true;
  console.error(JSON.stringify({ stage: 'fixture-interrupted', signal, root }));
  void cleanup().then(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)), error => {
    console.error(error); process.exit(1);
  });
};
process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
try {
  unitSetupPromise = (async () => {
    await fs.writeFile(path.join(instance, 'config.json'), JSON.stringify(masterFixture?.daemonConfig ?? { role: 'slave', port: tcpPort, httpPort: port,
      executionHost: { enabled: true, directory: execution } }), { mode: 0o600 });
    await fs.writeFile(path.join(instance, 'runtime/supervision.json'), JSON.stringify(config), { mode: 0o600 });
    if (masterFixture) {
      await fs.writeFile(path.join(root, 'omnitron.config.mjs'), 'export default { apps: [], stacks: {} };\n', { mode: 0o600 });
    } else {
    await fs.mkdir(path.join(projectDirectory, 'source'));
    await fs.writeFile(path.join(projectDirectory, 'source/value.json'), '0\n');
    // A built dependency outside the watched source directory refreshes only
    // through the public owner receipt, not an incidental native file event.
    await fs.writeFile(path.join(projectDirectory, 'sdk-value.json'), '0\n');
    await fs.writeFile(path.join(projectDirectory, 'counter.mjs'), `import http from 'node:http';import fs from 'node:fs';
     const sdkRevision=JSON.parse(fs.readFileSync(new URL('./sdk-value.json',import.meta.url),'utf8'));
     const sourceRevision=JSON.parse(fs.readFileSync(new URL('./source/value.json',import.meta.url),'utf8'));
     let value=0,sequence=0,paused=false;setInterval(()=>value++,5);
     setInterval(()=>{if(paused)return;const record={level:30,time:new Date().toISOString(),msg:'fixture:${id}:'+process.pid+':'+sdkRevision+':'+sourceRevision+':'+sequence+++'\\n  first continuation\\n  second continuation'};
     const began=performance.now();fs.appendFileSync(${JSON.stringify(path.join(root, 'expected.jsonl'))},JSON.stringify(record)+'\\n');
     const evidenceWriteMs=performance.now()-began;if(evidenceWriteMs>=500)process.stderr.write(JSON.stringify({level:40,time:new Date().toISOString(),msg:'fixture evidence write blocked',evidenceWriteMs})+'\\n');
     process.stdout.write(JSON.stringify(record)+'\\n');},50);
     const server=http.createServer((q,r)=>{if(q.url==='/pause')paused=true;r.end(JSON.stringify({pid:process.pid,parent:process.ppid,value,sdkRevision,sourceRevision,fixture:${JSON.stringify(id)},ready:true,timestamp:new Date().toISOString()}));});
     server.listen(${counterPort},'127.0.0.1',()=>{fs.writeFileSync(${JSON.stringify(path.join(root, 'address.json'))},JSON.stringify(server.address()));process.send?.({type:'ready'});});
     process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
    if (reviewedRecovery) await prepareRecoveryTopology(root, artifact.directory);
    await fs.writeFile(path.join(projectDirectory, 'omnitron.config.mjs'), `export default {${ownerRoundtrip ? "project:'probe',stacks:{local:{type:'local',apps:'all',infrastructureOwnership:'external'}}," : ''}apps:[{name:'counter',script:'./counter.mjs',cwd:${JSON.stringify(projectDirectory)},enabled:true,watch:${ownerRoundtrip ? "'source'" : 'false'},readiness:${JSON.stringify(readiness)}}${reviewedRecovery ? ",{name:'topology',bootstrap:'./topology.mjs',enabled:true}" : ''}]};`);
    }
    const definitions = [];
    for (const mode of ['owner', 'backend']) {
      const systemUnitDir = managementDist ? '/etc/systemd/system' : '/run/systemd/system';
      const file = linux ? path.join(systemUnitDir, config[mode].unit) : path.join(root, `${mode}.plist`);
      const render = linux ? renderSystemdUnit : renderLaunchdPlist;
      const serviceArtifact = mode === 'owner' ? artifact : initialGuardian;
      const contents = render({ scope: config.scope, execPath: serviceArtifact.execPath,
        entryPath: path.join(serviceArtifact.directory, 'daemon/managed-entry.js'), args: [mode], label: config[mode].label,
        nodeArgs: [],
        restart: mode === 'backend', workdir: path.dirname(serviceArtifact.directory), path: process.env.PATH,
        identity: linux ? { user: 'root', home: os.homedir() } : undefined,
        environment: { OMNITRON_HOME: instance }, stderrLog: path.join(root, `${mode}.log`) });
      definitions.push({ mode, file, job: linux ? config[mode].unit : `${domain}/${config[mode].label}`, contents });
    }
    await createFixtureUnitFiles(definitions, units, unit =>
      run(linux ? 'systemd-analyze' : '/usr/bin/plutil', linux ? ['verify', unit.file] : ['-lint', unit.file]));
  })();
  await unitSetupPromise;
  assertActive();
  nativeActivationStarted = true;
  if (linux) await native(['daemon-reload']);
  // Linux btime is rounded to seconds. Keep sealed file timestamps strictly before
  // the conservative process birth used by legacy-owner attestation.
  if (linux && managementDist) await new Promise(resolve => setTimeout(resolve, 1100));
  await release();
  for (const unit of units) await native(linux ? ['start', unit.job] : ['bootstrap', domain, unit.file]);
  let first = await until(status, 'Initial managed backend did not start');
  assert.equal(first.build?.commit, initialBackend.build.commit, 'Initial backend did not use its selected runtime');
  assert.equal(first.build?.dirty, false);
  mark({ stage: 'cold-start', root, backend: first.pid, owner: first.execution.owner.pid,
    initialRuntimes: { owner: { hash: artifact.runtimeHash, build: artifact.build },
      backend: { hash: initialBackend.runtimeHash, build: initialBackend.build },
      guardian: { hash: initialGuardian.runtimeHash, build: initialGuardian.build } } });
  ownerPid = first.execution.owner.pid;
  ownerId = first.execution.owner.id;
  const initialNativePids = {};
  for (const unit of units) {
    const observed = await native(linux ? ['show', unit.job, '--property=MainPID', '--value'] : ['print', unit.job]);
    const pid = Number(linux ? observed.stdout.trim() : observed.stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1]);
    assert.ok(Number.isSafeInteger(pid) && pid > 1, 'Private native unit has no process identity');
    initialNativePids[unit.mode] = pid;
  }
  assert.equal(initialNativePids.owner, ownerPid, 'Backend reported another native execution owner');
  assert.equal(first.execution.supervision.guardianPid, initialNativePids.backend, 'Backend reported another native guardian');
  if (masterFixture) {
    ownerRoundtripPids.add(first.pid); ownerRoundtripPids.add(ownerPid);
    for (const pid of Object.values(initialNativePids)) ownerRoundtripPids.add(pid);
    const createClient = () => createDaemonClient(socket, 60_000);
    const check = createClient();
    try {
      const releaseService = await check.service('OmnitronRelease');
      const releases = await releaseService.list();
      assert.ok(Array.isArray(releases.releases)); assert.equal(releases.root, path.join(instance, 'releases'));
      const missingId = `fixture-${id}-absent`;
      await assert.rejects(releaseService.get({ id: missingId }), error =>
        typeof error?.message === 'string' && error.message.startsWith(`No release '${missingId}' on this machine`));
      assert.ok(Array.isArray(await (await check.service('OmnitronProject')).listProjects()));
    } finally { await check.disconnect(); }
    mark({ stage: 'canonical-master-ready', root, instance, execution, port: tcpPort, httpPort: port, backend: first.pid, owner: ownerPid });
    const { managedMasterScenario } = await import(pathToFileURL(masterFixture.scenario).href);
    assert.equal(typeof managedMasterScenario, 'function', 'Scenario must export managedMasterScenario');
    const result = await managedMasterScenario(Object.freeze({ root, instance, execution, first, artifact, managementDist, fixtureId: id,
      createClient, run, status, until, assertActive, mark,
      track: (...pids) => { for (const pid of pids) { assert.ok(Number.isSafeInteger(pid) && pid > 0); ownerRoundtripPids.add(pid); } } }));
    assert.equal(result?.success, true, 'Master scenario must report success');
    console.log(JSON.stringify(result));
  } else if (ownerRoundtrip) {
    const { managedOwnerRoundtrip } = await import('./managed-owner-roundtrip.mjs');
    const result = await managedOwnerRoundtrip({ root, projectDirectory, instance, execution, config, units, first, artifact, initialBackend, initialGuardian, fixtureId: id,
      managementDist, applicationSdk, run, native, domain, linux, until, status, assertActive, render: linux ? renderSystemdUnit : renderLaunchdPlist,
      track: (...pids) => { for (const pid of pids) { assert.ok(Number.isSafeInteger(pid) && pid > 0); ownerRoundtripPids.add(pid); } }, mark, authorizeUnitWrite: authorizeFixtureUnitWrite });
    ownerPid = result.rounds.at(-1).ownerPid;
    applicationPid = result.rounds.at(-1).applicationPid;
    console.log(JSON.stringify(result));
  } else {
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
      assert.equal(snapshot.status.owner.pid, ownerPid); assert.equal(snapshot.status.owner.id, ownerId); samples++;
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
  const cli = (...args) => run(initialBackend.execPath, [path.join(initialBackend.directory, 'cli/omnitron.js'), ...args, '--json'], {
    env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 600_000, maxBuffer: 1024 * 1024,
  });
  const require = createRequire(path.join(initialBackend.directory, '../package.json'));
  const Database = require('better-sqlite3');
  const migrationHistory = () => {
    const db = new Database(path.join(instance, 'data/slave.db'), { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT * FROM migrations ORDER BY name').all(); } finally { db.close(); }
  };
  const originalHistory = migrationHistory();
  assert.ok(originalHistory.length > 0, 'The baseline did not create its migration journal');
  const assertHistoryPreserved = stage => {
    assert.deepEqual(migrationHistory(), originalHistory, `${stage}: migration journal was rewritten`);
  };
  if (reviewedRecovery) {
    const result = await managedReviewedRecovery({ root, instance, execution, units, first, initialBackend, initialGuardian,
      managementDist, ownerClient, applicationPid, probe, status, until, run, mark,
      authorizeReplacement: authorizeFixtureGuardianReplacement });
    clearInterval(sampler);
    while (inFlight) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(failures, 0, 'Reviewed recovery interrupted application HTTP or owner RPC');
    const verifiedLogs = await verifyFixtureLogs({ root, instance, runtime: initialBackend.runtimeRoot, fixtureId: id, until });
    assertHistoryPreserved('reviewed-recovery');
    console.log(JSON.stringify({ test: 'native-reviewed-backend-recovery', root, samples, failures, verifiedLogs,
      preservedMigrationHistoryRows: originalHistory.length, ...result }));
  } else {
  if (managementDist && !backendOnly) {
    const { assertBackendMigrationsCompatible } = await import(pathToFileURL(path.join(managementDist, 'daemon/backend-candidate.js')).href);
    const compatibility = await assertBackendMigrationsCompatible(initialBackend.directory, managementDist, 'node');
    if (compatibility?.kind === 'checksum-metadata') {
      const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
      let capable;
      try { capable = (await supervisor.service.status()).migrationChecksumMetadata === 1; } finally { await supervisor.close(); }
      if (!capable) {
        const baselinePid = (await status()).pid;
        // Full sealed-artifact admission uses the same outer CLI budget as
        // upgrade below; this does not relax native or application readiness.
        await assert.rejects(run(path.resolve(managementDist, '../../../node'), [path.join(managementDist, 'cli/omnitron.js'),
          '--json', 'backend', 'upgrade', managementDist, '--check'], { cwd: root, env: process.env, timeout: 300_000 }), /backend guardian transition/);
        assert.equal((await status()).pid, baselinePid, 'Unsupported guardian check changed the backend');
        assert.equal((await probe()).pid, applicationPid);
        assertHistoryPreserved('legacy-guardian-refusal');
        mark({ stage: 'legacy-guardian-refusal', ownerPid, applicationPid, journalRows: originalHistory.length });
      }
    }
  }
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
      const planBeforeCheck = await fs.readFile(file);
      // A plan can inspect three distinct sealed runtimes before any drain.
      const { stdout } = await run(runner, [path.join(managementDist, 'cli/omnitron.js'), 'backend', 'guardian', 'apply', file, '--check', '--json'], {
        env: { ...process.env, OMNITRON_HOME: instance }, cwd: root, timeout: 300_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(JSON.parse(stdout).data.checked, expected);
      assert.deepEqual(await fs.readFile(file), planBeforeCheck, 'Readiness check changed the saved plan');
      assert.equal((await status()).pid, backendPid, 'Readiness check changed the backend');
    };
    const plan = await prepareSupervisorTransition(path.resolve(managementDist, '../../..'), socket);
    assert.equal((await status()).pid, settled.pid, 'Preparation changed the backend');
    await checkPlan(plan.file, true, settled.pid);
    const prepared = JSON.parse(await fs.readFile(plan.file, 'utf8'));
    // Refuse edited native units BEFORE draining a backend.
    const guardianUnit = units.find(unit => unit.file === prepared.unit.file);
    await authorizeFixtureUnitWrite(guardianUnit, prepared.unit.before + '\n<!-- changed after preparation -->\n');
    await fs.appendFile(prepared.unit.file, '\n<!-- changed after preparation -->\n');
    if (supportsCheck) await assert.rejects(applySupervisorTransition(plan.file, { checkOnly: true }), /unit changed since preparation|changed system guardian unit/);
    await assert.rejects(applySupervisorTransition(plan.file), /unit changed since preparation|changed system guardian unit/);
    assert.equal((await status()).pid, settled.pid);
    await authorizeFixtureUnitWrite(guardianUnit, prepared.unit.before);
    await fs.writeFile(prepared.unit.file, prepared.unit.before);
    if (linux) await native(['daemon-reload']);
    await authorizeFixtureGuardianReplacement(units, plan.file, prepared, instance);
    samplingStage = 'guardian-transition';
    const transitioned = await applySupervisorTransition(plan.file);
    assert.equal(transitioned.phase, 'complete');
    assert.equal(transitioned.result.ownerPid, ownerPid);
    assert.notEqual(transitioned.result.backendPid, settled.pid);
    assert.notEqual(transitioned.result.guardianPid, prepared.guardianPid);
    assert.equal((await status()).build.commit, initialBackend.build.commit, 'Guardian transition changed the selected backend runtime');
    assert.equal((await probe()).pid, applicationPid, 'Guardian transition restarted the application');
    assertHistoryPreserved('guardian-transition');
    await checkPlan(plan.file, false, transitioned.result.backendPid);
    assert.equal((await applySupervisorTransition(plan.file)).result.backendPid, transitioned.result.backendPid, 'A repeated apply started another backend');
    mark({ stage: 'guardian-transition-complete', result: transitioned.result });
    await waitCertificate();
    return { prepareSupervisorTransition, applySupervisorTransition, checkPlan, runner };
  })() : null;
  if (managementDist) {
    const supervisor = await privateControlClient(path.join(execution, 'supervisor.sock'), 'OmnitronSupervisor');
    try {
      const guardianBeforeUpdates = await supervisor.service.status();
      const runner = path.resolve(managementDist, '../../../node');
      const invoke = async (...args) => JSON.parse((await run(runner, [path.join(managementDist, 'cli/omnitron.js'),
        '--json', 'backend', 'upgrade', ...args], { cwd: root, env: process.env, timeout: 300_000, maxBuffer: 1024 * 1024 })).stdout).data;
      for (const [stage, target] of [['backend-forward', managementDist], ['backend-rollback', initialBackend.directory]]) {
        samplingStage = stage + '-check';
        const backendBeforeUpdate = await until(async () => {
          const current = await status(), guardian = await supervisor.service.status();
          return current.execution.recovery.status === 'ready' && guardian.state === 'ready' &&
            !guardian.operationPending && guardian.backendPid === current.pid ? current : null;
        }, 'Backend did not settle before qualification');
        const stamp = JSON.parse(await fs.readFile(path.join(target, 'BUILD.json'), 'utf8'));
        const checked = await invoke(target, '--check');
        assert.equal(checked.checked, true); assert.equal(checked.build.commit, stamp.commit);
        assert.equal((await status()).pid, backendBeforeUpdate.pid, 'Qualification check changed the backend');
        samplingStage = stage;
        const changed = await invoke(target);
        const current = await until(async () => {
          const observed = await status(), guardian = await supervisor.service.status();
          return observed.pid === changed.pid && observed.execution.recovery.status === 'ready' &&
            guardian.state === 'ready' && !guardian.operationPending && guardian.backendPid === observed.pid ? observed : null;
        }, 'Qualified backend did not settle');
        assert.equal(current.build.commit, stamp.commit); assert.equal(current.execution.owner.pid, ownerPid);
        assert.equal(current.execution.owner.id, ownerId);
        assert.equal((await supervisor.service.status()).pid, guardianBeforeUpdates.pid, 'Backend update replaced its guardian');
        assert.equal((await probe()).pid, applicationPid);
        assertHistoryPreserved(stage);
        mark({ stage, commit: stamp.commit, backendPid: current.pid, ownerPid, applicationPid, guardianPid: guardianBeforeUpdates.pid });
      }
    } finally { await supervisor.close(); }
  }
  // A regular CLI must delegate, so a replacement remains a child of the OS job.
  const upgraded = JSON.parse((await cli('backend', 'upgrade', initialBackend.directory)).stdout).data;
  assert.equal(upgraded.build.commit, initialBackend.build.commit);
  mark({ stage: 'upgraded', pid: upgraded.pid });
  assert.notEqual(upgraded.pid, first.pid); assert.equal(upgraded.ownerPid, ownerPid);
  await waitCertificate();
  samplingStage = 'backend-crash-recovery';
  process.kill(upgraded.pid, 'SIGKILL');
  const recovered = await until(async () => { const value = await status(); return value.pid !== upgraded.pid ? value : null; }, 'Killed backend was not recovered');
  assert.equal(recovered.execution.owner.pid, ownerPid);
  assert.equal(recovered.build.commit, initialBackend.build.commit, 'Crash recovery selected the owner runtime as the backend');
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
  assert.equal(afterGuardian.build.commit, initialBackend.build.commit, 'Guardian recovery selected the owner runtime as the backend');
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
        const { execution: observedExecution } = await candidate.status();
        assert.equal(observedExecution.owner.pid, ownerPid);
        const observation = { owner: observedExecution.owner, epoch: observedExecution.epoch };
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
      const previous = await planManagedRollout(invoke, initialBackend.build.commit);
      assert.equal(previous.previous, next.candidate); assert.equal(previous.candidate, next.previous);
      await activateManagedTarget(invoke, previous);
      assert.equal(await reconcileManagedTarget(invoke, previous), 'candidate');
      mark({ stage: 'fenced-managed-kernel-returned', ownerPid, applicationPid, candidate: next.candidate });
      await waitCertificate();
    }
    samplingStage = 'guardian-rollback';
    const rollback = await prepareSupervisorTransition(initialGuardian.runtimeRoot, socket);
    await checkPlan(rollback.file, true, (await status()).pid);
    await authorizeFixtureGuardianReplacement(units, rollback.file, JSON.parse(await fs.readFile(rollback.file, 'utf8')), instance);
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
      let interruptedPlan, saved;
      while (Date.now() < deadline) {
        saved = JSON.parse(await fs.readFile(rollback.file, 'utf8'));
        if (completed) throw new Error('Coordinator exited before interruption: ' + JSON.stringify(completed));
        if (['retired', 'stopped', 'configured', 'started'].includes(saved.phase)) { interruptedPlan = saved; break; }
        if (saved.phase === 'complete') throw new Error('Coordinator finished before interruption');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(interruptedPlan, `Coordinator did not reach a recoverable phase within ${interruptionBudgetMs} ms; last phase=${saved?.phase}; inspect ${root}`);
      coordinator.kill('SIGKILL');
      await until(() => completed, 'Fixture coordinator did not exit', 5000);
      mark({ stage: 'guardian-coordinator-killed', phase: interruptedPlan.phase });
      const resumed = await applySupervisorTransition(rollback.file);
      assert.equal(resumed.phase, 'complete'); assert.equal(resumed.result.ownerPid, ownerPid);
      assert.equal((await status()).build.commit, initialBackend.build.commit, 'Guardian rollback changed the baseline backend');
      mark({ stage: 'guardian-transition-resumed', result: resumed.result });
    } finally {
      if (!completed) coordinator.kill('SIGKILL');
      await until(() => completed, 'Fixture coordinator did not exit after cleanup', 5000);
      await fs.writeFile(path.join(root, 'coordinator-result.json'), JSON.stringify(completed, null, 2) + '\n');
    }
  }
  const after = await probe();
  const finalStatus = await status();
  assert.equal(finalStatus.build.commit, initialBackend.build.commit, 'Qualification did not restore the actual baseline backend');
  assert.equal(finalStatus.execution.owner.pid, ownerPid); assert.equal(finalStatus.execution.owner.id, ownerId);
  const finalSupervision = JSON.parse(await fs.readFile(path.join(instance, 'runtime/supervision.json'), 'utf8'));
  assert.equal(finalSupervision.owner.artifact, artifact.runtimeHash, 'Qualification changed the owner artifact');
  assert.equal(finalSupervision.backend.artifact, initialGuardian.runtimeHash, 'Qualification did not restore the actual baseline guardian');
  console.log(JSON.stringify({ stage: 'availability-summary', samples, failures, eventLoopMaxMs: eventLoop.max / 1e6 }));
  assert.ok(after.value > before.value); assert.equal(failures, 0);
  if (linux && process.env.OMNITRON_RUNTIME_PROBE) {
    const { runtimeProbeCommand } = await import(pathToFileURL(process.env.OMNITRON_RUNTIME_PROBE).href);
    // Probe from the independent input bundle so the installed runtime must be
    // identified through its managed selection, not as a direct bundle fork.
    const bundle = { root: path.dirname(initialBackendDist), version: first.version, commit: initialBackend.build.commit };
    const options = { env: { ...process.env, OMNITRON_HOME: instance }, timeout: 60_000, maxBuffer: 1024 * 1024 };
    const detected = JSON.parse((await run('/bin/sh', ['-c', runtimeProbeCommand(bundle, (await status()).pid)], options)).stdout);
    assert.equal(detected.kind, 'managed'); assert.equal(detected.ownerPid, ownerPid);
    assert.equal(detected.applicationRuntime.commit, artifact.build.commit, 'Runtime probe confused the owner and backend builds');
    await assert.rejects(run('/bin/sh', ['-c', runtimeProbeCommand(bundle, applicationPid)], options), /no recognized entry/);
    console.log(JSON.stringify({ stage: 'remote-inspection-verified', ownerPid, backendPid: afterGuardian.pid }));
  }
  const verifiedLogs = await verifyFixtureLogs({ root, instance, runtime: initialBackend.runtimeRoot, fixtureId: id, until });
  assertHistoryPreserved('complete');
  console.log(JSON.stringify({ test: linux ? 'independent-systemd-supervision' : 'independent-launchd-supervision', root, ownerPid, applicationPid,
    backends: [first.pid, upgraded.pid, recovered.pid, afterGuardian.pid], killedGuardian: guardian.pid, samples, failures,
    verifiedLogs, preservedMigrationHistoryRows: originalHistory.length,
    initialRuntimes: { owner: artifact.build.commit, backend: initialBackend.build.commit, guardian: initialGuardian.build.commit },
    finalBackend: { pid: finalStatus.pid, commit: finalStatus.build.commit },
    finalGuardian: { pid: finalStatus.execution.supervision.guardianPid, artifact: finalSupervision.backend.artifact } }));
  }
  }
} finally {
  await cleanup();
  process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
}
// Retain failed fixtures for diagnosis. Successful runs release their private runtime copies.
if (process.env.OMNITRON_KEEP_TEST_ARTIFACTS !== '1') {
  await removeOwnedFixtureRoot(root, rootIdentity);
}
