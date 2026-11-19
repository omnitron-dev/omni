#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { FileWatcher } from '@xec-sh/loader/watch';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { getWantedPackageManager } from '@pnpm/config.reader';
import { frameworkPackage } from './pnpmfile-sdk.js';
import { sdkTransitionStatus, sdkTransitionSettled, sdkAdoptionTransition, supersedeSdkTransition,
  prepareSdkTransition, readPreparedSdkTransition, beginSdkTransition, finishSdkTransition, recoverSdkTransition,
  saveSdkBuildCheckpoint } from './sdk-transition.js';
import { sdkStatePath as statePath, prepareSdkState as prepareState, exclusively,
  assertSdkAvailable as assertSourceAvailable, clearSdkSelection as clearSourceSelection,
  sdkWorkspaceIdentity, sdkReuseWorkspaceIdentity, withMigrationSdkLocks } from './sdk-operation.js';
export { releaseTerminalMigrationSdk } from './sdk-operation.js';

const help = `omnitron sdk init [--project-dir PATH]
omnitron sdk prepare [SDK_CHECKOUT] [--project-dir PATH] [--check]
omnitron sdk dev [SDK_CHECKOUT] [--project-dir PATH] [--prepared TOKEN | --reuse-only DIGEST] [--stack NAME [--start-stopped --review DIGEST]] [--no-watch]
omnitron sdk registry [--project-dir PATH]
omnitron sdk recover [--project-dir PATH] [--stack NAME]
omnitron sdk adopt --stack NAME [--project-dir PATH] (--check | --review DIGEST)
omnitron sdk reconcile --stack NAME [--project-dir PATH] [--check]
omnitron sdk status [--project-dir PATH] [--stack NAME]

init installs the pnpm bridge without resolving registry dependencies.
dev selects the local SDK and watches its sources. Start again without a path to
reuse the selection. --no-watch verifies the selected graph and builds it once if stale.
--stack confirms owner refreshes for watched applications in that local source stack.
--start-stopped binds the owner's first online generations to the SDK during a reviewed
working-tree start. Obtain the digest with stack start PROJECT STACK --dry-run --infrastructure preserve.
Applications declaring watch: false are reported separately. Missing required watchers fail.
status verifies the installed SDK build; --stack also verifies application receipts.
prepare --check reports whether a one-shot dev selection would reuse, rebuild or rebind the requested SDK.
Pass its reuseDigest with --reuse-only and --no-watch to require that exact verified installation.
Inspection never builds, installs dependencies or restarts applications.
Selection retains a verified before-image in the development cache before building or installing.
prepare retains it while consumers are serving. Pass its complete token to dev to consume it once.
OMNITRON_DEV_CACHE overrides the shared XDG_CACHE_HOME/~/.cache/omnitron/development default.
recover restores the last retained selection's bytes without rebuilding or installing.
adopt reviews the verified current files of a recoverable selection without restoring its
old dependencies. Application consumers must be stopped before --review; the original
uncertain attempt and its rollback evidence remain in history, never marked successful.
reconcile confirms a durably acknowledged start without starting or restoring anything.
--check only observes its evidence, including legacy attempts with an unknown outcome.
Affected source consumers must be stopped; uncertain interrupted writes are never overwritten.
Protected selections require project-owned module directories and virtual stores.
External stores remain inspectable, but cannot be changed without an ownership contract.
registry restores the frozen distribution dependencies. Releases always read Git.`;

const scope = '@omnitron-dev/';
// Released hook templates eligible for the explicit, idempotent init upgrade.
const previousBridgeHashes = new Set([
  '28220745dd5d0643c4ac64ef75e7c466a9863741bd23473bbbfccee5c5f7858b',
  '5d68d3ac4deb8f9d525b1db2e020dc1610d2ea49f3892232d982db20341c1735',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
};
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
async function optionalJson(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function distributionLock(root) {
  try { return await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const lockIdentity = (distribution) => distribution === null ? null : sha256(distribution);
async function assertDistribution(root, identity) {
  if (lockIdentity(await distributionLock(root)) !== identity)
    throw Error('Distribution lock changed while preparing the development profile');
}
function lockDocuments(distribution) {
  if (distribution === null) return [];
  const documents = parseAllDocuments(distribution);
  for (const document of documents)
    if (document.errors.length) throw Error('Invalid pnpm-lock.yaml: ' + document.errors[0].message);
  return documents;
}
const applicationDocument = (distribution) => lockDocuments(distribution).at(-1)?.toJS() ?? null;

async function restoreDistribution(root, original, owned) {
  if (original === owned) return;
  if (await distributionLock(root) !== owned)
    throw Error('Distribution lock changed outside this SDK operation; its newer contents were preserved');
  const file = path.join(root, 'pnpm-lock.yaml');
  if (original === null) await fs.rm(file);
  else await atomic(file, original);
}

async function bootstrapPackageManager(root, original) {
  const application = applicationDocument(original);
  await assertDistribution(root, lockIdentity(original));
  let failure;
  try { await command('pnpm', ['--version'], root, true); }
  catch (error) { failure = error; }
  const generated = await distributionLock(root);
  if (!isDeepStrictEqual(applicationDocument(generated), application))
    throw Error('Application distribution graph changed during package-manager bootstrap; its newer contents were preserved');
  if (failure) {
    await restoreDistribution(root, original, generated);
    throw failure;
  }
  return generated;
}
async function atomic(file, value, durable = false) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    const fd = await fs.open(tmp, 'wx', 0o600);
    try { await fd.writeFile(value); if (durable) await fd.sync(); }
    finally { await fd.close(); }
    await fs.rename(tmp, file);
    if (durable) {
      const parent = await fs.open(path.dirname(file), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const exec = promisify(execFile);

function nodeEnvironment() {
  // pnpm and its lifecycle scripts must use the Node selected for this CLI.
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  return { ...process.env, [pathKey]: path.dirname(process.execPath) + path.delimiter + (process.env[pathKey] ?? '') };
}

function command(program, args, cwd, capture = false, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: nodeEnvironment(),
      shell: false,
      signal,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let result = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      result += chunk;
    });
    // Abort can emit error before close. Recovery must wait until the writer
    // has actually exited before measuring or restoring its output directories.
    let failure;
    child.on('error', error => { failure = error; });
    child.on('close', (code, sig) =>
      failure ? reject(failure) : code === 0 ? resolve(result.trim()) : reject(new Error(`${program} ${args[0]} exited with ${sig ?? code}`))
    );
  });
}

const inspectionPnpmOptions = ['--config.pmOnFail=ignore', '--config.ignore-pnpmfile=true', '--config.offline=true'];
async function inspectionPnpmVersion(root, signal) {
  // Even `pnpm list` can bootstrap package-manager metadata. Use pnpm's
  // externally managed mode only after checking the selected executable against
  // the project's pin. Never download a package manager during SDK inspection.
  const version = await command('pnpm', [...inspectionPnpmOptions, '--version'], root, true, signal);
  const { pm, warnings } = getWantedPackageManager(await readJson(path.join(root, 'package.json')));
  if (warnings.length || pm && (pm.name !== 'pnpm' || pm.version !== version))
    throw Error('Read-only SDK inspection requires the installed pnpm to match an exact project package-manager pin; ' +
      `selected pnpm ${version}, requested ${pm?.name ?? 'unknown'}@${pm?.version ?? 'unknown'}`);
  return version;
}
async function readOnlyPnpm(root, args, signal, capture = true) {
  await inspectionPnpmVersion(root, signal);
  return command('pnpm', [...inspectionPnpmOptions, ...args], root, capture, signal);
}

async function inventory(root) {
  const rows = JSON.parse(
    await readOnlyPnpm(root, ['--config.lockfile=false', '-r', 'list', '--depth', '-1', '--json'])
  );
  const entries = new Map();
  for (const row of rows) {
    const directory = await fs.realpath(row.path);
    if (!inside(root, directory)) throw Error('Workspace package is outside the selected checkout: ' + directory);
    const manifest = await readJson(path.join(directory, 'package.json'));
    if (!manifest.name) continue;
    if (entries.has(manifest.name)) throw Error('Duplicate workspace package: ' + manifest.name);
    entries.set(manifest.name, { directory, manifest });
  }
  return entries;
}
function frameworkDependencies(manifest, development = false) {
  const dependencies = { ...manifest.peerDependencies, ...manifest.dependencies,
    ...manifest.optionalDependencies, ...(development && manifest.devDependencies) };
  return Object.keys(dependencies).filter(name => name.startsWith(scope) &&
    !(manifest.peerDependenciesMeta?.[name]?.optional && !manifest.dependencies?.[name] &&
      !manifest.optionalDependencies?.[name] && !(development && manifest.devDependencies?.[name]))).sort();
}
async function moduleConfiguration(root) {
  const settings = await Promise.all(['nodeLinker', 'virtualStoreDir'].map(async key => JSON.parse(await readOnlyPnpm(
    root, ['--config.lockfile=false', 'config', 'get', key, '--json']
  ))));
  return { nodeLinker: settings[0] ?? 'isolated', virtualStoreDir: path.resolve(root, settings[1] ?? 'node_modules/.pnpm') };
}
async function consumerInputs(root, consumers) {
  const manifests = [...consumers.values()].map(({ directory, manifest }) => [path.relative(root, directory), manifest])
    .sort(([left], [right]) => left.localeCompare(right));
  const settings = [];
  for (const file of ['pnpm-workspace.yaml', '.npmrc']) settings.push([file,
    await fs.readFile(path.join(root, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })]);
  return { manifests, settings };
}
async function desiredProfile(root, source, distribution) {
  const packages = await inventory(source), consumers = await inventory(root);
  for (const { directory } of consumers.values()) {
    const modules = path.join(directory, 'node_modules');
    const present = await fs.lstat(modules).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present && !inside(root, await fs.realpath(modules)))
      throw Error('SDK installation requires project-owned node_modules; preserve the external dependency directory separately before selecting: ' + modules);
  }
  const links = {}, versions = {};
  function select(name) {
    if (Object.hasOwn(links, name)) return;
    const pkg = packages.get(name);
    if (!pkg) throw Error('SDK checkout does not provide ' + name);
    const manifest = frameworkPackage(name, pkg.directory);
    links[name] = pkg.directory;
    versions[name] = manifest.version;
    for (const dependency of frameworkDependencies(manifest)) select(dependency);
  }
  for (const { manifest } of consumers.values()) for (const name of frameworkDependencies(manifest, true)) {
    if (consumers.has(name)) throw Error('A consumer workspace cannot shadow framework SDK package ' + name);
    select(name);
  }
  if (!Object.keys(links).length) throw Error('The project declares no framework SDK dependencies');
  const { manifests, settings } = await consumerInputs(root, consumers);
  // Environment interpolation and global pnpm configuration can change module
  // placement without changing either workspace file. Bind the effective layout.
  const installation = await moduleConfiguration(root);
  const names = Object.keys(links).sort();
  return { schema: 1, root, source, lockSha256: lockIdentity(distribution), inputSha256: sha256(JSON.stringify({ manifests, settings, installation })),
    links: Object.fromEntries(names.map(name => [name, links[name]])), versions: Object.fromEntries(names.map(name => [name, versions[name]])) };
}

/** Both the observer and the writer compare the same complete pnpm profile. */
function rebindReason(active, installed, desired) {
  if (JSON.stringify(installed) !== JSON.stringify(active)) return 'The recorded installation differs from the active selection.';
  if (JSON.stringify(active) === JSON.stringify(desired)) return null;
  if (!active) return 'This project has no active development SDK selection.';
  if (active.source !== desired.source) return 'The requested SDK checkout differs from the active checkout.';
  if (active.lockSha256 !== desired.lockSha256) return 'The consumer distribution lock changed.';
  if (!isDeepStrictEqual(active.links, desired.links) || !isDeepStrictEqual(active.versions, desired.versions))
    return 'The selected framework packages, their locations or versions changed.';
  if (active.inputSha256 !== desired.inputSha256)
    return 'The consumer profile input digest changed. It covers complete workspace package manifests, pnpm settings and the effective installation layout.';
  return 'The recorded SDK selection differs from the requested profile.';
}

async function seedLock(root, dir, distribution) {
  if (applicationDocument(distribution) === null) {
    await fs.rm(path.join(dir, 'pnpm-lock.yaml'), { force: true });
    return;
  }
  const documents = lockDocuments(distribution);
  const app = documents.at(-1);
  const importers = app?.get('importers');
  const prefix = path.relative(dir, root).split(path.sep).join('/');
  for (const entry of importers?.items ?? []) entry.key.value = path.posix.normalize(path.posix.join(prefix, entry.key.value));
  await atomic(path.join(dir, 'pnpm-lock.yaml'), documents.map((doc) => doc.toString()).join('---\n'));
}

async function installDevelopment(root, profile, expectedDistribution = profile.lockSha256) {
  const dir = statePath(root);
  const distribution = await distributionLock(root);
  await assertDistribution(root, expectedDistribution);
  await seedLock(root, dir, distribution);
  // The workspace hook selects the same graph for normal pnpm install, run and exec.
  // Keep an interrupted reinstall distinguishable from its last accepted profile.
  await atomic(path.join(dir, 'install.json'), JSON.stringify({ ...profile, installing: true }, null, 2) + '\n');
  // The package-manager boot document was prepared before capturing the
  // baseline. Use ordinary hook discovery, also used by pnpm run/exec, so the
  // installed pnpmfile receipt matches verifyDepsBeforeRun.
  await command('pnpm', ['install', '--force', '--no-frozen-lockfile', '--config.confirm-modules-purge=false'], root);
  await assertDistribution(root, expectedDistribution);
  await verifyLinks(root, profile);
  await atomic(path.join(dir, 'install.json'), JSON.stringify(profile, null, 2) + '\n');
}
// Development consumers need not be Omnitron applications. Registry restoration
// checks their own frozen importers; release archive admission remains separate.
async function validateRegistryLock(root, distribution, consumers) {
  await assertDistribution(root, lockIdentity(distribution));
  const inputs = await consumerInputs(root, consumers);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-sdk-registry-'));
  try {
    // pnpm owns effective manifest semantics (overrides, catalogs, patches and
    // relative file references). A dry-run is insufficient: it exits zero even
    // when it reports changes to a frozen lock. Frozen + lockfile-only validates
    // without installing. Trust-lockfile skips a new supply-chain policy lookup,
    // not frozen importer/config checks. SDK inspection separately verifies the
    // installed framework's registry integrity/receipts; it is not a fresh audit.
    // Keep any package-manager cache/state writes outside the consumer.
    await readOnlyPnpm(root, ['install', '--frozen-lockfile', '--lockfile-only', '--offline', '--frozen-store', '--trust-lockfile',
      '--ignore-scripts', '--config.ignoreManifestCheck=false',
      '--config.dryRun=false', '--config.lockfile=true', '--config.cacheDir=' + path.join(scratch, 'cache'),
      '--state-dir', path.join(scratch, 'state')]);
    if (!isDeepStrictEqual(inputs, await consumerInputs(root, await inventory(root))))
      throw Error('Consumer manifests or pnpm configuration changed during registry validation; retry with stable inputs');
  } catch (error) {
    throw new Error('Frozen registry lock validation failed: the lock is stale or cannot be verified. ' +
      `${error.message}. Check the pnpm diagnostic and use a supported pnpm with a current registry lock. ` +
      'Custom manifest hooks are not executed by SDK validation.', { cause: error });
  } finally {
    try { await assertDistribution(root, lockIdentity(distribution)); }
    finally { await fs.rm(scratch, { recursive: true, force: true }); }
  }
}

async function registryBaseline(root, distribution, consumers) {
  if (distribution === null)
    throw Error('No distribution lock is available. Create a registry lock with pnpm install --lockfile-only --config.ignore-pnpmfile=true before sdk registry.');
  if (applicationDocument(distribution) === null)
    throw Error('The distribution lock contains package-manager metadata only; create a current registry application lock before sdk registry');
  consumers ??= await inventory(root);
  await validateRegistryLock(root, distribution, consumers);
  const importers = {}, packages = {};
  for (const document of lockDocuments(distribution)) {
    const graph = document.toJS();
    Object.assign(importers, graph?.importers);
    Object.assign(packages, graph?.packages);
  }
  const result = new Map(), sections = ['dependencies', 'devDependencies', 'optionalDependencies'];
  for (const { directory, manifest } of consumers.values()) {
    const key = path.relative(root, directory).split(path.sep).join('/') || '.';
    const importer = importers[key];
    if (!importer) throw Error('Distribution lock has no importer for ' + key);
    for (const name of frameworkDependencies(manifest, true)) {
      const entry = sections.map(section => importer[section]?.[name]).find(Boolean);
      const version = typeof entry?.version === 'string' ? entry.version.split('(')[0] : '';
      const archive = packages[name + '@' + version];
      if (!archive || /^(?:link:|file:|workspace:)/.test(version) || archive.resolution?.type ||
          !/^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/.test(archive.resolution?.integrity ?? ''))
        throw Error('Distribution lock must resolve a registry archive for ' + name);
      result.set(directory + '\0' + name, { version, importer: key, entry, resolution: archive.resolution });
    }
  }
  return result;
}

async function physicalInstallationDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory)
    throw Error('pnpm installation requires a physical directory: ' + directory);
  return directory;
}

