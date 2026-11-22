import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = /^[a-f0-9]{64}$/;
class AllocationRefusal extends Error {}
class TemporaryReadFailure extends AllocationRefusal {}

// Only fixed operation names and known error codes may enter the Pipeline journal.
export async function readReceiver(operation, read) {
  try { return await read(); } catch (error) {
    if (error instanceof AllocationRefusal) throw error;
    const code = error?.code;
    if ([408, 'REQUEST_TIMEOUT', 'ETIMEDOUT'].includes(code))
      throw new TemporaryReadFailure(operation + ' timed out');
    if (code === 'ECONNRESET' || code === 'EPIPE')
      throw new TemporaryReadFailure(operation + ' lost its connection');
    throw new AllocationRefusal(operation + ' unavailable');
  }
}

export async function runReceiverPhase(phase, run) {
  try { return await run(); } catch (error) {
    if (phase !== 'inspect' || !(error instanceof TemporaryReadFailure)) throw error;
    // The pre-lease inspection has no side effects. Reacquire its socket and all observations once.
    return run();
  }
}
const configName = 'omnitron.config.mjs';
const markerName = '.omnitron-passive.json';
const missing = e => e.code === 'ENOENT';
const stat = file => fs.lstat(file, { bigint: true }).catch(e => { if (!missing(e)) throw e; return null; });
const identity = s => [s.dev, s.ino, s.ctimeNs, s.size, s.mode, s.uid].map(String);

function dataConfig(body) {
  const match = /(?:^|\n)export default (\{[\s\S]*\});\n?$/.exec(body);
  if (!match) throw new AllocationRefusal('Native renderer returned an unsupported configuration');
  return JSON.parse(match[1]);
}

export function passiveConfig(render, spec, release, installed) {
  const { project, stack: sourceStack } = spec.prepared;
  const artifacts = release.manifest.artifacts;
  const input = spec.apps.map(a => ({ name: a.name, enabled: false, ...(a.dependsOn?.length && { dependsOn: a.dependsOn }) }));
  const config = dataConfig(render({ project, sourceStack, apps: input, artifacts, artifactRoot: '/opt/omnitron/artifacts' }));
  if (config.apps.length !== spec.apps.length || installed.length !== spec.apps.length ||
      config.stacks?.deployed?.infrastructureOwnership !== 'controller' ||
      !isDeepStrictEqual(config.stacks.deployed.managedOrigin, { project, stack: sourceStack }))
    throw new AllocationRefusal('Incomplete native allocation');
  for (const [i, app] of config.apps.entries()) {
    const entry = installed[i], launch = artifacts.find(a => a.app === app.name)?.launch;
    if (entry?.name !== app.name || !launch || !path.isAbsolute(entry.releaseRoot ?? '') ||
        entry[launch.mode] !== path.join(entry.releaseRoot, launch.file) || app.enabled !== false)
      throw new AllocationRefusal('Native installation differs from the requested application set');
    app.cwd = app.releaseRoot = entry.releaseRoot;
    app[launch.mode] = entry[launch.mode];
  }
  config.stacks.deployed.release = { mode: 'required' };
  return config;
}

async function privateDir(dir) {
  const s = await fs.lstat(dir);
  if (!s.isDirectory() || s.uid !== process.getuid() || (s.mode & 0o077) || await fs.realpath(dir) !== dir)
    throw new AllocationRefusal('Expected a private physical receiver directory');
}

async function seal(file) {
  const s = await stat(file);
  if (!s?.isFile() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o777n) !== 0o600n || s.nlink !== 1n)
    throw new AllocationRefusal('Private publication identity changed');
  return identity(s);
}

