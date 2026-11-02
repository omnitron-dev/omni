// Executed with the verified Node binary of the OS-managed guardian over the pinned SSH connection.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const [home, bootstrap, guardian, request] = process.argv.slice(1);
const wanted = JSON.parse(request);
const dir = path.join(home, 'runtime'),
  releases = path.join(dir, 'releases'),
  pkg = path.join(bootstrap, 'packages/0');
const sdk = (name) => import(pathToFileURL(path.join(pkg, 'dist', name + '.js')).href);
const { readManagedRuntime, managedJobPid, verifyManagedIsolation } = await sdk('daemon/managed-runtime');
const { checkBackendCandidate, backendMigrationDigest } = await sdk('daemon/backend-candidate');
const { createDaemonClient } = await sdk('daemon/daemon-client');
const { privateControlClient } = await sdk('daemon/private-control-client');
const config = await readManagedRuntime(home);
if (
  !config ||
  path.join(releases, config.backend.artifact) !== bootstrap ||
  (await managedJobPid(config, 'backend')) !== Number(guardian)
)
  throw Error('Managed supervisor identity changed');
const dbPath = path.join(dir, 'state.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const s = fs.lstatSync(dbPath + suffix, { throwIfNoEntry: false });
  if (s && (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077))
    throw Error('Unsafe runtime registry');
}
const Sqlite = createRequire(path.join(pkg, 'package.json'))('better-sqlite3');
const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true });
const kv = (key) => JSON.parse(db.prepare('SELECT value FROM state_kv WHERE key=?').get(key)?.value ?? 'null');
const hash = /^[0-9a-f]{64}$/;
const checked = new Map();
const checkout = async (id) => {
  if (!hash.test(id)) throw Error('Invalid installed runtime digest');
  const r = path.join(releases, id);
  if (fs.realpathSync(r) !== r) throw Error('Non-canonical installed runtime');
  if (!checked.has(id)) checked.set(id, checkBackendCandidate(path.join(r, 'packages/0/dist'), undefined, id));
  return checked.get(id);
};
const client = createDaemonClient();
try {
  const selection = kv('runtime.selection');
  if (
    !selection ||
    selection.protocol !== 1 ||
    !Number.isSafeInteger(selection.revision) ||
    selection.revision < 1 ||
    kv('runtime.activation') ||
    kv('runtime.lease')
  )
    throw Error('Runtime selection is absent or a native operation is unfinished');
  const status = await client.status(),
    live = status.execution;
  if (
    live?.mode !== 'resident' ||
    !live.owner?.id ||
    live.connection?.status !== 'connected' ||
    live.phase !== 'active'
  )
    throw Error('Resident owner observation is unavailable or control transfer has not settled');
  const current = await checkout(selection.current),
    owner = await checkout(config.owner.artifact);
  const ownerPid = await managedJobPid(config, 'owner'),
    guardianPid = Number(guardian);
  await verifyManagedIsolation(config, ownerPid, guardianPid, status.pid);
  const executable = (pid) => fs.realpathSync('/proc/' + pid + '/exe');
  const argv = (pid) => fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
  const includesEntry = (pid, entry) => argv(pid).some((a) => a === entry);
  const ownerEntry = path.join(owner.directory, 'daemon/managed-entry.js');
  if (
    live.owner.pid !== ownerPid ||
    executable(ownerPid) !== owner.execPath ||
    !includesEntry(ownerPid, ownerEntry) ||
    !argv(ownerPid).includes('owner') ||
    executable(status.pid) !== current.execPath ||
    !includesEntry(status.pid, current.entry) ||
    status.build?.dirty !== false ||
    status.build.commit !== current.build.commit
  )
    throw Error('RPC, native process and sealed runtime identities do not agree');
  const stat = fs.readFileSync('/proc/' + status.pid + '/stat', 'utf8');
  if (Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) !== guardianPid)
    throw Error('Serving backend is not a child of its native guardian');
  const manifest = JSON.parse(fs.readFileSync(path.join(current.runtimeRoot, 'RUNTIME.json'), 'utf8'));
  const nodeVersion = execFileSync(current.execPath, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (manifest.sha256 !== selection.current || manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.nodeVersion !== nodeVersion)
    throw Error('Serving runtime metadata differs from its native executable');
  const assertSelection = () => {
    const now = kv('runtime.selection');
    if (now?.current !== selection.current || now?.revision !== selection.revision || kv('runtime.activation') || kv('runtime.lease'))
      throw Error('Runtime selection changed during inspection');
  };
  const bundle = {
    root: path.dirname(current.directory),
    commit: current.build.commit,
    version: status.version,
    managed: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion,
      backendArtifact: current.runtimeHash,
      backendPid: status.pid,
      ownerArtifact: owner.runtimeHash,
      ownerId: live.owner.id,
      ownerPid,
    },
    applicationRuntime: { root: path.dirname(owner.directory), executable: owner.execPath, commit: owner.build.commit },
  };
  if (wanted.operation === 'inspect') {
    assertSelection();
    console.log(JSON.stringify({ bundle }));
  } else {
    if (Object.values(live.blockers ?? {}).some((n) => n !== 0) || !live.blockers)
      throw Error('Active operations block kernel qualification');
    const channel = await privateControlClient(path.join(config.directory, 'owner.sock'), 'OmnitronExecution');
    let snap;
    try {
      snap = await channel.service.snapshot();
    } finally {
      await channel.close();
    }
    if (
      snap.status.owner.id !== live.owner.id ||
      snap.status.owner.pid !== ownerPid ||
      snap.status.phase !== 'active' ||
      snap.status.controller.epoch !== live.epoch ||
      !hash.test(snap.inventoryDigest)
    )
      throw Error('Unsettled owner inventory');
    const health = await client.getHealth({});
    const unhealthy = status.apps
      .filter(
        (app) => app.status !== 'stopped' && (app.status !== 'online' || health.apps?.[app.name]?.status !== 'healthy')
      )
      .map((app) => app.name);
    const evidence = {
      bundle,
      current: selection.current,
      ownerId: live.owner.id,
      ownerPid,
      backendPid: status.pid,
      appsDigest: snap.inventoryDigest,
      selectionRevision: selection.revision,
      priorSelection: selection.previous,
      unhealthy,
    };
    {
      const supervisor = await privateControlClient(
        path.join(config.directory, 'supervisor.sock'),
        'OmnitronSupervisor',
        360000
      );
      try {
        const supervisorState = await supervisor.service.status();
        if (supervisorState.kernelHandoff !== 1)
          throw Error(
            'Native guardian lacks kernelHandoff@1. Qualify and apply a backend guardian transition before the fleet rollout'
          );
        if (
          supervisorState.operationPending !== false ||
          supervisorState.state !== 'ready' ||
          supervisorState.backendPid !== status.pid
        )
          throw Error('Native guardian has an unfinished kernel operation');
      } finally {
        await supervisor.close();
      }
    }
    if (wanted.operation === 'plan') {
      if (unhealthy.length) throw Error('Application readiness did not pass: ' + unhealthy.join(', '));
      if (!/^[0-9a-f]{40}$/.test(wanted.commit)) throw Error('An exact Git commit is required');
      const entries = fs.readdirSync(releases, { withFileTypes: true }).filter((e) => hash.test(e.name));
      if (entries.length > 256) throw Error('Installed runtime catalog exceeds 256 releases');
      const matches = entries.filter(
        (e) =>
          e.isDirectory() &&
          JSON.parse(fs.readFileSync(path.join(releases, e.name, 'packages/0/dist/BUILD.json'))).commit ===
            wanted.commit
      );
      if (matches.length !== 1)
        throw Error('Expected exactly one installed sealed runtime for ' + wanted.commit + '; found ' + matches.length);
      const candidate = matches[0].name === current.runtimeHash ? current : await checkout(matches[0].name);
      if (candidate.build.commit !== wanted.commit) throw Error('Candidate changed during qualification');
      if ((await backendMigrationDigest(current.directory)) !== (await backendMigrationDigest(candidate.directory)))
        throw Error('Kernel rollout requires identical migration sets; qualify schema changes separately');
      if (candidate.runtimeHash !== current.runtimeHash) {
        const out = execFileSync(
          candidate.execPath,
          [
            path.join(candidate.directory, 'cli/omnitron.js'),
            '--json',
            'backend',
            'upgrade',
            candidate.directory,
            '--check',
          ],
          { encoding: 'utf8', timeout: 150000, env: { ...process.env, OMNITRON_HOME: home } }
        );
        const result = JSON.parse(out);
        if (!result.ok || !result.data?.checked) throw Error('Native backend preflight did not confirm the candidate');
      }
      evidence.qualified = candidate.runtimeHash;
    }
    if (wanted.operation === 'switch') {
      const { expected, from, to, revision, pid } = wanted;
      if (from === expected.previous && unhealthy.length) throw Error('Application readiness changed before handoff');
      if (
        evidence.current !== from ||
        status.pid !== pid ||
        selection.revision !== revision ||
        live.owner.id !== expected.ownerId ||
        ownerPid !== expected.ownerPid ||
        snap.inventoryDigest !== expected.appsDigest
      )
        throw Error('Planned kernel or application identity changed before handoff');
      const destination = await checkout(to);
      if (to === expected.candidate && destination.build.commit !== expected.commit)
        throw Error('Planned source changed');
      if (kv('runtime.activation') || kv('runtime.lease') || kv('runtime.selection')?.revision !== revision)
        throw Error('Another native operation began');
      const supervisor = await privateControlClient(
        path.join(config.directory, 'supervisor.sock'),
        'OmnitronSupervisor',
        360000
      );
      try {
        await supervisor.service.upgradeIfCurrent({
          current: from,
          candidate: to,
          selectionRevision: revision,
          backendPid: pid,
          ownerId: expected.ownerId,
          ownerPid: expected.ownerPid,
          appsDigest: expected.appsDigest,
        });
      } finally {
        await supervisor.close();
      }
    }
    if (wanted.operation !== 'switch') assertSelection();
    console.log(JSON.stringify(evidence));
  }
} finally {
  await client.disconnect();
  db.close();
}