async function readInstallationReceipt(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file)
    throw Error('pnpm installation requires a physical receipt file: ' + file);
  return fs.readFile(file, 'utf8');
}

async function registryInstallation(root) {
  const modules = await physicalInstallationDirectory(path.join(root, 'node_modules'));
  const { nodeLinker, virtualStoreDir: configured } = await moduleConfiguration(root);
  const documents = lockDocuments(await readInstallationReceipt(path.join(modules, '.modules.yaml')));
  const receipt = documents.length === 1 ? documents[0].toJS() : null;
  if (!['isolated', 'hoisted'].includes(nodeLinker) || receipt?.nodeLinker !== nodeLinker ||
      typeof receipt?.virtualStoreDir !== 'string' ||
      path.resolve(modules, receipt.virtualStoreDir) !== configured)
    throw Error('pnpm installation receipt does not match the configured nodeLinker and virtualStoreDir; run pnpm install for these settings');
  const store = await physicalInstallationDirectory(configured);
  const lock = applicationDocument(await readInstallationReceipt(path.join(store, 'lock.yaml')));
  if (!lock?.importers || !lock?.packages) throw Error('pnpm installed lock receipt is missing its application graph');
  return { nodeLinker, modules, store, lock };
}

// pnpm can hoist a direct dependency to an ancestor of its importer. Check
// the nearest installed copy, within this workspace, just as Node will use it.
async function installedWorkspacePackage(root, importer, name) {
  for (let directory = importer; inside(root, directory); directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    const entry = await fs.lstat(candidate).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry) return fs.realpath(candidate);
    if (directory === root) break;
  }
  throw Error('Workspace dependency ' + name + ' is not installed for ' + importer);
}

async function verifyLinks(root, profile) {
  const importers = await inventory(root);
  const locked = profile ? null : await registryBaseline(root, await distributionLock(root), importers);
  const installed = profile ? null : await registryInstallation(root);
  let verified = 0;
  for (const { directory, manifest } of importers.values()) {
    for (const name of frameworkDependencies(manifest, true)) {
      const actual = await installedWorkspacePackage(root, directory, name);
      if (!profile) {
        const identity = await readJson(path.join(actual, 'package.json'));
        const expected = locked.get(directory + '\0' + name);
        const importer = installed.lock.importers[expected.importer];
        const entry = ['dependencies', 'devDependencies', 'optionalDependencies'].map(section => importer?.[section]?.[name]).find(Boolean);
        if (!isDeepStrictEqual(entry, expected.entry) || !isDeepStrictEqual(
          installed.lock.packages[name + '@' + expected.version]?.resolution, expected.resolution
        )) throw Error('pnpm installed lock receipt does not match the distribution lock for ' + name);
        // Isolated pnpm stores may live on a separate volume. Their configured
        // physical identity and installed lock must agree with pnpm's receipt.
        // Hoisted packages remain in this workspace's real modules directories.
        let contained = inside(installed.store, actual);
        if (installed.nodeLinker === 'hoisted') {
          contained = inside(installed.modules, actual);
          if (!contained) {
            const localModules = path.join(directory, 'node_modules');
            if (inside(localModules, actual)) {
              await physicalInstallationDirectory(localModules);
              contained = true;
            }
          }
        }
        if (
          identity.name !== name ||
          identity.version !== expected.version || !contained
        )
          throw Error('Registry installation does not match the distribution lock for ' + name);
      } else if (actual !== profile.links[name])
        throw Error(`${manifest.name} resolves ${name} from ${actual}, expected ${profile.links[name]}`);
      verified++;
    }
  }
  if (profile) for (const [name, directory] of Object.entries(profile.links)) {
    if (!inside(profile.source, directory) || await fs.realpath(directory) !== directory)
      throw Error('Invalid Omnitron SDK package location for ' + name);
    const manifest = frameworkPackage(name, directory, profile.versions?.[name]);
    for (const dependency of frameworkDependencies(manifest)) {
      const actual = await installedWorkspacePackage(profile.source, directory, dependency);
      if (actual !== profile.links[dependency])
        throw Error(`${name} resolves ${dependency} from ${actual}, expected ${profile.links[dependency]}`);
    }
  }
  return verified;
}
async function frozen(root) {
  await registryBaseline(root, await distributionLock(root));
  await fs.rm(path.join(statePath(root), 'install.json'), { force: true });
  await command('pnpm', ['install', '--force', '--frozen-lockfile', '--config.confirm-modules-purge=false'], root);
}

const buildArguments = (names) => ['exec', 'turbo', 'run', 'build', ...[...names].sort().map(name => '--filter=' + name + '...')];

async function buildPlan(source, names, signal) {
  // Ask the same graph/cache engine that performs the build. Do not substitute
  // a second file scanner or let pnpm repair dependencies during inspection.
  // A dry plan only consumes task hashes and declarations. Even a read-only
  // Turbo cache creates its directory, so point it at the existing checkout.
  const plan = JSON.parse(await readOnlyPnpm(source,
    ['--config.verifyDepsBeforeRun=false', ...buildArguments(names), '--dry=json', '--cache=local:r', '--cache-dir=.'], signal));
  if (typeof plan.turboVersion !== 'string' || !Array.isArray(plan.tasks))
    throw Error('Turbo did not report a verifiable SDK build graph');
  return plan;
}

function planInputs(plan, names) {
  return Object.fromEntries([...names].sort().map(name => {
    const tasks = plan.tasks.filter(task => task.taskId === name + '#build');
    if (tasks.length !== 1 || typeof tasks[0].hash !== 'string' || !/^[a-f0-9]+$/.test(tasks[0].hash))
      throw Error('Turbo did not report a concrete build input hash for ' + name);
    if (typeof tasks[0].command !== 'string' || !tasks[0].command || tasks[0].command === '<NONEXISTENT>')
      throw Error('Turbo did not report a build command for ' + name);
    return [name, { turbo: plan.turboVersion, node: process.version, platform: process.platform,
      arch: process.arch, hash: tasks[0].hash }];
  }));
}

async function buildInputs(source, names, signal) {
  return planInputs(await buildPlan(source, names, signal), names);
}

async function watchGraph(profile, signal) {
  const { source } = profile;
  const plan = await buildPlan(source, Object.keys(profile.links), signal);
  const roots = new Map([[source, false]]);
  const declared = [];
  const files = Object.keys(plan.globalCacheInputs?.files ?? {}).map(file => path.resolve(source, file));
  const ignored = [];
  function add(directory, recursive) {
    if (!inside(source, directory)) throw Error('SDK watching requires build inputs inside its checkout: ' + directory);
    roots.set(directory, recursive || roots.get(directory) || false);
  }
  function patternRoot(pattern, base, global = false) {
    if (typeof pattern !== 'string') throw Error('Turbo reported an invalid SDK input pattern');
    if (pattern.startsWith('!') || pattern === '$TURBO_DEFAULT$') return;
    const expanded = pattern.replaceAll('$TURBO_ROOT$', source);
    const wildcard = expanded.search(/[*?[\]{}()]/);
    const prefix = wildcard === -1 ? expanded : expanded.slice(0, wildcard);
    const slash = prefix.lastIndexOf('/');
    const directory = path.resolve(base, prefix.slice(0, slash + 1) || '.');
    const remaining = expanded.slice(slash + 1);
    const recursive = wildcard !== -1 && (remaining.includes('/') || remaining.includes('**'));
    // An unbounded global pattern can include caches and build outputs. Refuse
    // that watch scope instead of silently excluding declared build inputs.
    if (global && directory === source && recursive)
      throw Error('SDK watching requires a bounded directory for global input pattern: ' + pattern);
    add(directory, recursive);
    declared.push([directory, recursive]);
  }
  const configuration = await readJson(path.join(source, 'turbo.json'));
  for (const pattern of configuration.globalDependencies ?? []) patternRoot(pattern, source, true);
  for (const task of plan.tasks) {
    if (typeof task.directory !== 'string') throw Error('Turbo did not report an SDK task directory');
    const directory = path.resolve(source, task.directory);
    add(directory, true);
    ignored.push(...['node_modules', '.git', '.turbo', '.pnpm-store'].map(name => path.join(directory, name) + path.sep));
    for (const pattern of task.resolvedTaskDefinition?.inputs ?? []) patternRoot(pattern, directory);
    files.push(...Object.keys(task.inputs ?? {}).map(file => path.resolve(directory, file)));
    for (const output of task.outputs ?? []) {
      const prefix = output.split(/[*?[\]{}()]/, 1)[0];
      if (prefix.endsWith('/') && !output.startsWith('!')) ignored.push(path.resolve(directory, prefix) + path.sep);
    }
  }
  for (const file of files) {
    if (!inside(source, file)) throw Error('SDK watching requires build inputs inside its checkout: ' + file);
  }
  // A missing static glob directory cannot be observed nonrecursively by Xec.
  // Require it explicitly; new files and subdirectories inside existing roots
  // are then discovered by polling without native notification support.
  for (const directory of roots.keys()) {
    if (await fs.realpath(directory).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }) !== directory) throw Error('SDK watch input directory must exist and be physical: ' + directory);
  }
  ignored.push(...['node_modules', '.git', '.turbo', '.pnpm-store'].map(name => path.join(source, name) + path.sep));
  if (await fs.lstat(path.join(source, '.git')).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  })) {
    const entries = await command('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], source, true, signal);
    ignored.push(...entries.split('\0').filter(file => file.endsWith('/')).map(file => path.resolve(source, file) + path.sep));
  }
  // Turbo may explicitly include a gitignored file or output. Such declared
  // inputs take precedence over polling exclusions.
  const ignore = [...new Set(ignored)].filter(pattern => !files.some(file => inside(pattern, file)) &&
    !declared.some(([directory, recursive]) => inside(pattern, directory) || recursive && inside(directory, pattern))).sort();
  const directories = [...roots].filter(([directory]) => ![...roots].some(([parent, recursive]) =>
    parent !== directory && recursive && inside(parent, directory))).sort(([left], [right]) => left.localeCompare(right));
  return { inputs: planInputs(plan, Object.keys(profile.links)), directories, ignore };
}

