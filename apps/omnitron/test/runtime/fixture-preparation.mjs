// This fixture is also executed from unbuilt release checkouts. Keep its admission
// native-only; RuntimeInstallation is supplied by the explicitly reviewed runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const RECEIPT = 'preparation.json';
const CONSUMED = 'execute.started';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureFiles = ['managed-backend.mjs', 'fixture-preparation.mjs', 'fixture-ports.mjs',
  'managed-project-runtime.mjs', 'fixture-master-options.mjs', 'fixture-log-evidence.mjs',
  'fixture-unit-files.mjs', 'managed-owner-roundtrip.mjs', 'managed-local-sync-roundtrip.mjs', 'managed-reviewed-recovery.mjs'];
const identity = stat => ({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o7777 });
const host = () => ({ platform: process.platform, arch: process.arch, node: process.version });

async function absent(file, message) {
  await assert.rejects(fs.lstat(file), error => error.code === 'ENOENT', message);
}

async function privateDirectory(directory) {
  assert.equal(await fs.realpath(directory), directory, 'Fixture directory must not traverse symlinks');
  const stat = await fs.lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
    (stat.mode & 0o777) === 0o700, 'Fixture directory must be physical, owned and private 0700');
  return identity(stat);
}

async function writeExclusive(file, value) {
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  const directory = await fs.open(path.dirname(file), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

async function readReceipt(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.nlink === 1 && before.uid === process.getuid() &&
      (before.mode & 0o777) === 0o600 && before.size <= 32 * 1024, 'Preparation receipt must be bounded, private and physical');
    const bytes = await handle.readFile(), after = await handle.stat(), atPath = await fs.lstat(file);
    assert.ok(['dev', 'ino', 'uid', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]) &&
      !atPath.isSymbolicLink() && atPath.dev === after.dev && atPath.ino === after.ino, 'Preparation receipt changed while reading');
    return { value: JSON.parse(bytes), sha256: hash(bytes) };
  } finally { await handle.close(); }
}

export function preparationOption(argv, env = process.env) {
  const prepare = argv.indexOf('--prepare-only'), execute = argv.indexOf('--prepared');
  if (prepare === -1 && execute === -1) return undefined;
  assert.ok((prepare === -1) !== (execute === -1), 'Choose preparation or execution, not both');
  assert.equal(argv.indexOf('--reviewed-recovery'), argv.lastIndexOf('--reviewed-recovery'), 'Reviewed recovery may be selected only once');
  if (argv.includes('--writer-exit')) {
    assert.ok(argv.includes('--reviewed-recovery') && argv.indexOf('--writer-exit') === argv.lastIndexOf('--writer-exit'),
      'A writer exit requires one reviewed recovery scenario');
  }
  const option = prepare !== -1 ? '--prepare-only' : '--prepared';
  const index = prepare !== -1 ? prepare : execute;
  assert.equal(index, argv.lastIndexOf(option), 'Preparation option must appear exactly once');
  assert.ok(!['--master-scenario', '--fixture-root', '--master-config', '--application-project', '--application-sdk-commit',
    '--application-sdk', '--owner-roundtrip', '--local-sync-roundtrip', '--backend-only'].some(flag => argv.includes(flag)),
  'Prepared execution supports the ordinary exact-role scenario only');
  for (const variable of ['OMNITRON_HOME', 'OMNITRON_SOCKET', 'OMNITRON_DATABASE_URL']) {
    assert.equal(env[variable], undefined, `${variable} must not override the private prepared fixture`);
  }
  assert.ok(argv[0] && !argv[0].startsWith('--') && argv[1] && !argv[1].startsWith('--'),
    'Prepared fixture requires owner and management runtimes');
  for (let cursor = 2; cursor < argv.length; cursor++) {
    const flag = argv[cursor];
    assert.ok(['--prepare-only', '--prepared', '--initial-backend', '--initial-guardian', '--reviewed-recovery', '--writer-exit'].includes(flag), 'Unsupported preparation option');
    if (flag === '--prepare-only' || flag === '--reviewed-recovery' || flag === '--writer-exit') continue;
    assert.ok(argv[++cursor] && !argv[cursor].startsWith('--'), `${flag} requires a value`);
  }
  if (prepare !== -1) return { mode: 'prepare' };
  const receipt = argv[execute + 1];
  assert.ok(path.isAbsolute(receipt) && path.resolve(receipt) === receipt && path.basename(receipt) === RECEIPT &&
    !/[\x00-\x1f\x7f]/.test(receipt), 'Expected the canonical preparation.json path');
  return { mode: 'execute', receipt };
}