async function syncDir(dir) {
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function ownPublication(directory, spec, allowPrevious = false) {
  if (!await stat(directory)) return null;
  await privateDir(directory);
  const marker = path.join(directory, markerName);
  if (!await stat(marker)) throw new AllocationRefusal('Existing allocation has no passive publication receipt');
  await seal(marker);
  const claim = JSON.parse(await fs.readFile(marker, 'utf8'));
  const files = (await fs.readdir(directory)).sort();
  if (claim.schema !== 1 || (claim.ticket !== spec.ticket && !(allowPrevious && claim.ticket === spec.replaces?.ticket)) || !hash.test(claim.configSha256) ||
      !isDeepStrictEqual(files, [markerName, configName, '.omnitron-config-sha256', '.registration-' + claim.ticket].sort()) ||
      !isDeepStrictEqual(await seal(path.join(directory, configName)), claim.file) ||
      !isDeepStrictEqual(await seal(path.join(directory, '.omnitron-config-sha256')), claim.checksumFile))
    throw new AllocationRefusal('The allocation changed after passive preparation');
  return claim;
}

async function matchesConfig(directory, claim, config) {
  const file = path.join(directory, configName);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!isDeepStrictEqual(identity(await handle.stat({ bigint: true })), claim.file)) throw new AllocationRefusal('Passive configuration was replaced');
    const contents = await handle.readFile('utf8');
    const actual = dataConfig(contents);
    if (sha(contents) !== claim.configSha256 || (config !== undefined && !isDeepStrictEqual(actual, config)) ||
        !isDeepStrictEqual(await seal(file), claim.file) ||
        await fs.readFile(path.join(directory, '.omnitron-config-sha256'), 'utf8') !== claim.configSha256)
      throw new AllocationRefusal('Passive publication differs from the verified release');
    return actual;
  } finally { await handle.close(); }
}

// A plain POSIX rename may overwrite somebody else's empty destination.
async function publishDirectory(source, destination, exchange = false) {
  await exec('/usr/bin/python3', ['-I', '-c', [
    'import ctypes,os,sys', 'lib=ctypes.CDLL(None,use_errno=True)',
    'if lib.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),int(sys.argv[3])):',
    ' n=ctypes.get_errno(); raise OSError(n,os.strerror(n))',
  ].join('\n'), source, destination, exchange ? '2' : '1']);
  await syncDir(path.dirname(destination));
  if (path.dirname(source) !== path.dirname(destination)) await syncDir(path.dirname(source));
}