async function verifyInputs(profile, inputs, signal) {
  const current = await buildInputs(profile.source, Object.keys(inputs), signal);
  const changed = Object.keys(inputs).filter(name => !isDeepStrictEqual(inputs[name], current[name]));
  if (changed.length)
    throw Error('SDK build inputs changed for ' + changed.join(', ') + '; run sdk dev to rebuild before confirming readiness');
}

async function currentSourceInstallation(source, signal, options = []) {
  try {
    // A parent pnpm script exports a recursion guard; this probe owns the
    // check, but never repairs dependencies before retaining their before-image.
    await exec('pnpm', [...options, '--reporter=ndjson', 'exec', process.execPath, '--version'], {
      cwd: source, env: { ...nodeEnvironment(), pnpm_config_verify_deps_before_run: 'error' }, signal,
    });
    return true;
  } catch (error) {
    if (error.code === 1 && error.stderr?.split('\n').some(line => {
      try {
        const event = JSON.parse(line);
        return event.name === 'pnpm' && event.code === 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN';
      } catch { return false; }
    })) return false;
    throw error;
  }
}

// A comparison with hooks disabled cannot attest the result of an arbitrary
// source hook. The writer still uses the source's full pnpm configuration.
async function sourceHasPnpmHooks(source, signal) {
  for (const name of ['.pnpmfile.mjs', '.pnpmfile.cjs', '.pnpmfile.js']) {
    if (await fs.lstat(path.join(source, name)).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    })) return true;
  }
  const configured = await Promise.all(['pnpmfile', 'globalPnpmfile', 'configDependencies'].map(async key =>
    JSON.parse(await readOnlyPnpm(source, ['--config.lockfile=false', 'config', 'get', key, '--json'], signal))));
  return configured.some(value => value && (typeof value !== 'object' || Object.keys(value).length > 0));
}

async function build(profile, names, signal, locked = false) {
  if (!names.length) throw Error('No development SDK packages selected for building');
  const source = profile.source;
  const dir = await prepareState(source);
  const execute = async () => {
    if (!locked) {
      await assertSourceAvailable(source);
      await assertSourceAvailable(profile.root);
      await requireSdkMutationAuthority();
    }
    // pnpm's implicit pre-script install only warns on failure. Ask pnpm to
    // check its installation first, then require a successful frozen repair.
    if (!await currentSourceInstallation(source, signal)) {
      await command('pnpm', ['install', '--frozen-lockfile'], source, false, signal);
    }
    const inputs = await buildInputs(source, names, signal);
    // Keep pnpm's effective configuration identical for the dry graph and the
    // actual run, including any configuration variables declared as task inputs.
    await readOnlyPnpm(source, ['--config.verifyDepsBeforeRun=false', ...buildArguments(names)], signal, false);
    const hashes = {};
    for (const name of names) hashes[name] = await buildDigest(profile.links[name]);
    await verifyInputs(profile, inputs, signal);
    return { inputs, hashes };
  };
  return locked ? execute() : exclusively(dir, execute, signal);
}

async function profileStatus(root) {
  const active = await optionalJson(path.join(statePath(root), 'active.json'));
  if (active && (active.schema !== 1 || active.root !== root || typeof active.source !== 'string'))
    throw Error('Invalid local SDK selection');
  return active;
}

/** Read real inputs without importing an application, installing, building or
 * creating SDK state. Holds/SQLite files are operational and never change this
 * evidence, so the owner can re-inspect while holding its own migration. */
export async function inspectMigrationSdk(projectDirectory) {
  const root = await fs.realpath(projectDirectory);
  const profile = await profileStatus(root);
  if (!isDeepStrictEqual(profile, await optionalJson(path.join(statePath(root), 'install.json'))))
    throw Error('An SDK selection is interrupted; resolve it before reviewing migrations');
  const source = profile ? await fs.realpath(profile.source) : null;
  if (source && (source !== profile.source || inside(root, source) || inside(source, root)))
    throw Error('Migration SDK bindings require separate physical project and source workspaces');
  const workspaces = await Promise.all([root, ...(source ? [source] : [])].map(sdkWorkspaceIdentity));
  const inputs = [];
  for (const directory of workspaces.map(item => item.root)) {
    // Development profiles use the same canonical importer discovery as SDK
    // selection. Registry imports are verified by the owner's installed graph.
    const consumers = profile ? await inventory(directory) : new Map();
    const files = {};
    for (const file of ['package.json', 'pnpm-lock.yaml', '.pnpmfile.mjs', '.omnitron/dev-sdk/active.json',
      '.omnitron/dev-sdk/install.json', '.omnitron/dev-sdk/built.json']) {
      const bytes = await fs.readFile(path.join(directory, file)).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      files[file] = bytes === null ? null : sha256(bytes);
    }
    inputs.push({ root: directory, files, inputs: await consumerInputs(directory, consumers) });
  }
  if (profile && !isDeepStrictEqual(profile, await desiredProfile(root, source, await distributionLock(root))))
    throw Error('Development SDK inputs differ from the selected profile; resolve the selection before migrations');
  return { root, source, workspaces, bindings: profile?.links ?? {}, inputsSha256: sha256(JSON.stringify({ profile, inputs })) };
}

export async function withMigrationSdk(projectDirectory, reference, body) {
  const inspected = await inspectMigrationSdk(projectDirectory);
  return withMigrationSdkLocks(inspected.workspaces, reference, async hold => {
    const current = await profileStatus(inspected.root);
    if ((current?.source ?? null) !== inspected.source)
      throw Error('SDK source selection changed before migration admission');
    return body(hold);
  });
}

async function requireApplicationRuntime(client, refresh = false) {
  const { assertExecutionCapabilities } = await import('@omnitron-dev/omnitron/operations');
  const status = await client.status();
  assertExecutionCapabilities(status.execution?.ownerCapabilities,
    { applicationRuntimeResolution: 2, ...(refresh && { sourceRefresh: 1 }) }, 'Development SDK activation');
  if (status.execution.connection?.status !== 'connected')
    throw Error('Development SDK activation requires a current execution owner observation; restore the owner connection first');
  const runtime = status.execution.ownerRuntime;
  if (!runtime || ['node', 'abi', 'platform', 'arch'].some((key) => typeof runtime[key] !== 'string' || !runtime[key]))
    throw Error('Execution owner did not report its Node runtime. Prepare an owner transition before switching the development SDK');
  if (runtime.abi !== process.versions.modules || runtime.platform !== process.platform || runtime.arch !== process.arch)
    throw Error(`Development SDK Node ${process.version} (ABI ${process.versions.modules}, ${process.platform}/${process.arch}) ` +
      `is incompatible with owner Node ${runtime.node} (ABI ${runtime.abi}, ${runtime.platform}/${runtime.arch}). ` +
      'Run omnitron sdk with the owner-compatible Node before installing or building native dependencies');
  await (await client.service('OmnitronProject')).assertSdkMutable();
}

async function hasSdkOwnerSocket() {
  // An explicit endpoint requires an owner observation even if its socket is
  // currently missing. Never interpret a disconnected chosen owner as standalone.
  if (process.env.OMNITRON_SOCKET !== undefined) return true;
  const socket = path.join(process.env.OMNITRON_HOME ?? path.join(os.homedir(), '.omnitron'), 'daemon.sock');
  return !!await fs.lstat(socket).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
}
async function requireSdkMutationAuthority() {
  if (!await hasSdkOwnerSocket()) return;
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await import('@omnitron-dev/omnitron/operations');
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try { await requireApplicationRuntime(client); } finally { await client.disconnect(); }
}

async function localStack(root, stack) {
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await import('@omnitron-dev/omnitron/operations');
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const projects = await client.service('OmnitronProject');
    const candidates = [];
    for (const p of await projects.listProjects())
      if ((await fs.realpath(p.path).catch(() => null)) === root) candidates.push(p);
    if (candidates.length !== 1) throw Error('Expected exactly one registered project for ' + root);
    const project = candidates[0];
    const state = await projects.getStack({ project: project.name, stack });
    if (state.type !== 'local' || state.selectedRelease || state.config.watch === false)
      throw Error('SDK refresh requires an unpinned local development stack with watching enabled');
    await requireApplicationRuntime(client, true);
    return { client, state, project: project.name, configurations: project.configurations };
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

async function requireStopped(root, stack) {
  if (!stack && !await hasSdkOwnerSocket()) return;
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await import('@omnitron-dev/omnitron/operations');
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const service = await client.service('OmnitronProject');
    let found = false;
    let sourceStack = false;
    for (const project of await service.listProjects()) {
      if ((await fs.realpath(project.path).catch(() => null)) !== root) continue;
      for (const active of await service.listStacks({ project: project.name })) {
        if (active.type !== 'local' || active.selectedRelease) continue;
        sourceStack = true;
        if (active.name === stack) found = true;
        if (active.apps.some((app) => !['stopped', 'offline', 'not-started'].includes(app.status)))
          throw Error(`Stop ${project.name}/${active.name} before switching its working-tree dependencies`);
      }
    }
    if (stack && !found) throw Error('No local source stack named ' + stack + ' is registered for this checkout');
    if (sourceStack) await requireApplicationRuntime(client);
  } finally {
    await client.disconnect();
  }
}

async function requireSourceStopped(root, source, stack) {
  await requireStopped(root, stack);
  if (!stack && !await hasSdkOwnerSocket()) return;
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await import('@omnitron-dev/omnitron/operations');
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    await requireApplicationRuntime(client);
    const service = await client.service('OmnitronProject');
    for (const project of await service.listProjects()) {
      const running = (await service.listStacks({ project: project.name })).filter(item => item.type === 'local' &&
        !item.selectedRelease && item.apps.some(app => !['stopped', 'offline', 'not-started'].includes(app.status)));
      if (!running.length) continue;
      const directories = new Set([project.path, ...(project.configurations ?? []).map(item => item.path)]);
      for (const directory of directories) {
        const physical = await fs.realpath(directory);
        const selected = await profileStatus(physical);
        if (physical === root || inside(source, physical) || inside(physical, source) || selected &&
            (selected.source === source || Object.values(selected.links).some(file => inside(source, file))))
          throw Error(`Stop ${project.name}/${running.map(item => item.name).join(', ')} before changing shared SDK outputs`);
        // Absence of an SDK declaration does not prove that running source
        // applications are independent of this checkout. Never guess isolation.
        if (!selected) throw Error('Cannot prove SDK isolation for running project ' + project.name + '; its dependency binding must be established before this selection');
        await verifyLinks(physical, selected);
      }
    }
  } finally { await client.disconnect(); }
}

async function recordedStores(directory) {
  const stores = [];
  // The development hook moves lockfileDir and its installed graph to the
  // selection directory while importer links remain at the workspace root.
  for (const modules of [path.join(directory, 'node_modules'), path.join(statePath(directory), 'node_modules')]) {
    const receipt = await readInstallationReceipt(path.join(modules, '.modules.yaml')).catch(error => {
      if (error.code === 'ENOENT') return null; throw error;
    });
    if (receipt === null) continue;
    const store = lockDocuments(receipt).at(-1)?.toJS()?.virtualStoreDir;
    if (typeof store !== 'string') throw Error('Installed SDK dependency store has no location receipt');
    const installed = path.resolve(modules, store);
    if (!inside(directory, installed)) throw Error('SDK recovery requires a project-owned installed virtual store: ' + installed);
    stores.push({ modules, installed, digest: sha256(receipt) });
  }
  return stores;
}