export async function fixtureIdentity(directory) {
  const files = {};
  for (const name of fixtureFiles) files[name] = hash(await fs.readFile(path.join(directory, name)));
  return { files, sha256: hash(JSON.stringify(files)) };
}

async function sourceInputs(inputs) {
  const sources = {};
  for (const [role, directory] of Object.entries(inputs)) {
    if (!directory) { sources[role] = null; continue; }
    assert.ok(path.isAbsolute(directory) && path.resolve(directory) === directory && directory.includes('omnitron-handoff-'),
      'Use a disposable sealed runtime input');
    assert.equal(await fs.realpath(directory), directory, 'Runtime input must not traverse symlinks');
    sources[role] = directory;
  }
  return sources;
}

/** The only installation path, shared by one-shot and split fixture runs. */
export async function prepareFixture({ root, id, inputs, RuntimeInstallation, fixtureDirectory, scenario = 'ordinary', mark = () => {} }) {
  const startedAt = new Date().toISOString(), start = performance.now();
  const rootIdentity = await privateDirectory(root), sources = await sourceInputs(inputs);
  const artifacts = {}, roles = [], installed = new Map();
  const installation = await RuntimeInstallation.open(path.join(root, 'i'));
  assert.ok(installation, 'Private runtime installation is unavailable');
  let selection;
  try {
    await installation.exclusive(async () => {
      assert.equal(installation.selection(), null, 'Preparation requires a fresh installation');
      assert.equal(installation.activation(), null, 'Preparation cannot resume an activation');
      for (const [role, source] of Object.entries(sources)) {
        if (!source) continue;
        const began = performance.now();
        mark({ stage: 'runtime-install-start', role });
        const reused = installed.has(source);
        const artifact = reused ? installed.get(source) : await installation.install(source);
        installed.set(source, artifact); artifacts[role] = artifact;
        const timing = { role, sha256: artifact.runtimeHash, reused, elapsedMs: Math.round(performance.now() - began) };
        roles.push(timing); mark({ stage: 'runtime-install-complete', ...timing });
      }
      await installation.select(artifacts.backend.runtimeHash, 0);
      await installation.writeLauncher();
      selection = installation.selection();
    });
  } finally { await installation.close(); }
  const receipt = { protocol: 1, kind: 'omnitron-native-preparation', scenario, id,
    root: { path: root, ...rootIdentity }, host: host(), fixture: await fixtureIdentity(fixtureDirectory),
    inputs: Object.fromEntries(Object.entries(sources).map(([role, source]) => [role, source ? {
      source, sha256: artifacts[role].runtimeHash, build: artifacts[role].build,
    } : null])), selection, startedAt, preparedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), roles };
  const file = path.join(root, RECEIPT);
  await writeExclusive(file, receipt);
  return { root, receipt, file, artifacts, rootIdentity };
}

async function freshInventory(root, roles) {
  assert.deepEqual((await fs.readdir(root)).sort(), ['e', 'i', RECEIPT].sort(), 'Prepared root has execution or unexpected state');
  for (const directory of ['i', 'e', 'i/runtime', 'i/runtime/releases', 'i/runtime/bin']) await privateDirectory(path.join(root, directory));
  assert.deepEqual(await fs.readdir(path.join(root, 'e')), [], 'Prepared execution directory must be empty');
  assert.deepEqual(await fs.readdir(path.join(root, 'i')), ['runtime'], 'Prepared instance has PID, socket, config or data state');
  const allowed = ['bin', 'releases', 'state.db', 'state.db-shm', 'state.db-wal'];
  const runtime = await fs.readdir(path.join(root, 'i/runtime'));
  assert.ok(runtime.includes('state.db') && runtime.every(name => allowed.includes(name)), 'Prepared installation has unfinished or unexpected state');
  assert.deepEqual(await fs.readdir(path.join(root, 'i/runtime/bin')), ['omnitron'], 'Prepared launcher inventory changed');
  assert.deepEqual((await fs.readdir(path.join(root, 'i/runtime/releases'))).sort(),
    [...new Set(Object.values(roles).filter(Boolean).map(role => role.sha256))].sort(), 'Prepared release inventory changed');
}

export async function consumeFixture(prepared) {
  await writeExclusive(path.join(prepared.root, CONSUMED), { protocol: 1, id: prepared.receipt.id,
    pid: process.pid, startedAt: new Date().toISOString() });
}