async function runPublication(publication) {
  await new Promise((resolve, reject) => {
    const p = spawn('/bin/sh', ['-c', publication.command], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.on('error', reject);
    p.stdin.on('error', reject);
    p.on('exit', (code, signal) => code === 0 && !signal ? resolve() : reject(new AllocationRefusal('Native private publication failed')));
    p.stdin.end(publication.stdin);
  });
}

const historyName = '.passive-replacements';

export async function checkAllocationParents(artifacts, projects, allowedProject, replace = false) {
  for (const [directory, allowed] of [[artifacts, []], [projects, replace ? [allowedProject, historyName] : [allowedProject]]]) {
    if (!await stat(directory)) continue;
    const current = await fs.lstat(directory);
    if (!current.isDirectory() || current.uid !== process.getuid() || (current.mode & 0o022) ||
        await fs.realpath(directory) !== directory || (await fs.readdir(directory)).some(entry => !allowed.includes(entry)))
      throw new AllocationRefusal('Operational allocation directory is occupied or has unexpected ownership');
  }
  if (replace && await stat(path.join(projects, historyName))) await privateDir(path.join(projects, historyName));
}

async function emptyRecipient(ports, scope, directory, claimed) {
  await ports.checkParents(scope.project);
  const rows = await readReceiver('Project inventory', () => ports.projects.listProjects());
  if (!Array.isArray(rows)) throw new AllocationRefusal('Recipient project inventory unavailable');
  const own = rows.length === 1 && rows[0].name === scope.project && rows[0].path === directory &&
    rows[0].enabledStacks?.length === 0 && rows[0].runningStacks === 0;
  if (rows.length && (!own || !claimed)) throw new AllocationRefusal('Recipient project registry is occupied or enabled');
  const handles = await readReceiver('Process inventory', () => ports.processes());
  if (!Array.isArray(handles) || handles.length) throw new AllocationRefusal('Recipient execution owner already has application handles');
  const containers = await readReceiver('Container inventory', () => ports.containers());
  if (!Array.isArray(containers) || containers.length) throw new AllocationRefusal('Recipient owns physical stack containers');
  return own;
}

async function fullStopReview(ports, project) {
  const review = await ports.projects.reviewStackStop({ project, stack: 'deployed' });
  const target = review.targets?.[0];
  if (!hash.test(review.digest) || review.keepInfrastructure || review.targets?.length !== 1 || target.node !== 'local' ||
      !hash.test(target.definitionSha256) || target.runtime?.project !== project || target.runtime.stack !== 'deployed' ||
      !Number.isSafeInteger(target.runtime.revision) || !['running', 'stopped'].includes(target.runtime.phase) ||
      target.applications?.length !== 0 || target.containers?.length !== 0)
    throw new AllocationRefusal('Native full-stop review did not confirm the disabled allocation');
  return target;
}

async function previousPublication(directory, spec, ports) {
  const claim = await ownPublication(directory, { ticket: spec.replaces.ticket });
  if (claim?.configSha256 !== spec.replaces.configSha256) throw new AllocationRefusal('Previous disabled publication differs from the reviewed receipt');
  const config = await matchesConfig(directory, claim);
  const snapshot = path.join(directory, '.registration-' + spec.replaces.ticket);
  await privateDir(snapshot);
  if (!isDeepStrictEqual((await fs.readdir(snapshot)).sort(), ['candidate.mjs', 'present.json']))
    throw new AllocationRefusal('Previous registration snapshot contains unreviewed files');
  for (const name of ['candidate.mjs', 'present.json']) await seal(path.join(snapshot, name));
  if (await fs.readFile(path.join(snapshot, 'present.json'), 'utf8') !== '[]' ||
      !isDeepStrictEqual(config, dataConfig(await fs.readFile(path.join(snapshot, 'candidate.mjs'), 'utf8'))))
    throw new AllocationRefusal('Previous registration snapshot differs from the reviewed configuration');
  const stack = config.stacks?.deployed;
  if (!Array.isArray(config.apps) || !config.apps.length || !config.apps.every(a => a.enabled === false) ||
      stack?.infrastructureOwnership !== 'controller' || stack.release?.mode !== 'required' ||
      !isDeepStrictEqual(stack.managedOrigin, { project: spec.prepared.project, stack: spec.prepared.stack }))
    throw new AllocationRefusal('Previous publication is outside this disabled managed stack');
  if (ports) {
    const release = await ports.loadRelease(spec.replaces.release);
    if (release.manifestSha256 !== spec.replaces.manifestSha256 ||
        !isDeepStrictEqual(config.apps.map(a => a.name).sort(), release.files.map(a => a.app).sort()))
      throw new AllocationRefusal('Previous release differs from the disabled publication');
    for (const app of config.apps) {
      const receipt = await ports.readReceipt(app.releaseRoot);
      const origin = receipt.origin.runtimeOrigin?.consumer ?? receipt.origin;
      if (receipt.version !== 2 || receipt.root !== app.releaseRoot || app.cwd !== app.releaseRoot || origin.app !== app.name ||
          origin.releaseId !== spec.replaces.release || origin.manifestSha256 !== spec.replaces.manifestSha256)
        throw new AllocationRefusal('Previous installed release origin differs');
    }
  }
  return config;
}

function managedDefinition(ports, project, config) {
  return ports.fingerprint([project, 'deployed', config.stacks.deployed, config.apps]);
}

function transitionDirectory(directory, spec) { return path.join(path.dirname(directory), historyName, spec.ticket); }

async function inspectReplacement(spec, directory, ports, claim, verifyRelease = true) {
  const { project, stack } = spec.prepared;
  if (!claim || !await emptyRecipient(ports, { project, stack }, directory, claim))
    throw new AllocationRefusal('The previous disabled allocation must remain registered at its canonical path');
  const owner = await ports.owner();
  if (owner.execution?.ownerId !== spec.replaces.owner) throw new AllocationRefusal('The reviewed replacement owner changed');
  const previousIsLive = claim.ticket === spec.replaces.ticket;
  const transaction = transitionDirectory(directory, spec);
  if (!previousIsLive) {
    await privateDir(path.dirname(transaction));
    await privateDir(transaction);
  }
  const previous = previousIsLive ? directory : path.join(transaction, 'exchange');
  const previousConfig = await previousPublication(previous, spec, verifyRelease ? ports : undefined);
  if (managedDefinition(ports, project, previousConfig) !== spec.replaces.definitionSha256)
    throw new AllocationRefusal('Previous managed definition differs from the reviewed receipt');
  const checked = await fullStopReview(ports, project);
  if (checked.definitionSha256 !== spec.replaces.definitionSha256 &&
      (previousIsLive || checked.definitionSha256 !== managedDefinition(ports, project, await matchesConfig(directory, claim))))
    throw new AllocationRefusal('The daemon definition differs from both reviewed publications');
  return owner;
}

async function writePublication(parent, destination, spec, config, release, ports) {
  const project = spec.prepared.project;
  const stage = await fs.mkdtemp(path.join(parent, '.passive-' + project + '-'));
  const created = await stat(stage);
  try {
    await privateDir(stage);
    await runPublication(ports.publication({ directory: stage, project, body: 'export default ' + JSON.stringify(config) + ';\n',
      operation: spec.ticket, artifacts: release.files.map(a => ({ app: a.app, version: a.version })) }));
    const file = path.join(stage, configName);
    const claim = { schema: 1, ticket: spec.ticket, configSha256: sha(await fs.readFile(file)), file: await seal(file),
      checksumFile: await seal(path.join(stage, '.omnitron-config-sha256')) };
    await matchesConfig(stage, claim, config);
    const marker = await fs.open(path.join(stage, markerName), 'wx', 0o600);
    try { await marker.writeFile(JSON.stringify(claim)); await marker.sync(); } finally { await marker.close(); }
    await syncDir(stage);
    await publishDirectory(stage, destination);
    return claim;
  } finally {
    const remaining = await stat(stage);
    if (remaining?.dev === created.dev && remaining.ino === created.ino) await fs.rm(stage, { recursive: true });
  }
}

async function openTransition(directory, spec) {
  const transaction = transitionDirectory(directory, spec);
  for (const dir of [path.dirname(transaction), transaction]) {
    try { await fs.mkdir(dir, { mode: 0o700 }); await syncDir(path.dirname(dir)); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    await privateDir(dir);
  }
  return transaction;
}

/** Requires the ordinary node deploy lease and its execution guard over the entire operation. */
export async function stagePassiveAllocation(spec, directory, ports) {
  const { project, stack, release: id, manifestSha256, commit } = spec.prepared;
  const scope = { project, stack };
  const existing = await ownPublication(directory, spec, Boolean(spec.replaces));
  await emptyRecipient(ports, scope, directory, existing);
  const parent = path.dirname(directory);
  const parentStat = await fs.lstat(parent);
  if (await fs.realpath(parent) !== parent || !parentStat.isDirectory() || (parentStat.mode & 0o002) ||
      ![0, process.getuid()].includes(parentStat.uid)) throw new AllocationRefusal('Expected a trusted physical node projects directory');
  if (!existing) await fs.access(parent, constants.W_OK | constants.X_OK);
  const before = spec.replaces ? await inspectReplacement(spec, directory, ports, existing) : await ports.owner();
  if (!before.target || !hash.test(before.target.executableSha256)) throw new AllocationRefusal('Missing authenticated owner target');
  const release = await ports.loadRelease(id);
  if (release.manifestSha256 !== manifestSha256 || release.manifest.project.commit !== commit ||
      !isDeepStrictEqual(release.files.map(a => a.app).sort(), spec.apps.map(a => a.name).sort()))
    throw new AllocationRefusal('Receiver release differs from the complete prepared declaration');
  const entries = spec.apps.map(a => {
    const artifact = release.manifest.artifacts.find(item => item.app === a.name);
    if (!artifact?.launch || !isDeepStrictEqual(artifact.origin, a.releaseFrom)) throw new AllocationRefusal('Missing exact frozen launch origin');
    return { name: a.name, ...(a.releaseFrom ? { releaseFrom: a.releaseFrom } : { [a.mode]: artifact.launch.file }),
      ...(a.nodeOptions && { env: { NODE_OPTIONS: a.nodeOptions } }) };
  });
  const previousIsLive = existing && spec.replaces && existing.ticket === spec.replaces.ticket;
  const installed = await ports.install(release, stack, entries, { prepare: !existing || Boolean(previousIsLive), ownerPid: before.execution.pid,
    ownerPackage: before.root, runtime: before.target });
  const trees = [];
  for (const entry of installed) {
    const r = await ports.readReceipt(entry.releaseRoot);
    if (r.version !== 2 || !hash.test(r.treeSha256) || r.root !== entry.releaseRoot || r.ownerPackage !== before.root)
      throw new AllocationRefusal('Missing verified installed application receipt');
    trees.push({ name: entry.name, root: r.root, artifactSha256: r.origin.artifactSha256, treeSha256: r.treeSha256 });
  }
  const config = passiveConfig(ports.render, spec, release, installed);
  await ports.sameOwner(before, await ports.owner());
  const transaction = spec.replaces && await openTransition(directory, spec);
  let claim = existing;
  if (!claim) {
    await emptyRecipient(ports, scope, directory, false);
    claim = await writePublication(parent, directory, spec, config, release, ports);
  } else if (previousIsLive) {
    const exchange = path.join(transaction, 'exchange');
    if (await stat(path.join(transaction, 'accepted.json'))) throw new AllocationRefusal('A completed replacement conflicts with the live receipt');
    const next = await ownPublication(exchange, spec) ?? await writePublication(transaction, exchange, spec, config, release, ports);
    await matchesConfig(exchange, next, config);
    await ports.sameOwner(before, await inspectReplacement(spec, directory, ports, existing, false));
    await publishDirectory(exchange, directory, true);
    await previousPublication(exchange, spec);
    claim = await ownPublication(directory, spec);
  }
  await matchesConfig(directory, await ownPublication(directory, spec), config);
  const registered = await emptyRecipient(ports, scope, directory, claim);
  if (spec.replaces && !registered) throw new AllocationRefusal('The previous registration disappeared during replacement');
  await ports.sameOwner(before, await ports.owner());
  const confirmation = transaction && path.join(transaction, 'accepted.json');
  let accepted;
  if (confirmation && await stat(confirmation)) {
    await seal(confirmation);
    accepted = JSON.parse(await fs.readFile(confirmation, 'utf8'));
    if (accepted.ticket !== spec.ticket || accepted.previous !== spec.replaces.ticket || accepted.config !== claim.configSha256 ||
        accepted.owner !== before.execution.ownerId || !hash.test(accepted.definition)) throw new AllocationRefusal('Replacement confirmation differs');
  }
  if (!registered || (spec.replaces && !accepted)) {
    const response = await ports.projects.addProject({ name: project, path: directory });
    if (response.name !== project || response.path !== directory || (spec.replaces && response.reread?.redefined !== 0))
      throw new AllocationRefusal('Registration acknowledgement differs');
  }
  if (!await emptyRecipient(ports, scope, directory, claim)) throw new AllocationRefusal('Receiver did not retain the allocation');
  const target = await fullStopReview(ports, project);
  await ports.sameOwner(before, await ports.owner());
  const published = await matchesConfig(directory, await ownPublication(directory, spec), config);
  if (confirmation) {
    await previousPublication(path.join(transaction, 'exchange'), spec);
    // A managed full-stop review binds the normalized local stack and every installed launch path.
    if (target.definitionSha256 !== managedDefinition(ports, project, published) || target.definitionSha256 === spec.replaces.definitionSha256 ||
        (accepted && accepted.definition !== target.definitionSha256)) throw new AllocationRefusal('The daemon did not confirm the replacement definition');
    if (!accepted) {
      const file = path.join(await fs.mkdtemp(path.join(transaction, '.ack-')), 'receipt');
      const handle = await fs.open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ ticket: spec.ticket, previous: spec.replaces.ticket, owner: before.execution.ownerId,
        config: claim.configSha256, definition: target.definitionSha256 })); await handle.sync(); } finally { await handle.close(); }
      await publishDirectory(file, confirmation); await fs.rmdir(path.dirname(file));
    }
  }
  return { protocol: 1, ticket: spec.ticket, project, sourceStack: stack, release: id, manifestSha256,
    nodeId: spec.prepared.nodeId, owner: before.execution.ownerId, directory, configSha256: claim.configSha256,
    definitionSha256: target.definitionSha256, phase: target.runtime.phase, revision: target.runtime.revision,
    enabledApps: 0, physicalContainers: 0, handles: 0, ...(spec.replaces && { replaced: spec.replaces.ticket }), trees };
}