async function selectionInventory(root, source, names, signal) {
  const paths = [], guards = [];
  let inputs;
  for (const directory of [root, source]) {
    const packages = await inventory(directory);
    const installation = await moduleConfiguration(directory);
    if (!inside(directory, installation.virtualStoreDir)) throw Error('SDK recovery requires a project-owned virtual store: ' + installation.virtualStoreDir);
    paths.push(path.join(directory, 'node_modules'), installation.virtualStoreDir, path.join(directory, 'pnpm-lock.yaml'));
    paths.push(path.join(statePath(directory), 'node_modules'));
    for (const { installed } of await recordedStores(directory)) paths.push(installed);
    guards.push(...['package.json', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.mjs'].map(file => path.join(directory, file)));
    for (const pkg of packages.values()) {
      paths.push(path.join(pkg.directory, 'node_modules'));
      guards.push(path.join(pkg.directory, 'package.json'));
    }
  }
  for (const modules of paths.filter(file => path.basename(file) === 'node_modules')) {
    const present = await fs.lstat(modules).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present && (present.isSymbolicLink() || !present.isDirectory() || await fs.realpath(modules) !== modules))
      throw Error('SDK recovery requires physical project-owned dependency directories: ' + modules);
  }
  if (names) {
    const plan = await buildPlan(source, names, signal);
    inputs = planInputs(plan, names);
    for (const task of plan.tasks) {
      const directory = path.resolve(source, task.directory ?? '.');
      if (!inside(source, directory)) throw Error('SDK task is outside its source checkout');
      for (const output of task.outputs ?? []) {
        if (output.startsWith('!')) continue;
        const first = output.split('/')[0];
        if (!first || first === '.' || first === '..' || /[*?[\]{}()]/.test(first))
          throw Error('SDK transition requires bounded task output directories: ' + output);
        paths.push(path.join(directory, first));
      }
      for (const file of Object.keys(task.inputs ?? {})) guards.push(path.resolve(directory, file));
    }
    for (const file of Object.keys(plan.globalCacheInputs?.files ?? {})) guards.push(path.resolve(source, file));
  }
  const previous = await profileStatus(root);
  if (previous && previous.source !== source) {
    guards.push(path.join(previous.source, 'node_modules'));
    for (const directory of Object.values(previous.links))
      guards.push(path.join(directory, 'package.json'), path.join(directory, 'dist'), path.join(directory, 'node_modules'));
  }
  // Restore physical outputs/bindings before exposing the previous selection.
  const stateFiles = ['pnpm-lock.yaml', 'built.json', 'install.json', 'active.json'].map(file => path.join(statePath(root), file));
  paths.push(...stateFiles);
  // Source repair is frozen: unlike the consumer's admitted manager document,
  // a source-lock edit is never owned by this selection or erased by recovery.
  const sourceLock = path.join(source, 'pnpm-lock.yaml');
  return { paths, inputs, guards: [...new Set([...guards, sourceLock])].filter(file =>
    file === sourceLock || !paths.some(output => inside(output, file))) };
}

async function checkoutRevision(directory, signal) {
  for (let base = directory; ; base = path.dirname(base)) {
    const gitDir = path.join(base, '.git');
    const marker = await fs.lstat(gitDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (marker) {
      const args = ['--git-dir=' + gitDir, '--work-tree=' + base];
      try { return (await exec('git', [...args, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { signal })).stdout.trim(); }
      catch (error) {
        if (error.code !== 1) throw error;
        const branch = (await exec('git', [...args, 'symbolic-ref', 'HEAD'], { signal })).stdout.trim();
        if (!(await exec('git', [...args, 'for-each-ref', '--format=%(refname)', branch], { signal })).stdout.trim())
          return { unborn: branch };
        throw error;
      }
    }
    if (path.dirname(base) === base) return null;
  }
}
const revisions = (root, source, signal) => Promise.all([checkoutRevision(root, signal), checkoutRevision(source, signal)]);
async function preparationInputs(root, source, profile, signal) {
  const inventory = await selectionInventory(root, source, profile && Object.keys(profile.links), signal);
  if (!profile) return { root, source, ...inventory };
  await assertDistribution(root, profile.lockSha256);
  const commits = await revisions(root, source, signal);
  const pnpm = await Promise.all([root, source].map(directory => inspectionPnpmVersion(directory, signal)));
  const intent = sha256(JSON.stringify({ operation: 'dev', profile, inputs: inventory.inputs, abi: process.versions.modules, commits, pnpm,
    paths: [...new Set(inventory.paths)].sort(), guards: [...new Set(inventory.guards)].sort() }));
  return { root, source, ...inventory, intent, projectRevision: commits[0], sourceRevision: commits[1] };
}
const preparationToken = selection => selection.journal.id + '.' + selection.journal.proof;
const defaultSource = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
async function sdkSource(root, candidate) {
  const source = await fs.realpath(candidate ?? defaultSource());
  if (inside(root, source) || inside(source, root)) throw Error('Select separate project and SDK workspaces');
  return source;
}
async function requireBridge(root) {
  const template = await fs.readFile(new URL('./pnpmfile-sdk.js', import.meta.url), 'utf8');
  if ((await fs.readFile(path.join(root, '.pnpmfile.mjs'), 'utf8').catch(() => null)) !== template)
    throw Error('Run omnitron sdk init to install or upgrade the project bridge, then commit the hook');
}
export async function prepareDevelopmentSdk(projectDirectory, checkout) {
  const root = await fs.realpath(projectDirectory);
  await requireBridge(root);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    return await exclusively(await prepareState(root), async () => {
      await assertSourceAvailable(root);
      const source = await sdkSource(root, checkout ?? (await profileStatus(root))?.source ??
        (await optionalJson(path.join(statePath(root), 'install.json')))?.source);
      return exclusively(await prepareState(source), async () => {
        await assertSourceAvailable(source);
        const profile = await desiredProfile(root, source, await distributionLock(root));
        const evidence = await preparationInputs(root, source, profile, controller.signal);
        const selection = await prepareSdkTransition({ ...evidence, detached: true, signal: controller.signal });
        return { root, source, projectRevision: evidence.projectRevision, sourceRevision: evidence.sourceRevision,
          token: preparationToken(selection), paths: selection.proof.entries.length,
          bytes: selection.proof.entries.reduce((sum, entry) => sum + entry.before.bytes, 0) };
      }, controller.signal);
    }, controller.signal);
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

async function changeSelection(root, source, stack, profile, signal, operation, prepared) {
  const sourceState = await prepareState(source);
  return exclusively(sourceState, async () => {
    await assertSourceAvailable(root);
    await assertSourceAvailable(source);
    await requireSourceStopped(root, source, stack);
    const retentionStarted = performance.now();
    let phaseStarted = retentionStarted, previousPhase = 'discovery';
    const evidence = await preparationInputs(root, source, profile, signal);
    const selection = prepared === undefined ? await prepareSdkTransition({ ...evidence, detached: true, signal,
      progress: ({ phase, paths, bytes }) => {
        const now = performance.now();
        const elapsed = ((now - retentionStarted) / 1000).toFixed(1);
        const duration = ((now - phaseStarted) / 1000).toFixed(1);
        const size = bytes === undefined ? '' : `, ${(bytes / 1024 ** 2).toFixed(1)} MiB`;
        console.log(`SDK recovery snapshot: ${phase} (${paths} paths${size}, ${previousPhase} took ${duration}s, ${elapsed}s total)`);
        phaseStarted = now;
        previousPhase = phase;
      },
    }) : await readPreparedSdkTransition(evidence, prepared, signal);
    if (profile) console.log('SDK recovery preparation: ' + preparationToken(selection));
    let ownedDistribution = await distributionLock(root);
    await beginSdkTransition(selection, { signal,
      admit: async () => {
        if (profile) {
          // A new glob input or effective pnpm setting can appear during the
          // full byte scans without changing any file in the earlier inventory.
          const current = await desiredProfile(root, source, await distributionLock(root));
          if ((await preparationInputs(root, source, current, signal)).intent !== evidence.intent)
            throw Error('SDK preparation inputs changed before selection');
        }
        await requireSourceStopped(root, source, stack);
      },
      fence: () => atomic(path.join(sourceState, 'pending-selection'), JSON.stringify({ root, id: selection.journal.id }) + '\n', true),
      unfence: () => clearSourceSelection(root, source, selection.journal.id),
    });
    try {
      const result = await operation(value => { ownedDistribution = value; });
      await assertDistribution(root, lockIdentity(ownedDistribution));
      await finishSdkTransition(selection, true);
      await clearSourceSelection(root, source, selection.journal.id);
      return result;
    } catch (error) {
      if (signal?.aborted) throw new Error('SDK writer was interrupted; its outputs are unconfirmed and were not overwritten. Run sdk status.', { cause: error });
      try {
        // An unexpected lock edit belongs to another writer, even when it was
        // made during a failing package-manager lifecycle script.
        await assertDistribution(root, lockIdentity(ownedDistribution));
        await finishSdkTransition(selection, false);
        await requireSourceStopped(root, source, stack);
        await recoverSdkTransition(root);
        await clearSourceSelection(root, source, selection.journal.id);
      } catch (recovery) {
        throw new AggregateError([error, recovery], `SDK selection failed: ${error.message}. Recovery is unconfirmed: ${recovery.message}`);
      }
      throw new Error(`SDK selection failed: ${error.message}. Previous SDK bytes and dependency bindings were restored; readiness still requires sdk status.`, { cause: error });
    }
  }, signal);
}

function dependsOn(manifest, changed, packages, seen = new Set()) {
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  })) {
    if (changed.has(name)) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = packages.get(name);
    if (pkg && dependsOn(pkg.manifest, changed, packages, seen)) return true;
  }
  return false;
}
function applicationBuildIdentity(manifest, hashes, packages) {
  // A local tool can execute a package declared as a development dependency.
  // SDK package traversal still follows its normal runtime dependency graph.
  const application = { ...manifest, dependencies: { ...manifest.devDependencies, ...manifest.dependencies } };
  const dependencies = Object.entries(hashes)
    .filter(([name]) => dependsOn(application, new Set([name]), packages))
    .sort(([left], [right]) => left.localeCompare(right));
  return dependencies.length ? sha256(JSON.stringify(dependencies)) : null;
}

// The stack configuration owns permanent opt-outs. Temporary suspensions have
// their own owner receipt tied to an exact source binding.
async function declaredWatchOptOuts(root, state, configurations) {
  const scope = state.runtimeScope;
  const sources = configurations?.filter(source => source.runtimeProject === scope?.project) ?? [];
  if (sources.length !== 1) throw Error('Cannot verify the watch policy of the registered stack configuration');
  const directory = await fs.realpath(sources[0].path);
  if (!inside(root, directory)) throw Error('Registered watch configuration is outside the selected development checkout');
  const { loadEcosystemConfig } = await import('@omnitron-dev/omnitron/config');
  const config = await loadEcosystemConfig(directory);
  return new Set(config.apps.filter(app => app.enabled !== false && app.watch === false)
    .map(app => scope.project + '/' + scope.stack + '/' + app.name));
}

async function observedSuspension(client, app) {
  const observation = await client.inspectSourceWatch({ name: app.handleKey });
  const receipt = observation.receipt;
  return observation.name === app.handleKey && observation.online === true && observation.registration === null &&
    observation.sameBinding === true && receipt?.phase === 'suspended' && typeof receipt.id === 'string' && receipt.id.length > 0 &&
    receipt.source?.name === app.handleKey && receipt.source.generation === app.generation ? receipt : null;
}

async function refresh(root, stack, checkpoint, packages, save, signal, launch) {
  const { client, state, project, configurations } = await localStack(root, stack);
  try {
    const report = message => { if (save) console.log(message); };
    const scopeName = project + '/' + stack;
    if (launch) assertLaunchedStack(state, launch);
    const previous = checkpoint.applications[scopeName];
    const applied = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    checkpoint.applications[scopeName] = applied;
    const inactive = new Set(['stopped', 'offline', 'not-started']);
    // Reject known unavailable applications before refreshing any sibling.
    for (const app of state.apps) {
      if (inactive.has(app.status)) continue;
      if (app.status !== 'online')
        throw Error(`SDK refresh was not applied to ${scopeName}/${app.name}: application is ${app.status}`);
      if (typeof app.handleKey !== 'string' || !app.handleKey)
        throw Error(`SDK refresh was not applied to ${scopeName}/${app.name}: application has no owned handle`);
    }
    const membership = apps => JSON.stringify(apps.map(app => [app.name, app.handleKey, app.status])
      .sort(([left], [right]) => String(left).localeCompare(String(right))));
    const admittedMembership = membership(state.apps);
    const confirmedSources = new Map();
    const activeNames = new Set(state.apps.filter(app => !inactive.has(app.status)).map(app => app.handleKey));
    for (const name of Object.keys(applied)) if (!activeNames.has(name)) delete applied[name];
    await save?.();
    const watched = await client.getWatchStatus();
    if (activeNames.size && !watched.enabled)
      throw Error('SDK refresh was not applied: ' + (watched.reason ?? 'application watching is unavailable'));
    const unbound = [...activeNames].filter(name => !watched.apps.some(source => source.name === name));
    const optOuts = unbound.length ? await declaredWatchOptOuts(root, state, configurations) : new Set();
    const excluded = new Map();
    const suspended = new Map();
    for (const name of unbound) {
      const app = state.apps.find(item => item.handleKey === name);
      if (!app.generation) throw Error('Execution owner did not identify the running generation for ' + name);
      if (!optOuts.has(name)) {
        const receipt = !save && !launch ? await observedSuspension(client, app) : null;
        if (!receipt) throw Error(`SDK refresh was not applied to ${name}: the application has no active watcher. Check its watch policy and owner diagnostics`);
        suspended.set(name, receipt);
        continue;
      }
      excluded.set(name, app.generation);
      delete applied[name];
    }
    if (activeNames.size > excluded.size + suspended.size && !watched.watching)
      throw Error('SDK refresh was not applied: application watching is unavailable');
    if (excluded.size) await save?.();
    const confirmed = [], stopped = [], unaffected = [];
    for (const app of state.apps) {
      signal?.throwIfAborted();
      if (inactive.has(app.status)) {
        report(`Inactive ${scopeName}/${app.name}: no SDK application receipt`);
        stopped.push(app.handleKey || scopeName + '/' + app.name);
        continue;
      }
      if (excluded.has(app.handleKey)) {
        report(`Application declares watch: false for ${app.handleKey}; no owner refresh receipt`);
        continue;
      }
      const held = suspended.get(app.handleKey);
      const info = held?.source ?? watched.apps.find((entry) => entry.name === app.handleKey);
      if (typeof info.generation !== 'string' || !info.generation || !Number.isSafeInteger(info.definitionRevision) || info.definitionRevision < 0)
        throw Error(`Execution owner did not report a source binding for ${app.handleKey}`);
      const directory = await fs.realpath(info.directory).catch(() => null);
      if (!directory || !inside(root, directory)) throw Error(`Watched source for ${app.handleKey} is outside the selected project or unavailable`);
      const pkg = [...packages.values()]
        .filter((p) => inside(p.directory, directory))
        .sort((a, b) => b.directory.length - a.directory.length)[0];
      if (!pkg) throw Error(`No workspace package owns the watched source of ${app.handleKey}`);
      const buildIdentity = applicationBuildIdentity(pkg.manifest, checkpoint.hashes, packages);
      const receipt = applied[app.handleKey];
      const matchesBuild = receipt?.generation === info.generation && receipt.definitionRevision === info.definitionRevision &&
        receipt.directory === directory && receipt.buildIdentity === buildIdentity;
      if (held) {
        if (buildIdentity && !matchesBuild) throw Error('No current SDK refresh receipt for suspended application ' + app.handleKey);
        continue;
      }
      if (!buildIdentity) {
        delete applied[app.handleKey];
        await save?.();
        confirmedSources.set(app.handleKey, info);
        unaffected.push(app.handleKey);
        report(`Unaffected ${app.handleKey}: no dependency on the selected SDK`);
        continue;
      }
      const current = await client.service('OmnitronProject').then((s) => s.getStack({ project, stack }));
      const latestWatch = await client.getWatchStatus();
      if (
        !latestWatch.enabled ||
        !latestWatch.watching ||
        !latestWatch.apps.some((w) => w.name === app.handleKey && w.directory === info.directory &&
          w.generation === info.generation && w.definitionRevision === info.definitionRevision)
      )
        throw Error(`Watch policy or source binding changed before refreshing ${app.handleKey}; SDK readiness is not confirmed`);
      if (
        current.selectedRelease ||
        current.type !== 'local' ||
        current.config.watch === false ||
        !current.apps.some((a) => a.handleKey === app.handleKey && a.status === 'online' && a.generation === info.generation)
      )
        throw Error(`Stack changed before refreshing ${app.handleKey}; SDK readiness is not confirmed`);
      if (launch) {
        if (launch.generations.get(app.handleKey) !== info.generation)
          throw Error('Source watcher generation differs from the start reply for ' + app.handleKey);
        applied[app.handleKey] = { generation: info.generation, definitionRevision: info.definitionRevision,
          directory, buildIdentity };
        confirmedSources.set(app.handleKey, info);
        confirmed.push(app.handleKey);
        continue;
      }
      if (matchesBuild) {
        confirmedSources.set(app.handleKey, info);
        confirmed.push(app.handleKey);
        continue;
      }
      if (!save) throw Error('No current SDK refresh receipt for ' + app.handleKey);
      const refreshed = await client.restartAfterChange({ name: app.handleKey,
        generation: info.generation, definitionRevision: info.definitionRevision });
      const source = refreshed?.source;
      if (refreshed?.process?.name !== app.handleKey || refreshed.process.status !== 'online' ||
          typeof refreshed.process.generation !== 'string' || !refreshed.process.generation ||
          refreshed.process.generation === info.generation || source?.name !== app.handleKey ||
          source.generation !== refreshed.process.generation || source.directory !== info.directory ||
          !Number.isSafeInteger(source.definitionRevision) || source.definitionRevision < 0)
        throw Error(`Execution owner did not confirm a new online generation for ${app.handleKey}`);
      applied[app.handleKey] = { generation: source.generation, definitionRevision: source.definitionRevision,
        directory, buildIdentity };
      // Persist each exact owner acknowledgement so a later application's
      // failure does not cause successful applications to restart again.
      await save();
      confirmedSources.set(app.handleKey, source);
      confirmed.push(app.handleKey);
      report('Refreshed ' + app.handleKey);
    }
    signal?.throwIfAborted();
    await requireApplicationRuntime(client, true);
    const finalState = await client.service('OmnitronProject').then(service => service.getStack({ project, stack }));
    const finalWatch = await client.getWatchStatus();
    if (launch) assertLaunchedStack(finalState, launch);
    if (finalState.selectedRelease || finalState.type !== 'local' || finalState.config.watch === false ||
        membership(finalState.apps) !== admittedMembership || finalWatch.enabled !== watched.enabled)
      throw Error(`Stack changed while confirming ${scopeName}; SDK readiness is not confirmed`);
    if (excluded.size) {
      const projects = await client.service('OmnitronProject').then(service => service.listProjects());
      const registration = projects.find(item => item.name === project);
      const finalOptOuts = await declaredWatchOptOuts(root, finalState, registration?.configurations);
      for (const [name, generation] of excluded) {
        if (!finalOptOuts.has(name) || finalWatch.apps.some(app => app.name === name) ||
            !finalState.apps.some(app => app.handleKey === name && app.generation === generation))
          throw Error(`Watch policy or generation changed while confirming ${name}; SDK readiness is not confirmed`);
      }
    }
    for (const [name, held] of suspended) {
      const app = finalState.apps.find(item => item.handleKey === name);
      if (finalWatch.apps.some(source => source.name === name) || !app || !isDeepStrictEqual(await observedSuspension(client, app), held))
        throw Error('Source suspension changed while confirming ' + name + '; SDK readiness is not confirmed');
    }
    for (const [name, source] of confirmedSources) {
      if (!finalWatch.enabled || !finalWatch.watching ||
          !finalState.apps.some(app => app.handleKey === name && app.status === 'online' && app.generation === source.generation) ||
          !finalWatch.apps.some(app => app.name === name && app.directory === source.directory &&
            app.generation === source.generation && app.definitionRevision === source.definitionRevision))
        throw Error(`Source binding changed while confirming ${name}; SDK readiness is not confirmed`);
    }
    await save?.();
    report(`Development SDK refresh confirmed for ${scopeName}: ${confirmed.length} applications, ${stopped.length} inactive, ${excluded.size} opted out of owner refresh`);
    return { stack: scopeName, confirmed, inactive: stopped, optedOut: [...excluded.keys()], unaffected,
      ...(suspended.size ? { suspended: [...suspended.keys()] } : {}) };
  } finally {
    await client.disconnect();
  }
}

async function buildDigest(directory) {
  const root = path.join(directory, 'dist'),
    hash = createHash('sha256');
  async function visit(relative) {
    const current = path.join(root, relative);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('SDK build output must be a physical directory: ' + current);
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, e.name);
      if (e.isDirectory()) await visit(file);
      // Declarations and static assets are build inputs too. A type-only SDK
      // change must invalidate a consumer's cached compiler result.
      else if (e.isFile()) {
        hash
          .update(file)
          .update('\0')
          .update(
            createHash('sha256')
              .update(await fs.readFile(path.join(root, file)))
              .digest()
          );
      } else throw Error('Unsupported SDK build output entry (expected a regular file or directory): ' + path.join(root, file));
    }
  }
  await visit('');
  return hash.digest('hex');
}