/** Claim before importing runtime code or any other execution write. Never undo it. */
export async function claimPreparedFixture({ file, inputs, fixtureDirectory, scenario = 'ordinary' }) {
  assert.equal(path.basename(file), RECEIPT, 'Expected preparation.json');
  const root = path.dirname(file);
  await privateDirectory(root);
  await absent(path.join(root, CONSUMED), 'Prepared fixture was already claimed; it cannot be reset or replayed');
  const { value: receipt } = await readReceipt(file);
  assert.ok(receipt?.protocol === 1 && receipt.kind === 'omnitron-native-preparation' && receipt.scenario === scenario &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.id), 'Invalid preparation receipt');
  const rootIdentity = await privateDirectory(root);
  assert.deepEqual(receipt.root, { path: root, ...rootIdentity }, 'Prepared root identity changed');
  assert.deepEqual(receipt.host, host(), 'Prepared runtime host or Node changed');
  assert.deepEqual(receipt.fixture, await fixtureIdentity(fixtureDirectory), 'Fixture implementation changed after preparation');
  const sources = await sourceInputs(inputs);
  assert.deepEqual(Object.keys(receipt.inputs).sort(), Object.keys(sources).sort(), 'Prepared runtime roles changed');
  for (const [role, source] of Object.entries(sources)) {
    const input = receipt.inputs[role];
    if (!source) { assert.equal(input, null, 'Prepared runtime role changed'); continue; }
    assert.ok(input?.source === source && /^[a-f0-9]{64}$/.test(input.sha256), 'Prepared runtime input changed');
  }
  await freshInventory(root, receipt.inputs);
  const prepared = { root, file, receipt, rootIdentity };
  await consumeFixture(prepared);
  return prepared;
}

/** Read exact UUID unit identities only; this guard never stops a process/unit. */
export async function assertPreparedFixtureIdle(prepared, execute) {
  const { root, receipt } = prepared;
  for (const role of ['owner', 'backend']) {
    if (process.platform === 'linux') {
      const unit = `omnitron-fixture-${receipt.id}-${role}.service`;
      for (const directory of ['/etc/systemd/system', '/run/systemd/system']) {
        await absent(path.join(directory, unit), 'Prepared native unit file already exists');
      }
      let result;
      try { result = await execute('systemctl', ['show', unit, '--property=LoadState', '--value'], { timeout: 5000, maxBuffer: 16 * 1024 }); }
      catch (error) { if (error.code !== 4) throw error; result = error; }
      assert.equal(result.stdout.trim(), 'not-found', 'Prepared native unit already exists or its state is unknown');
    } else {
      const label = `dev.omnitron.fixture.${receipt.id}.${role}`;
      await assert.rejects(execute('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { timeout: 5000, maxBuffer: 16 * 1024 }),
        error => error.code === 113 && error.stderr.includes(`Could not find service "${label}"`),
        'Prepared native unit already exists or its state is unknown');
    }
  }
  const processes = await execute('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
  // A launcher may mention preparation.json. Match only execution-owned paths,
  // not the parent shell's review command or unrelated processes with similar names.
  const prefixes = [path.join(root, 'i') + '/', path.join(root, 'e') + '/', path.join(root, 'counter.mjs')];
  assert.ok(!processes.stdout.split('\n').some(line => prefixes.some(prefix => line.includes(prefix))),
    'A process still references this prepared fixture execution boundary');
}

/** A receipt never replaces ordinary full digest and executable preflight. */
export async function verifyPreparedFixture(prepared, RuntimeInstallation, mark = () => {}) {
  const installation = await RuntimeInstallation.openReadOnly(path.join(prepared.root, 'i'));
  assert.ok(installation, 'Prepared installation is absent');
  const artifacts = {}, verified = new Map();
  try {
    assert.deepEqual(installation.settledSelection(), prepared.receipt.selection, 'Prepared selection changed or is unsettled');
    for (const [role, input] of Object.entries(prepared.receipt.inputs)) {
      if (!input) continue;
      const began = performance.now();
      const artifact = verified.get(input.sha256) ?? await installation.artifact(input.sha256);
      verified.set(input.sha256, artifact); artifacts[role] = artifact;
      assert.deepEqual(artifact.build, input.build, 'Prepared build changed');
      mark({ stage: 'prepared-runtime-verified', role, sha256: artifact.runtimeHash, elapsedMs: Math.round(performance.now() - began) });
    }
    return artifacts;
  } finally { await installation.close(); }
}