async function main() {
  const [phase, encoded] = process.argv.slice(2);
  const spec = JSON.parse(Buffer.from(encoded, 'base64url'));
  if (process.platform !== 'linux' || process.getuid() === 0 || process.getuid() !== spec.uid || !hash.test(spec.backend) ||
      !hash.test(spec.ownerArtifact) || !hash.test(spec.ticket)) throw new AllocationRefusal('Wrong receiver account or installation identity');
  const home = path.join(os.homedir(), '.omnitron');
  const root = path.join(home, 'runtime/releases', spec.backend, 'packages/0');
  const sdk = name => import(pathToFileURL(path.join(root, 'dist', name + '.js')).href);
  const node = path.resolve(root, '../../node');
  if (await fs.realpath(root) !== root || await fs.realpath(process.execPath) !== node ||
      await fs.realpath(home) !== home || process.env.OMNITRON_HOME !== home)
    throw new AllocationRefusal('Expected the reviewed physical backend runtime');
  if (!['inspect', 'stage'].includes(phase)) throw new AllocationRefusal('Unsupported phase');
  const { createDaemonClient } = await sdk('daemon/daemon-client');
  const { assertPrivateControlSocket } = await sdk('daemon/private-control-client');
  const { managedHostCommand } = await sdk('services/managed-rollout');
  const { assertSameApplicationRuntime, assertResidentApplicationRuntime } = await sdk('services/host-upgrade');
  const socket = path.join(home, 'daemon.sock');
  await assertPrivateControlSocket(socket);
  const client = createDaemonClient(socket);
  try {
    const projects = await readReceiver('Project service connection', () => client.service('OmnitronProject'));
    const owner = async () => {
      const { stdout } = await readReceiver('Execution owner inspection', () =>
        exec('/bin/sh', ['-c', managedHostCommand({ operation: 'inspect' })], { maxBuffer: 1048576 }));
      const { bundle } = JSON.parse(stdout);
      if (bundle?.root !== root || bundle.managed?.backendArtifact !== spec.backend || bundle.managed?.ownerArtifact !== spec.ownerArtifact)
        throw new AllocationRefusal('Serving backend or execution owner changed');
      assertResidentApplicationRuntime(bundle.applicationRuntime);
      return bundle.applicationRuntime;
    };
    const { listManagedContainers: containers } = await sdk('infrastructure/container-runtime');
    const directory = '/opt/omnitron/projects/' + spec.prepared.project;
    const ports = {
      projects, processes: () => client.list(), owner, sameOwner: assertSameApplicationRuntime,
      checkParents: project => checkAllocationParents('/opt/omnitron/artifacts', '/opt/omnitron/projects', project, Boolean(spec.replaces)),
      containers: () => containers({ orThrow: true }),
      loadRelease: (await sdk('release/load')).loadRelease, install: (await sdk('release/local-installation')).inspectLocalReleaseInstallation,
      readReceipt: (await sdk('release/installed-origin')).readInstalledReleaseReceipt,
      render: (await sdk('project/node-app-config')).renderNodeAppConfig,
      publication: (await sdk('services/node-registration')).prepareNodeConfigPublication,
      ...(spec.replaces && { fingerprint: (await sdk('project/node-stack-stop')).stackDefinitionFingerprint }),
    };
    if (phase === 'inspect') {
      const { project, stack, release, manifestSha256 } = spec.prepared;
      const current = await ownPublication(directory, spec, Boolean(spec.replaces));
      if (spec.replaces) await inspectReplacement(spec, directory, ports, current);
      else { await emptyRecipient(ports, { project, stack }, directory, current); await owner(); }
      const file = path.join(home, 'releases', release, 'manifest.json');
      const s = await stat(file);
      if (!s?.isFile() || s.size > 8n * 1024n * 1024n || await fs.realpath(file) !== file || sha(await fs.readFile(file)) !== manifestSha256)
        throw new AllocationRefusal('Canonical receiver manifest differs from the reviewed release');
      return;
    }
    const receipt = await stagePassiveAllocation(spec, directory, ports);
    // A separate line per field keeps all application digests readable in the bounded journal.
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  } finally { await client.disconnect(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runReceiverPhase(process.argv[2], main).catch(e => {
    // Child command diagnostics can contain wrapper arguments. Only return our own fixed failure messages.
    const message = e instanceof AllocationRefusal ? e.message : 'Native receiver verification failed';
    process.stderr.write(message + '\n'); process.exitCode = 1;
  });
}