function stoppedLaunch(state, stack) {
  const stop = state.stopOperation;
  if (state.name !== stack || state.type !== 'local' || state.selectedRelease || state.config?.managedOrigin ||
      state.config?.watch === false || state.status !== 'stopped' || !state.apps.length ||
      !state.apps.every(app => ['stopped', 'offline', 'not-started'].includes(app.status)))
    throw Error('A reviewed SDK start requires a fully stopped local working-tree stack: ' + stack);
  if (!stop?.id || stop.phase !== 'stopped' || !stop.intentCommitted || stop.supersededAt)
    throw Error('Missing a current completed stack stop for ' + stack + '; inspect stack status');
  const applications = new Map(state.apps.map(app => [app.handleKey, [app.name, app.generation]]));
  if (applications.size !== state.apps.length || [...applications.keys()].some(name => typeof name !== 'string' || !name) ||
      !state.runtimeScope?.project || !state.runtimeScope.stack)
    throw Error('Owner did not identify every application of the stopped stack');
  return { stack, scope: state.runtimeScope, stop: stop.id, applications };
}

function assertLaunchedStack(state, launch) {
  if (state.name !== launch.stack || state.type !== 'local' || state.config?.managedOrigin || state.selectedRelease ||
      state.config?.watch === false || state.infrastructureMode !== 'preserve' || state.status !== 'running' ||
      state.notUp?.length || !isDeepStrictEqual(state.runtimeScope, launch.scope) ||
      state.stopOperation?.id !== launch.stop || !state.stopOperation.supersededAt ||
      state.apps.length !== launch.applications.size || new Set(state.apps.map(app => app.handleKey)).size !== state.apps.length)
    throw Error('Owner did not confirm the reviewed working-tree start of ' + launch.stack);
  for (const app of state.apps) {
    const stopped = launch.applications.get(app.handleKey);
    if (!stopped || stopped[0] !== app.name || app.status !== 'online' || typeof app.generation !== 'string' ||
        !app.generation || app.generation === stopped[1] || (launch.generations && launch.generations.get(app.handleKey) !== app.generation))
      throw Error('Owner did not confirm the new generation for ' + app.handleKey);
  }
}

async function verifyLaunchReview(service, target, digest) {
  const current = await service.reviewStackStart(target);
  if (current?.protocol !== 1 || current.project !== target.project || current.stack !== target.stack ||
      current.infrastructure !== 'preserve' || !isDeepStrictEqual(current.selection, { workingTree: true }) || current.digest !== digest)
    throw Error('The reviewed working-tree launch or infrastructure changed for ' + target.project + '/' + target.stack + '; inspect stack start --dry-run');
}

async function reviewedSdkLaunch(root, stack, digest) {
  const { client, state, project } = await localStack(root, stack);
  try {
    const launch = stoppedLaunch(state, stack);
    const target = { project, stack, workingTree: true, infrastructure: 'preserve' };
    await verifyLaunchReview(await client.service('OmnitronProject'), target, digest);
    return { target, launch, digest };
  } finally {
    await client.disconnect();
  }
}

async function verifySelectedProfile(profile) {
  const state = statePath(profile.root);
  if (!isDeepStrictEqual(await profileStatus(profile.root), profile) ||
      !isDeepStrictEqual(await optionalJson(path.join(state, 'install.json')), profile) ||
      !isDeepStrictEqual(await desiredProfile(profile.root, profile.source, await distributionLock(profile.root)), profile))
    throw Error('SDK selection or package graph changed during verification');
  await verifyLinks(profile.root, profile);
}

async function startStoppedStack(profile, stack, review, checkpoint, packages, persist, signal, beforeStart) {
  const { client, state, project } = await localStack(profile.root, stack);
  const scope = project + '/' + stack;
  let requested = false;
  try {
    const service = await client.service('OmnitronProject');
    const { target, launch, digest } = review;
    if (target.project !== project || !isDeepStrictEqual(stoppedLaunch(state, stack), launch))
      throw Error('The stopped stack changed during SDK preparation for ' + scope);
    const stateDir = statePath(profile.root);
    const attemptFile = path.join(stateDir, 'start-attempts.json');
    const attempts = (await optionalJson(attemptFile)) ?? {};
    if ((typeof attempts[scope] === 'string' ? attempts[scope] : attempts[scope]?.stop) === launch.stop)
      throw Error('This stop already had a start request. Inspect stack status and existing SDK receipts for ' + scope);
    await verifySelectedProfile(profile);
    await verifyOutputs(profile, checkpoint.hashes);
    await verifyLaunchReview(service, target, digest);
    if (!isDeepStrictEqual(stoppedLaunch(await service.getStack({ project, stack }), stack), launch))
      throw Error('The stopped stack changed before starting ' + scope);
    if (beforeStart) await beforeStart();
    else {
      await verifyInputs(profile, checkpoint.inputs, signal);
      await verifyOutputs(profile, checkpoint.hashes);
    }
    signal?.throwIfAborted();
    // One request per durable stop, even after a crashed CLI or lost RPC reply.
    const attempt = { protocol: 1, state: 'requested', stop: launch.stop, profile, target, digest,
      build: { inputs: checkpoint.inputs, hashes: checkpoint.hashes },
      launch: { ...launch, applications: [...launch.applications] } };
    const saveAttempt = async () => atomic(attemptFile, JSON.stringify({ ...attempts, [scope]: attempt }) + '\n', true);
    await saveAttempt();
    requested = true;
    const started = await service.startStack({ ...target, review: digest });
    assertLaunchedStack(started, launch);
    for (const app of started.apps)
      if (review.priorReceipts?.[app.handleKey]?.generation === app.generation)
        throw Error('Owner returned the previously recorded generation for ' + app.handleKey);
    launch.generations = new Map(started.apps.map(app => [app.handleKey, app.generation]));
    attempt.state = 'acknowledged';
    attempt.generations = [...launch.generations];
    await saveAttempt();
    const result = await confirmStartedStack(profile, stack, checkpoint, packages, launch, persist, signal);
    attempt.state = 'confirmed'; await saveAttempt();
    console.log(`Development SDK start confirmed for ${scope}: ${result.confirmed.length} watched applications, ${result.optedOut.length} opted out of owner refresh`);
  } catch (error) {
    if (!requested) throw error;
    let observed;
    try {
      const info = await client.service('OmnitronProject').then(service => service.getStack({ project, stack }));
      observed = info.status + ' (' + info.apps.map(app => app.name + ': ' + app.status).join(', ') + ')';
    } catch { observed = 'unavailable'; }
    throw new Error(`Reviewed start was sent once to ${scope}. Current stack: ${observed}. SDK readiness is unconfirmed: ${error.message}. Inspect sdk reconcile --stack ${stack} --check; do not repeat the start.`, { cause: error });
  } finally {
    await client.disconnect();
  }
}

// A stored successful start reply is evidence of its exact generations. Merely
// observing online processes after a lost reply cannot establish that identity.
async function confirmStartedStack(profile, stack, checkpoint, packages, launch, persist, signal) {
  const result = await refresh(profile.root, stack, checkpoint, packages, undefined, signal, launch);
  await verifySelectedProfile(profile);
  const { client, project } = await localStack(profile.root, stack);
  try {
    const confirm = async () => {
      const service = await client.service('OmnitronProject');
      assertLaunchedStack(await service.getStack({ project, stack }), launch);
      const observed = await client.getWatchStatus();
      for (const name of result.confirmed) {
        const receipt = checkpoint.applications[project + '/' + stack][name];
        if (!observed.enabled || !observed.watching || !observed.apps.some(app => app.name === name &&
            app.generation === receipt.generation && app.definitionRevision === receipt.definitionRevision))
          throw Error('Source binding changed before recording ' + name);
      }
    };
    if (persist) await persist(confirm); else await confirm();
    return result;
  } finally { await client.disconnect(); }
}

async function verifyOutputs(profile, hashes) {
  for (const [name, digest] of Object.entries(hashes)) {
    if (await buildDigest(profile.links[name]) !== digest)
      throw Error(`SDK output changed while confirming ${name}; application readiness was not recorded. Run sdk dev again`);
  }
}

async function checkpointSdkBuild(profile, built, stack, signal, packages, review, locked = false, beforeStart) {
  const checkpoint = path.join(statePath(profile.root), 'built.json');
  const prior = await optionalJson(checkpoint);
  const hashes = prior?.source === profile.source ? prior.hashes : {};
  const next = Object.fromEntries(Object.entries(hashes).filter(([name]) => Object.hasOwn(profile.links, name)));
  const inputs = Object.fromEntries(Object.entries(prior?.schema === 3 && prior.source === profile.source ? prior.inputs ?? {} : {})
    .filter(([name]) => Object.hasOwn(profile.links, name)));
  const changed = new Set();
  for (const [name, digest] of Object.entries(built.hashes)) {
    next[name] = digest;
    inputs[name] = built.inputs[name];
    if (hashes[name] !== next[name]) changed.add(name);
  }
  signal?.throwIfAborted();
  const nextCheckpoint = { schema: 3, source: profile.source, hashes: next, inputs,
    applications: prior?.schema === 3 && prior.source === profile.source && prior.applications &&
      typeof prior.applications === 'object' && !Array.isArray(prior.applications) ? prior.applications : {} };
  if (review) {
    const scope = review.target.project + '/' + stack;
    review.priorReceipts = nextCheckpoint.applications[scope];
    delete nextCheckpoint.applications[scope];
  }
  const sourceState = beforeStart ? statePath(profile.source) : await prepareState(profile.source);
  const persist = async (confirmLaunch) => {
    if (!locked) {
      await assertSourceAvailable(profile.source);
      await assertSourceAvailable(profile.root);
      await requireSdkMutationAuthority();
    }
    await verifyOutputs(profile, next);
    await verifyInputs(profile, inputs, signal);
    if (confirmLaunch) {
      await confirmLaunch();
      await verifyInputs(profile, inputs, signal);
    }
    await verifyOutputs(profile, next);
    signal?.throwIfAborted();
    await saveSdkBuildCheckpoint(profile.root, nextCheckpoint);
  };
  const save = () => locked ? persist() : exclusively(sourceState, persist, signal);
  // A completed build is a separate fact from any application's loaded modules.
  // Build-only use and another stack's receipt cannot certify this stack.
  // Strict reuse already has this verified build. Its first write belongs to
  // the guarded start request; new application receipts follow the acknowledgement.
  if (!beforeStart) await save();
  if (stack) {
    packages ??= new Map([...(await inventory(profile.source)), ...(await inventory(profile.root))]);
    if (review) {
      // A cold launch must consume one stable build, including during daemon RPC.
      // persist() already runs under this writer lock and never reacquires it.
      const launch = () => startStoppedStack(profile, stack, review, nextCheckpoint, packages, persist, signal, beforeStart);
      if (locked) await launch();
      else await exclusively(sourceState, launch, signal);
    } else await refresh(profile.root, stack, nextCheckpoint, packages, save, signal);
  } else {
    console.log(changed.size ? 'Development SDK build ready: ' + [...changed].join(', ') : 'Development SDK build is current');
  }
}

export async function watchSdk(profile, stack, signal) {
  if (stack) {
    const { client } = await localStack(profile.root, stack);
    await client.disconnect();
  }
  const verified = {};
  let pending = true, closed = false;
  let handles = [], watching = '';
  let timer, running, onAbort, rejectWatching;
  function observe(graph) {
    const configuration = JSON.stringify([graph.directories, graph.ignore]);
    if (configuration === watching) return;
    const next = [];
    let failure;
    for (const recursive of [false, true]) {
      const directories = graph.directories.filter(([, deep]) => deep === recursive).map(([directory]) => directory);
      if (!directories.length) continue;
      const handle = new FileWatcher(directories, { poll: true, pollInterval: 1000, debounce: 150,
        extensions: [], ignore: graph.ignore, recursive, persistent: true });
      handle.on('change', schedule);
      handle.once('error', error => { failure = error; rejectWatching(error); });
      next.push(handle);
    }
    for (const handle of next) {
      handle.start();
      if (failure) {
        for (const candidate of next) candidate.close();
        throw failure;
      }
    }
    for (const handle of handles) handle.close();
    handles = next;
    watching = configuration;
    // Recheck after changing observers so an edit between Turbo's plan and a
    // new polling baseline cannot disappear inside that setup window.
    pending = true;
  }
  async function rebuild() {
    pending = false;
    const graph = await watchGraph(profile, signal);
    observe(graph);
    const names = Object.keys(graph.inputs).filter(name => !isDeepStrictEqual(verified[name], graph.inputs[name]));
    if (!names.length) return false;
    const built = await build(profile, names, signal);
    await verifyLinks(profile.root, profile);
    await checkpointSdkBuild(profile, built, stack, signal);
    Object.assign(verified, built.inputs);
    return true;
  }
  const flush = async () => {
    if (closed || running || signal.aborted || !pending) return;
    running = rebuild();
    let replay = true;
    try {
      if (await running && !signal.aborted) console.log('Development SDK rebuild complete');
    } catch (error) {
      if (!signal.aborted) {
        replay = pending;
        pending = true;
        console.error('SDK build or refresh failed:', error.message);
      }
    } finally {
      running = undefined;
      if (!closed && !signal.aborted && pending && replay) queueMicrotask(flush);
    }
  };
  function schedule() {
    if (closed || signal.aborted) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  }
  try {
    await prepareState(profile.source);
    const graph = await watchGraph(profile, signal);
    if (!signal.aborted) await new Promise((resolve, reject) => {
      rejectWatching = reject;
      onAbort = resolve;
      signal.addEventListener('abort', onAbort, { once: true });
      observe(graph);
      console.log('Watching SDK build inputs at ' + profile.source + ' (polling every 1000 ms)');
      void flush();
    });
  } finally {
    closed = true;
    clearTimeout(timer);
    for (const handle of handles) handle.close();
    if (onAbort) signal.removeEventListener('abort', onAbort);
    await running?.catch(() => {});
    console.log('Development SDK watcher stopped');
  }
}

function completeBuildCheckpoint(profile, checkpoint) {
  return checkpoint?.schema === 3 && checkpoint.source === profile.source && checkpoint.hashes && checkpoint.inputs &&
    isDeepStrictEqual(Object.keys(checkpoint.hashes).sort(), Object.keys(profile.links).sort()) &&
    isDeepStrictEqual(Object.keys(checkpoint.inputs).sort(), Object.keys(profile.links).sort()) &&
    checkpoint.applications && typeof checkpoint.applications === 'object' && !Array.isArray(checkpoint.applications);
}

/** Writers repeat this verification with both workspace locks held. */
async function reusableBuild(profile, signal, inspection = false) {
  const file = path.join(statePath(profile.root), 'built.json');
  const checkpoint = await optionalJson(file);
  if (!completeBuildCheckpoint(profile, checkpoint))
    return { action: 'rebuild', reason: 'The selected packages have no complete build checkpoint.' };
  if (inspection && await sourceHasPnpmHooks(profile.source, signal))
    return { action: 'unconfirmed', reason: 'A source pnpm hook or configuration dependency requires verification during selection.' };
  if (!await currentSourceInstallation(profile.source, signal, inspection ? inspectionPnpmOptions : []))
    return { action: 'rebuild', reason: 'pnpm reports that the SDK checkout needs a frozen dependency installation.' };
  const inputs = await buildInputs(profile.source, Object.keys(profile.links), signal);
  const changed = Object.keys(checkpoint.inputs).filter(name => !isDeepStrictEqual(inputs[name], checkpoint.inputs[name]));
  if (changed.length) return { action: 'rebuild', reason: 'SDK build inputs changed for ' + changed.join(', ') + '.' };
  for (const [name, directory] of Object.entries(profile.links)) {
    let digest;
    try { digest = await buildDigest(directory); }
    catch (error) {
      if (error.code === 'ENOENT') return { action: 'rebuild', reason: 'SDK build output is missing for ' + name + '.' };
      throw error;
    }
    if (digest !== checkpoint.hashes[name]) return { action: 'rebuild', reason: 'SDK build output changed for ' + name + '.' };
  }
  await verifyInputs(profile, checkpoint.inputs, signal);
  if (!isDeepStrictEqual(await optionalJson(file), checkpoint)) throw Error('SDK checkpoint changed while verifying reuse');
  signal?.throwIfAborted();
  return { action: 'reuse', reason: 'The installed SDK, build inputs and outputs match the selected profile.',
    build: { inputs: checkpoint.inputs, hashes: checkpoint.hashes } };
}

async function reuseIdentity(profile, build, signal) {
  const installations = await Promise.all([profile.root, profile.source].map(async directory => {
    const workspace = await sdkReuseWorkspaceIdentity(directory), stores = await recordedStores(directory);
    const modules = [path.join(directory, 'node_modules'), path.join(statePath(directory), 'node_modules')];
    const locations = new Set([...modules, ...stores.map(({ installed }) => installed)]);
    const directories = await Promise.all([...locations].map(async entry => {
      const physical = await physicalInstallationDirectory(entry).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      const stat = physical && await fs.stat(physical, { bigint: true });
      return [path.relative(directory, entry), stat && { device: String(stat.dev), inode: String(stat.ino) }];
    }));
    const files = [path.join(directory, 'pnpm-lock.yaml'), path.join(statePath(directory), 'pnpm-lock.yaml'),
      ...modules.map(entry => path.join(entry, '.pnpm-workspace-state-v1.json')),
      ...stores.map(({ installed }) => path.join(installed, 'lock.yaml'))];
    const locks = await Promise.all(files.map(async file => {
      const value = await readInstallationReceipt(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      return [path.relative(directory, file), lockIdentity(value)];
    }));
    return { workspace, pnpm: await inspectionPnpmVersion(directory, signal), revision: await checkoutRevision(directory, signal),
      directories, stores, locks };
  }));
  return sha256(JSON.stringify({ operation: 'sdk-reuse', protocol: 1, profile, build, installations, abi: process.versions.modules }));
}

async function checkDevelopmentSelection(projectDirectory, checkout, signal) {
  const root = await fs.realpath(projectDirectory);
  await requireBridge(root);
  await assertSourceAvailable(root);
  const transition = await sdkTransitionStatus(root);
  if (transition && !sdkTransitionSettled(transition.phase)) throw Error('SDK transition is unfinished; run sdk recover before another selection');
  const active = await profileStatus(root);
  const installFile = path.join(statePath(root), 'install.json'), installed = await optionalJson(installFile);
  const source = await sdkSource(root, checkout ?? active?.source ?? installed?.source);
  await assertSourceAvailable(source);
  const desired = await desiredProfile(root, source, await distributionLock(root));
  const rebind = rebindReason(active, installed, desired);
  let result = { action: 'rebind', reason: rebind };
  if (!rebind) {
    await verifyLinks(root, desired);
    result = await reusableBuild(desired, signal, true);
  }
  const reuseDigest = result.action === 'reuse' ? await reuseIdentity(desired, result.build, signal) : null;
  await assertDistribution(root, desired.lockSha256);
  if (reuseDigest) await verifySelectedProfile(desired);
  if (!isDeepStrictEqual(active, await profileStatus(root)) || !isDeepStrictEqual(installed, await optionalJson(installFile)))
    throw Error('The SDK selection changed during inspection; repeat sdk prepare --check');
  await assertSourceAvailable(root);
  await assertSourceAvailable(source);
  signal?.throwIfAborted();
  return { profile: desired, build: result.build, report: { root, source, action: result.action,
    snapshotRequired: result.action === 'unconfirmed' ? null : result.action !== 'reuse',
    reason: result.reason, ...(reuseDigest && { reuseDigest }) } };
}

export async function inspectDevelopmentSdkSelection(projectDirectory, checkout) {
  return (await checkDevelopmentSelection(projectDirectory, checkout)).report;
}

// The consumer lock is already held. A strict selection only opens existing
// coordination state and has no path to installation, rebuilding or retention.
async function reuseReviewedSelection(root, source, digest, stack, launchReview, signal) {
  await sdkReuseWorkspaceIdentity(source);
  return exclusively(statePath(source), async () => {
    const qualify = async () => {
      const checked = await checkDevelopmentSelection(root, source, signal);
      if (checked.report.action !== 'reuse') throw Error('SDK reuse-only refused: ' + checked.report.reason);
      if (checked.report.reuseDigest !== digest)
        throw Error('SDK reuse-only refused: the verified checkout, installation or build differs from the reviewed digest.');
      signal.throwIfAborted();
      return checked;
    };
    const { profile, build: built } = await qualify();
    if (launchReview) {
      await requireSourceStopped(root, source, stack);
      const launch = await reviewedSdkLaunch(root, stack, launchReview);
      await checkpointSdkBuild(profile, built, stack, signal, undefined, launch, true, qualify);
    } else if (stack) {
      const { client } = await localStack(root, stack);
      await client.disconnect();
    }
    console.log('Reused the reviewed development SDK build');
  }, signal, true);
}

async function inspectBuild(active, stack) {
  const file = path.join(statePath(active.root), 'built.json');
  const checkpoint = await optionalJson(file);
  if (!completeBuildCheckpoint(active, checkpoint))
    throw Error('No source-verified build checkpoint for the selected development SDK; run sdk dev');
  async function verifyOutput() {
    for (const [name, directory] of Object.entries(active.links))
      if (await buildDigest(directory) !== checkpoint.hashes[name]) throw Error('SDK build output changed for ' + name);
  }
  await verifyInputs(active, checkpoint.inputs);
  await verifyOutput();
  let refreshStatus;
  if (stack) {
    const packages = new Map([...(await inventory(active.source)), ...(await inventory(active.root))]);
    // Inspection never saves a receipt or asks the owner to restart. The same
    // comparison used by refresh determines whether an existing receipt counts.
    refreshStatus = await refresh(active.root, stack, structuredClone(checkpoint), packages);
  }
  await verifyInputs(active, checkpoint.inputs);
  await verifyOutput();
  if (!isDeepStrictEqual(await optionalJson(file), checkpoint) || !isDeepStrictEqual(await profileStatus(active.root), active))
    throw Error('The SDK checkpoint or selection changed during inspection; repeat sdk status');
  return { build: { status: 'current', packages: Object.keys(checkpoint.inputs).sort() },
    ...(stack && { refresh: refreshStatus }) };
}

export async function inspectSdk(projectDirectory = process.cwd(), stack) {
  const root = await fs.realpath(projectDirectory);
  await assertSourceAvailable(root);
  const dir = statePath(root);
  const transition = await sdkTransitionStatus(root);
  if (transition && !sdkTransitionSettled(transition.phase))
    throw Error(`SDK transition ${transition.id} is ${transition.phase}; readiness is unconfirmed. Run sdk recover.`);
  const active = await profileStatus(root);
  if (active) await assertSourceAvailable(active.source);
  const distribution = await distributionLock(root);
  const selected = await optionalJson(path.join(dir, 'install.json'));
  if (JSON.stringify(selected) !== JSON.stringify(active))
    throw Error('An SDK switch was interrupted. Run sdk dev to complete it, or sdk registry if a current registry lock is available.');
  if (stack && !active) throw Error('Inspecting application refresh requires a local development SDK');
  return active
    ? {
        mode: 'development',
        source: active.source,
        verifiedImports: await verifyLinks(root, active),
        distributionLock: distribution === null ? 'absent' : applicationDocument(distribution) === null ? 'manager-only' : 'present',
        distributionLockChanged: lockIdentity(distribution) !== active.lockSha256,
        ...(transition && { transition }),
        ...await inspectBuild(active, stack),
      }
    : { mode: 'registry', verifiedImports: await verifyLinks(root, null), ...(transition && { transition }) };
}

async function startAttempt(root, stack) {
  const file = path.join(statePath(root), 'start-attempts.json');
  const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file ||
      typeof process.getuid === 'function' && (stat.uid !== process.getuid() || stat.mode & 0o077)))
    throw Error('SDK start attempts must be an owned, private regular file');
  const attempts = (await optionalJson(file)) ?? {};
  const matches = Object.entries(attempts).filter(([scope]) => scope.endsWith('/' + stack));
  if (matches.length > 1) throw Error('Several SDK start scopes match this stack; inspect its registered project');
  return { file, attempts, scope: matches[0]?.[0], attempt: matches[0]?.[1] };
}

function acknowledgedLaunch(root, stack, scope, attempt) {
  if (typeof attempt === 'string')
    throw Error('Legacy SDK attempt retains only its stop ID, without an acknowledged launch proof. Observe the owner; do not repeat the start or fabricate SDK receipts. Recovery requires a reviewed stop of its consumers.');
  if (attempt?.protocol !== 1 || !['acknowledged', 'confirmed'].includes(attempt.state) || !attempt.generations)
    throw Error('The SDK start has no durably acknowledged reply. Its outcome remains unconfirmed; observe the owner before reviewed recovery. No start will be replayed.');
  if (attempt.profile?.root !== root || !path.isAbsolute(attempt.profile?.source ?? '') ||
      attempt.target?.project + '/' + attempt.target?.stack !== scope || attempt.target.stack !== stack ||
      attempt.target.workingTree !== true || attempt.target.infrastructure !== 'preserve' ||
      !/^[a-f0-9]{64}$/.test(attempt.digest ?? '') || attempt.launch?.stack !== stack ||
      attempt.launch?.scope?.project + '/' + attempt.launch?.scope?.stack !== scope ||
      attempt.launch?.stop !== attempt.stop || typeof attempt.stop !== 'string' || !attempt.stop ||
      !Array.isArray(attempt.launch?.applications) || !attempt.launch.applications.length ||
      attempt.launch.applications.some(row => !Array.isArray(row) || row.length !== 2 ||
        typeof row[0] !== 'string' || !Array.isArray(row[1]) || row[1].length !== 2 || typeof row[1][0] !== 'string') ||
      !Array.isArray(attempt.generations) || attempt.generations.length !== attempt.launch.applications.length ||
      attempt.generations.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' ||
        typeof row[1] !== 'string' || !row[1])) throw Error('Invalid SDK acknowledged launch evidence');
  const launch = { ...attempt.launch, applications: new Map(attempt.launch.applications), generations: new Map(attempt.generations) };
  if (launch.applications.size !== attempt.launch.applications.length || launch.generations.size !== launch.applications.size ||
      [...launch.generations.keys()].some(name => !launch.applications.has(name)))
    throw Error('SDK acknowledged launch membership differs');
  return launch;
}

async function observeAcknowledgedLaunch(root, stack, record, persist) {
  const { attempt, scope } = record;
  const launch = acknowledgedLaunch(root, stack, scope, attempt), profile = attempt.profile;
  const transition = await sdkTransitionStatus(root);
  if (transition && !sdkTransitionSettled(transition.phase))
    throw Error('SDK file selection is unfinished; observing processes cannot commit or restore its bytes');
  await assertSourceAvailable(root); await assertSourceAvailable(profile.source);
  await verifySelectedProfile(profile);
  const file = path.join(statePath(root), 'built.json'), checkpoint = await optionalJson(file);
  if (!completeBuildCheckpoint(profile, checkpoint) || !isDeepStrictEqual(attempt.build, {
    inputs: checkpoint.inputs, hashes: checkpoint.hashes,
  })) throw Error('SDK build differs from the acknowledged start');
  const verify = async () => {
    await verifySelectedProfile(profile);
    await verifyInputs(profile, checkpoint.inputs); await verifyOutputs(profile, checkpoint.hashes);
    const { client } = await localStack(root, stack);
    try { await verifyLaunchReview(await client.service('OmnitronProject'), attempt.target, attempt.digest); }
    finally { await client.disconnect(); }
    if (!isDeepStrictEqual(await optionalJson(record.file), record.attempts)) throw Error('SDK launch evidence changed during reconciliation');
  };
  await verify();
  const next = structuredClone(checkpoint), packages = new Map([...(await inventory(profile.source)), ...(await inventory(root))]);
  const result = await confirmStartedStack(profile, stack, next, packages, launch, async confirm => {
    await verify(); await confirm(); await verify();
    if (!isDeepStrictEqual(await optionalJson(file), checkpoint)) throw Error('SDK checkpoint changed during reconciliation');
    if (persist) {
      await saveSdkBuildCheckpoint(root, next);
      await atomic(record.file, JSON.stringify({ ...record.attempts, [scope]: { ...attempt, state: 'confirmed' } }) + '\n', true);
    }
  });
  return result;
}

/** Read-only observation is also available for legacy/unknown outcomes. It
 * never upgrades a missing start reply into an application receipt. */
export async function inspectSdkLaunch(projectDirectory, stack) {
  const root = await fs.realpath(projectDirectory), record = await startAttempt(root, stack);
  const { attempt, scope } = record;
  const result = { stack: scope ?? stack, stop: typeof attempt === 'string' ? attempt : attempt?.stop ?? null,
    state: attempt ? 'unconfirmed' : 'absent', reconcilable: false,
    transition: await sdkTransitionStatus(root) };
  let client;
  try {
    const connection = await localStack(root, stack); client = connection.client;
    result.observation = { status: connection.state.status,
      apps: connection.state.apps.map(app => ({ name: app.name, status: app.status, generation: app.generation })) };
    if (scope && scope !== connection.project + '/' + stack) throw Error('Registered SDK project differs from the recorded start');
  } catch (error) { result.observation = { status: 'unavailable', reason: error.message }; }
  finally { await client?.disconnect(); }
  if (!attempt) { result.reason = 'No SDK start attempt is recorded for this stack'; return result; }
  try {
    await observeAcknowledgedLaunch(root, stack, record, false);
    result.reconcilable = true;
    if (attempt.state === 'confirmed') result.state = 'confirmed';
    else result.reason = 'The acknowledged generations are serving the unchanged SDK; explicit reconciliation can record their receipts';
  } catch (error) { result.reason = error.message; }
  return result;
}

export async function reconcileSdkLaunch(projectDirectory, stack) {
  const root = await fs.realpath(projectDirectory);
  return exclusively(await prepareState(root), async () => {
    const record = await startAttempt(root, stack);
    acknowledgedLaunch(root, stack, record.scope, record.attempt);
    return exclusively(await prepareState(record.attempt.profile.source), async () => {
      await requireSdkMutationAuthority();
      const result = await observeAcknowledgedLaunch(root, stack, record, true);
      return { state: 'confirmed', stop: record.attempt.stop, ...result };
    });
  });
}

/** Qualify present files independently of an earlier, no longer restorable SDK. */
export async function inspectSdkAdoption(projectDirectory, stack) {
  if (typeof stack !== 'string' || !stack.trim()) throw Error('Current SDK admission requires an explicit stack');
  const root = await fs.realpath(projectDirectory);
  const previous = await sdkAdoptionTransition(root), source = previous.transition.source;
  await assertSourceAvailable(root);
  await assertSourceAvailable(source, { root, id: previous.transition.id });
  const workspaces = await Promise.all([root, source].map(sdkWorkspaceIdentity));
  const profile = await profileStatus(root);
  if (!profile || profile.source !== source) throw Error('Current SDK selection does not match the recoverable operation');
  await verifySelectedProfile(profile);
  const checked = await reusableBuild(profile);
  if (checked.action !== 'reuse') throw Error('Current SDK inputs and outputs have no complete, unchanged build proof; adoption cannot rebuild or repair them');
  const checkpoint = await fs.readFile(path.join(statePath(root), 'built.json'), 'utf8');
  await verifySelectedProfile(profile);
  const final = await sdkAdoptionTransition(root);
  if (!isDeepStrictEqual(previous, final) || !isDeepStrictEqual(workspaces, await Promise.all([root, source].map(sdkWorkspaceIdentity))))
    throw Error('SDK ownership or launch evidence changed during current-state inspection');
  const plan = { protocol: 1, root, source, stack, workspaces, transition: previous.transition,
    startAttemptsSha256: previous.startAttemptsSha256, profileSha256: sha256(JSON.stringify(profile)),
    checkpointSha256: sha256(checkpoint), buildSha256: sha256(JSON.stringify(checked.build)) };
  return { digest: sha256(JSON.stringify(plan)), plan, launch: 'unconfirmed' };
}

export async function adoptSdk(projectDirectory, stack, review) {
  if (!/^[a-f0-9]{64}$/.test(review)) throw Error('Current SDK admission requires the exact reviewed digest');
  const root = await fs.realpath(projectDirectory);
  return exclusively(await prepareState(root), async () => {
    const previous = await sdkAdoptionTransition(root), source = previous.transition.source;
    return exclusively(await prepareState(source), async () => {
      await assertSourceAvailable(root);
      await assertSourceAvailable(source, { root, id: previous.transition.id });
      await requireSourceStopped(root, source, stack);
      await requireSdkMutationAuthority();
      const qualified = await inspectSdkAdoption(root, stack);
      if (qualified.digest !== review) throw Error('Current SDK state changed; inspect its new admission before proceeding');
      const revalidate = async () => {
        if ((await inspectSdkAdoption(root, stack)).digest !== review) throw Error('Current SDK state changed during admission');
        await requireSourceStopped(root, source, stack);
        await requireSdkMutationAuthority();
      };
      await requireSourceStopped(root, source, stack);
      await requireSdkMutationAuthority();
      const admission = await supersedeSdkTransition(root, qualified.plan, review, revalidate);
      await clearSourceSelection(root, source, previous.transition.id);
      return { state: 'current-files-adopted', digest: review, source, stack, launch: 'unconfirmed', history: admission.history };
    });
  });
}

export async function sdkCommand(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'project-dir': { type: 'string' },
      stack: { type: 'string' },
      'start-stopped': { type: 'boolean' },
      review: { type: 'string' },
      prepared: { type: 'string' },
      'reuse-only': { type: 'string' },
      'no-watch': { type: 'boolean' },
      json: { type: 'boolean' },
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [action, sourceArg] = positionals;
  if (values.help || !action) {
    console.log(help);
    return;
  }
  if (!['init', 'dev', 'prepare', 'status', 'registry', 'recover', 'reconcile', 'adopt'].includes(action) ||
      positionals.length > (['dev', 'prepare'].includes(action) ? 2 : 1) || values.prepared !== undefined && action !== 'dev' ||
      action === 'prepare' && (values.stack || values['no-watch']))
    throw Error(help);
  const reuseOnly = values['reuse-only'];
  if (reuseOnly !== undefined && (action !== 'dev' || !values['no-watch'] || values.prepared !== undefined ||
      !/^[a-f0-9]{64}$/.test(reuseOnly)))
    throw Error('Use sdk dev --no-watch --reuse-only DIGEST with the reuseDigest from sdk prepare --check. Choose either --prepared or --reuse-only.');
  if (values.check && !['prepare', 'reconcile', 'adopt'].includes(action) || ['reconcile', 'adopt'].includes(action) && !values.stack)
    throw Error('Use sdk prepare [SDK_CHECKOUT] [--check], sdk reconcile --stack NAME [--check] or sdk adopt --stack NAME (--check | --review DIGEST)');
  if (action === 'adopt' && (values['start-stopped'] || !!values.check === (values.review !== undefined) ||
      values.review !== undefined && !/^[a-f0-9]{64}$/.test(values.review)))
    throw Error('Use sdk adopt --stack NAME (--check | --review DIGEST)');
  if ((values['start-stopped'] || values.review !== undefined) &&
      action !== 'adopt' && (action !== 'dev' || !values.stack || !values['start-stopped'] || !/^[a-f0-9]{64}$/.test(values.review ?? '')))
    throw Error('Use sdk dev --stack NAME --start-stopped --review DIGEST with the exact preservation review');
  const root = await fs.realpath(values['project-dir'] ?? process.cwd()),
    dir = statePath(root);
  if (action === 'prepare') {
    console.log(JSON.stringify(await (values.check ? inspectDevelopmentSdkSelection : prepareDevelopmentSdk)(root, sourceArg), null, 2));
    return;
  }
  if (action === 'adopt') {
    console.log(JSON.stringify(await (values.check ? inspectSdkAdoption(root, values.stack) : adoptSdk(root, values.stack, values.review)), null, 2));
    return;
  }
  if (action === 'reconcile') {
    console.log(JSON.stringify(await (values.check ? inspectSdkLaunch : reconcileSdkLaunch)(root, values.stack), null, 2));
    return;
  }
  if (action === 'init') {
    const bridge = path.join(root, '.pnpmfile.mjs');
    const template = await fs.readFile(new URL('./pnpmfile-sdk.js', import.meta.url), 'utf8');
    await exclusively(await prepareState(root), async () => {
      await assertSourceAvailable(root);
      await requireSdkMutationAuthority();
      for (const existing of ['.pnpmfile.cjs', '.pnpmfile.js']) {
        if (await fs.stat(path.join(root, existing)).then(() => true, error => {
          if (error.code === 'ENOENT') return false; throw error;
        })) throw Error('An existing pnpm hook owns ' + existing + ' in ' + root);
      }
      try { await fs.writeFile(bridge, template, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const current = await fs.readFile(bridge, 'utf8');
        if (previousBridgeHashes.has(sha256(current))) await atomic(bridge, template);
        else if (current !== template)
          throw Error('An existing pnpm hook owns ' + bridge +
            '. Preserve that hook and integrate the SDK selection before enabling development.');
      }
    });
    console.log('Commit the pnpm hook. Select a local SDK with omnitron sdk dev, or install published dependencies with pnpm install.');
    console.log('Include .omnitron/dev-sdk/*.json in build cache inputs (Turbo: globalDependencies).');
    return;
  }
  const distribution = await distributionLock(root);
  if (action === 'status') {
    console.log(JSON.stringify(await inspectSdk(root, values.stack), null, 2));
    return;
  }
  if (action === 'dev') await requireBridge(root);
  if (reuseOnly !== undefined) await sdkReuseWorkspaceIdentity(root);
  else await prepareState(root);
  await exclusively(dir, async () => {
    await assertSourceAvailable(root);
    const transition = await sdkTransitionStatus(root);
    if (action === 'recover') {
      if (!transition) throw Error('No retained SDK transition is available');
      if (transition.phase === 'superseded') throw Error('The previous SDK attempt remains in history and cannot be restored after current-state admission');
      await sdkTransitionStatus(root, true);
      await exclusively(await prepareState(transition.source), async () => {
        await assertSourceAvailable(transition.source, { root, id: transition.id });
        await requireSourceStopped(root, transition.source, values.stack);
        await recoverSdkTransition(root);
        await clearSourceSelection(root, transition.source, transition.id);
      });
      console.log('Previous SDK bytes and dependency bindings restored. This does not certify source or application readiness; run sdk status.');
      return;
    }
    if (transition && !sdkTransitionSettled(transition.phase))
      throw Error('SDK transition is unfinished; run sdk recover before another selection');
    // A crash after committing the consumer receipt can precede releasing the
    // source fence. Clear that exact terminal fence before replacing history.
    if (transition && reuseOnly === undefined) {
      const sourceState = statePath(transition.source);
      if (await fs.realpath(sourceState) !== sourceState) throw Error('SDK source operation directory changed');
      await exclusively(sourceState, () => clearSourceSelection(root, transition.source, transition.id));
    }
    const previous = await profileStatus(root);
    const selection = path.join(dir, 'active.json');
    const selected = await optionalJson(path.join(dir, 'install.json'));
    const interrupted = JSON.stringify(selected) !== JSON.stringify(previous);
    if (action === 'registry') {
      if (!previous && !interrupted) {
        await verifyLinks(root, null);
        return;
      }
      await requireStopped(root, values.stack);
      await registryBaseline(root, distribution);
      await changeSelection(root, previous?.source ?? selected?.source, values.stack, undefined, undefined, async () => {
        await frozen(root);
        await verifyLinks(root, null);
        await fs.rm(selection, { force: true });
      });
      return;
    }
    const source = await sdkSource(root, sourceArg ?? previous?.source ?? selected?.source);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      if (reuseOnly !== undefined)
        return await reuseReviewedSelection(root, source, reuseOnly, values.stack, values.review, controller.signal);
      let desired = await desiredProfile(root, source, distribution);
      const launch = values['start-stopped'] ? await reviewedSdkLaunch(root, values.stack, values.review) : undefined;
      let built;
      if (rebindReason(previous, selected, desired)) {
        await changeSelection(root, source, values.stack, desired, controller.signal, async ownDistribution => {
          built = await build(desired, Object.keys(desired.links), controller.signal, true);
          if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
            throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
          const prepared = await bootstrapPackageManager(root, distribution);
          ownDistribution(prepared);
          desired = { ...desired, lockSha256: lockIdentity(prepared) };
          await installDevelopment(root, desired);
          await checkpointSdkBuild(desired, built, undefined, controller.signal, undefined, undefined, true);
          await atomic(selection, JSON.stringify(desired, null, 2) + '\n');
          if (prepared !== distribution)
            console.log('Accepted pnpm package-manager metadata in the distribution lock; the application dependency graph is unchanged.');
        }, values.prepared);
      } else {
        await verifyLinks(root, desired);
        if (values['no-watch'] || launch || values.prepared !== undefined) {
          if (values.stack && !launch) {
            const { client } = await localStack(root, values.stack);
            await client.disconnect();
          }
          const reused = await exclusively(await prepareState(source), async () => {
            await assertSourceAvailable(root);
            await assertSourceAvailable(source);
            if (launch) await requireSourceStopped(root, source, values.stack);
            await verifySelectedProfile(desired);
            const current = await reusableBuild(desired, controller.signal);
            if (current.action !== 'reuse') return false;
            await verifySelectedProfile(desired);
            console.log('Reusing verified development SDK build; no snapshot or rebuild is required');
            return true;
          }, controller.signal);
          // A stale build can overwrite shared outputs. changeSelection requires
          // stopped consumers and retains the before-image before any rebuild.
          if (reused && values.prepared !== undefined) throw Error('SDK build is already current. No selection requires a preparation. Run sdk dev without --prepared.');
          if (!reused) await changeSelection(root, source, values.stack, desired, controller.signal, async () => {
            built = await build(desired, Object.keys(desired.links), controller.signal, true);
            if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
              throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
            await verifyLinks(root, desired);
            await checkpointSdkBuild(desired, built, launch ? undefined : values.stack, controller.signal, undefined, undefined, true);
          }, values.prepared);
        }
      }
      // Commit the verified files before crossing the process-start boundary.
      // A lost start reply can never authorize restoring those files underneath
      // partially running applications, even if they still appear stopped.
      if (launch) await exclusively(await prepareState(source), async () => {
        await assertSourceAvailable(root); await assertSourceAvailable(source);
        await requireSourceStopped(root, source, values.stack);
        await verifySelectedProfile(desired);
        const current = await reusableBuild(desired, controller.signal);
        if (current.action !== 'reuse') throw Error('SDK build changed before reviewed start; no start was sent');
        await checkpointSdkBuild(desired, current.build, values.stack, controller.signal, undefined, launch, true);
      }, controller.signal);
      if (!values['no-watch']) await watchSdk(desired, values.stack, controller.signal);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }, undefined, reuseOnly !== undefined);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  sdkCommand(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
