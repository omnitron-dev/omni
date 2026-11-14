#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { FileWatcher } from '@xec-sh/loader/watch';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { getWantedPackageManager } from '@pnpm/config.reader';
import { frameworkPackage } from './pnpmfile-sdk.js';

const help = `omnitron sdk init [--project-dir PATH]
omnitron sdk dev [SDK_CHECKOUT] [--project-dir PATH] [--stack NAME [--start-stopped --review DIGEST]] [--no-watch]
omnitron sdk registry [--project-dir PATH]
omnitron sdk status [--project-dir PATH] [--stack NAME]

init installs the pnpm bridge without resolving registry dependencies.
dev selects the local SDK and watches its sources. Start again without a path to
reuse the selection. --no-watch builds the selected graph once without watching.
--stack confirms owner refreshes for watched applications in that local source stack.
--start-stopped binds the owner's first online generations to the SDK during a reviewed
working-tree start. Obtain the digest with stack start PROJECT STACK --dry-run --infrastructure preserve.
Applications declaring watch: false are reported separately. Missing required watchers fail.
status verifies current Turbo inputs and build outputs; --stack also verifies application receipts.
Inspection never builds, installs dependencies or restarts applications.
registry restores the frozen distribution dependencies. Releases always read Git.`;

const scope = '@omnitron-dev/';
// Released hook templates eligible for the explicit, idempotent init upgrade.
const previousBridgeHashes = new Set([
  '28220745dd5d0643c4ac64ef75e7c466a9863741bd23473bbbfccee5c5f7858b',
  '5d68d3ac4deb8f9d525b1db2e020dc1610d2ea49f3892232d982db20341c1735',
]);
const statePath = (root) => path.join(root, '.omnitron', 'dev-sdk');
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
async function atomic(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, value, { flag: 'wx', mode: 0o600 });
    await fs.rename(tmp, file);
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
    child.on('error', reject);
    child.on('close', (code, sig) =>
      code === 0 ? resolve(result.trim()) : reject(new Error(`${program} ${args[0]} exited with ${sig ?? code}`))
    );
  });
}

async function readOnlyPnpm(root, args, signal, capture = true) {
  // Even `pnpm list` can bootstrap package-manager metadata. Use pnpm's
  // externally managed mode only after checking the selected executable against
  // the project's pin. Never download a package manager during SDK inspection.
  const options = ['--config.pmOnFail=ignore', '--config.ignore-pnpmfile=true', '--config.offline=true'];
  const version = await command('pnpm', [...options, '--version'], root, true, signal);
  const { pm, warnings } = getWantedPackageManager(await readJson(path.join(root, 'package.json')));
  if (warnings.length || pm && (pm.name !== 'pnpm' || pm.version !== version))
    throw Error('Read-only SDK inspection requires the installed pnpm to match an exact project package-manager pin; ' +
      `selected pnpm ${version}, requested ${pm?.name ?? 'unknown'}@${pm?.version ?? 'unknown'}`);
  return command('pnpm', [...options, ...args], root, capture, signal);
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

async function prepareState(root) {
  const dir = statePath(root);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.realpath(dir)) !== dir) throw Error('SDK state directory must be local to this project');
  await fs.writeFile(path.join(dir, '.gitignore'), '*\n', { mode: 0o600 });
  return dir;
}

// The OS releases the SQLite writer lock if the process dies, including on Windows.
async function exclusively(dir, body, waitSignal) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'operation.sqlite'));
  try {
    for (;;) {
      waitSignal?.throwIfAborted();
      try {
        db.exec('BEGIN IMMEDIATE');
        break;
      } catch (error) {
        if (error.errcode !== 5) throw error;
        if (!waitSignal) throw Error('Another development SDK operation is active in ' + dir);
        await delay(200, undefined, { signal: waitSignal });
      }
    }
    return await body();
  } finally {
    db.close();
  }
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
  const plan = JSON.parse(await readOnlyPnpm(source,
    ['--config.verifyDepsBeforeRun=false', ...buildArguments(names), '--dry=json'], signal));
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

async function build(profile, names, signal) {
  if (!names.length) throw Error('No development SDK packages selected for building');
  const source = profile.source;
  const dir = await prepareState(source);
  return exclusively(dir, async () => {
    // pnpm's implicit pre-script install only warns on failure. Ask pnpm to
    // check its installation first, then require a successful frozen repair.
    try {
      // A parent pnpm script exports a recursion guard that overrides CLI
      // options. This probe checks a different workspace and owns its repair.
      await exec('pnpm', ['--reporter=ndjson', 'exec', process.execPath, '--version'], {
        cwd: source, env: { ...nodeEnvironment(), pnpm_config_verify_deps_before_run: 'error' }, signal,
      });
    } catch (error) {
      if (error.code !== 1 || !error.stderr?.split('\n').some(line => {
        try {
          const event = JSON.parse(line);
          return event.name === 'pnpm' && event.code === 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN';
        } catch { return false; }
      })) throw error;
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
  }, signal);
}

async function profileStatus(root) {
  const active = await optionalJson(path.join(statePath(root), 'active.json'));
  if (active && (active.schema !== 1 || active.root !== root || typeof active.source !== 'string'))
    throw Error('Invalid local SDK selection');
  return active;
}

async function requireApplicationRuntime(client, refresh = false) {
  const { assertExecutionCapabilities } = await import('@omnitron-dev/omnitron/operations');
  const status = await client.status();
  assertExecutionCapabilities(status.execution?.ownerCapabilities,
    { applicationRuntimeResolution: 1, ...(refresh && { sourceRefresh: 1 }) }, 'Development SDK activation');
  if (status.execution.connection?.status !== 'connected')
    throw Error('Development SDK activation requires a current execution owner observation; restore the owner connection first');
  const runtime = status.execution.ownerRuntime;
  if (!runtime || ['node', 'abi', 'platform', 'arch'].some((key) => typeof runtime[key] !== 'string' || !runtime[key]))
    throw Error('Execution owner did not report its Node runtime. Prepare an owner transition before switching the development SDK');
  if (runtime.abi !== process.versions.modules || runtime.platform !== process.platform || runtime.arch !== process.arch)
    throw Error(`Development SDK Node ${process.version} (ABI ${process.versions.modules}, ${process.platform}/${process.arch}) ` +
      `is incompatible with owner Node ${runtime.node} (ABI ${runtime.abi}, ${runtime.platform}/${runtime.arch}). ` +
      'Run omnitron sdk with the owner-compatible Node before installing or building native dependencies');
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
  const socket = path.join(process.env.OMNITRON_HOME ?? path.join(os.homedir(), '.omnitron'), 'daemon.sock');
  if (
    !stack &&
    !(await fs
      .lstat(socket)
      .then(() => true)
      .catch((error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      }))
  )
    return;
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

// The owner's watch inventory contains registrations, not reasons for their absence.
// Only an explicit opt-out in this stack's registered development checkout exempts an app.
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
    for (const name of unbound) {
      if (!optOuts.has(name)) throw Error(`SDK refresh was not applied to ${name}: the application has no active watcher. Check its watch policy and owner diagnostics`);
      const app = state.apps.find(item => item.handleKey === name);
      if (!app.generation) throw Error('Execution owner did not identify the running generation for ' + name);
      excluded.set(name, app.generation);
      delete applied[name];
    }
    if (activeNames.size > excluded.size && !watched.watching)
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
      const info = watched.apps.find((entry) => entry.name === app.handleKey);
      if (typeof info.generation !== 'string' || !info.generation || !Number.isSafeInteger(info.definitionRevision) || info.definitionRevision < 0)
        throw Error(`Execution owner did not report a source binding for ${app.handleKey}`);
      const directory = await fs.realpath(info.directory).catch(() => null);
      if (!directory || !inside(root, directory)) throw Error(`Watched source for ${app.handleKey} is outside the selected project or unavailable`);
      const pkg = [...packages.values()]
        .filter((p) => inside(p.directory, directory))
        .sort((a, b) => b.directory.length - a.directory.length)[0];
      if (!pkg) throw Error(`No workspace package owns the watched source of ${app.handleKey}`);
      const buildIdentity = applicationBuildIdentity(pkg.manifest, checkpoint.hashes, packages);
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
      const receipt = applied[app.handleKey];
      if (launch) {
        if (launch.generations.get(app.handleKey) !== info.generation)
          throw Error('Source watcher generation differs from the start reply for ' + app.handleKey);
        applied[app.handleKey] = { generation: info.generation, definitionRevision: info.definitionRevision,
          directory, buildIdentity };
        confirmedSources.set(app.handleKey, info);
        confirmed.push(app.handleKey);
        continue;
      }
      if (receipt?.generation === info.generation && receipt.definitionRevision === info.definitionRevision &&
          receipt.directory === directory && receipt.buildIdentity === buildIdentity) {
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
    for (const [name, source] of confirmedSources) {
      if (!finalWatch.enabled || !finalWatch.watching ||
          !finalState.apps.some(app => app.handleKey === name && app.status === 'online' && app.generation === source.generation) ||
          !finalWatch.apps.some(app => app.name === name && app.directory === source.directory &&
            app.generation === source.generation && app.definitionRevision === source.definitionRevision))
        throw Error(`Source binding changed while confirming ${name}; SDK readiness is not confirmed`);
    }
    await save?.();
    report(`Development SDK refresh confirmed for ${scopeName}: ${confirmed.length} applications, ${stopped.length} inactive, ${excluded.size} opted out of owner refresh`);
    return { stack: scopeName, confirmed, inactive: stopped, optedOut: [...excluded.keys()], unaffected };
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
    throw Error('SDK selection or package graph changed during reviewed start');
  await verifyLinks(profile.root, profile);
}

async function startStoppedStack(profile, stack, review, checkpoint, packages, persist, signal) {
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
    if (attempts[scope] === launch.stop)
      throw Error('This stop already had a start request. Inspect stack status and existing SDK receipts for ' + scope);
    await verifySelectedProfile(profile);
    await verifyOutputs(profile, checkpoint.hashes);
    await verifyLaunchReview(service, target, digest);
    if (!isDeepStrictEqual(stoppedLaunch(await service.getStack({ project, stack }), stack), launch))
      throw Error('The stopped stack changed before starting ' + scope);
    signal?.throwIfAborted();
    // One request per durable stop, even after a crashed CLI or lost RPC reply.
    await atomic(attemptFile, JSON.stringify({ ...attempts, [scope]: launch.stop }) + '\n');
    requested = true;
    const started = await service.startStack({ ...target, review: digest });
    assertLaunchedStack(started, launch);
    for (const app of started.apps)
      if (review.priorReceipts?.[app.handleKey]?.generation === app.generation)
        throw Error('Owner returned the previously recorded generation for ' + app.handleKey);
    launch.generations = new Map(started.apps.map(app => [app.handleKey, app.generation]));
    // Collect into memory; an incomplete launch certifies no application.
    const result = await refresh(profile.root, stack, checkpoint, packages, undefined, signal, launch);
    await verifySelectedProfile(profile);
    await persist(async () => {
      assertLaunchedStack(await service.getStack({ project, stack }), launch);
      const observed = await client.getWatchStatus();
      for (const name of result.confirmed) {
        const receipt = checkpoint.applications[scope][name];
        if (!observed.enabled || !observed.watching || !observed.apps.some(app => app.name === name &&
            app.generation === receipt.generation && app.definitionRevision === receipt.definitionRevision))
          throw Error('Source binding changed before recording ' + name);
      }
    });
    console.log(`Development SDK start confirmed for ${scope}: ${result.confirmed.length} watched applications, ${result.optedOut.length} opted out of owner refresh`);
  } catch (error) {
    if (!requested) throw error;
    let observed;
    try {
      const info = await client.service('OmnitronProject').then(service => service.getStack({ project, stack }));
      observed = info.status + ' (' + info.apps.map(app => app.name + ': ' + app.status).join(', ') + ')';
    } catch { observed = 'unavailable'; }
    throw new Error(`Reviewed start was sent once to ${scope}. Current stack: ${observed}. SDK readiness is unconfirmed: ${error.message}`, { cause: error });
  } finally {
    await client.disconnect();
  }
}

async function verifyOutputs(profile, hashes) {
  for (const [name, digest] of Object.entries(hashes)) {
    if (await buildDigest(profile.links[name]) !== digest)
      throw Error(`SDK output changed while confirming ${name}; application readiness was not recorded. Run sdk dev again`);
  }
}

async function checkpointSdkBuild(profile, built, stack, signal, packages, review) {
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
  const sourceState = await prepareState(profile.source);
  const persist = async (confirmLaunch) => {
    await verifyOutputs(profile, next);
    await verifyInputs(profile, inputs, signal);
    if (confirmLaunch) {
      await confirmLaunch();
      await verifyInputs(profile, inputs, signal);
    }
    await verifyOutputs(profile, next);
    signal?.throwIfAborted();
    await atomic(checkpoint, JSON.stringify(nextCheckpoint) + '\n');
  };
  const save = () => exclusively(sourceState, persist, signal);
  // A completed build is a separate fact from any application's loaded modules.
  // Build-only use and another stack's receipt cannot certify this stack.
  await save();
  if (stack) {
    packages ??= new Map([...(await inventory(profile.source)), ...(await inventory(profile.root))]);
    if (review) {
      // A cold launch must consume one stable build, including during daemon RPC.
      // persist() already runs under this writer lock and never reacquires it.
      await exclusively(sourceState, () => startStoppedStack(profile, stack, review, nextCheckpoint, packages, persist, signal), signal);
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

async function inspectBuild(active, stack) {
  const file = path.join(statePath(active.root), 'built.json');
  const checkpoint = await optionalJson(file);
  if (checkpoint?.schema !== 3 || checkpoint.source !== active.source || !checkpoint.hashes || !checkpoint.inputs ||
      !isDeepStrictEqual(Object.keys(checkpoint.hashes).sort(), Object.keys(active.links).sort()) ||
      !isDeepStrictEqual(Object.keys(checkpoint.inputs).sort(), Object.keys(active.links).sort()) ||
      !checkpoint.applications || typeof checkpoint.applications !== 'object')
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
  const dir = statePath(root);
  const active = await profileStatus(root);
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
        ...await inspectBuild(active, stack),
      }
    : { mode: 'registry', verifiedImports: await verifyLinks(root, null) };
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
      'no-watch': { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [action, sourceArg] = positionals;
  if (values.help || !action) {
    console.log(help);
    return;
  }
  if (!['init', 'dev', 'status', 'registry'].includes(action) || positionals.length > (action === 'dev' ? 2 : 1))
    throw Error(help);
  if ((values['start-stopped'] || values.review !== undefined) &&
      (action !== 'dev' || !values.stack || !values['start-stopped'] || !/^[a-f0-9]{64}$/.test(values.review ?? '')))
    throw Error('Use sdk dev --stack NAME --start-stopped --review DIGEST with the exact preservation review');
  const root = await fs.realpath(values['project-dir'] ?? process.cwd()),
    dir = statePath(root);
  const bridge = path.join(root, '.pnpmfile.mjs');
  const template = await fs.readFile(new URL('./pnpmfile-sdk.js', import.meta.url), 'utf8');
  if (action === 'init') {
    for (const existing of ['.pnpmfile.cjs', '.pnpmfile.js']) {
      if (
        await fs.stat(path.join(root, existing)).then(
          () => true,
          (error) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          }
        )
      )
        throw Error('An existing pnpm hook owns ' + existing + ' in ' + root);
    }
    try {
      await fs.writeFile(bridge, template, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await fs.readFile(bridge, 'utf8');
      if (previousBridgeHashes.has(sha256(current))) await atomic(bridge, template);
      else if (current !== template)
        throw Error(
          'An existing pnpm hook owns ' +
            bridge +
            '. Preserve that hook and integrate the SDK selection before enabling development.'
        );
    }
    console.log('Commit the pnpm hook. Select a local SDK with omnitron sdk dev, or install published dependencies with pnpm install.');
    console.log('Include .omnitron/dev-sdk/*.json in build cache inputs (Turbo: globalDependencies).');
    return;
  }
  const distribution = await distributionLock(root);
  if (action === 'status') {
    console.log(JSON.stringify(await inspectSdk(root, values.stack), null, 2));
    return;
  }
  if (action === 'dev' && (await fs.readFile(bridge, 'utf8').catch(() => null)) !== template)
    throw Error('Run omnitron sdk init to install or upgrade the project bridge, then commit the hook');
  await prepareState(root);
  await exclusively(dir, async () => {
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
      try {
        await frozen(root);
        await verifyLinks(root, null);
        await fs.rm(selection, { force: true });
      } catch (error) {
        try {
          if (previous && JSON.stringify(await optionalJson(path.join(dir, 'install.json'))) !== JSON.stringify(selected))
            await installDevelopment(root, previous, lockIdentity(distribution));
        } catch (rollback) {
          throw new AggregateError([error, rollback], 'Registry switch and recovery failed');
        }
        throw error;
      }
      return;
    }
    const source = await fs.realpath(
      sourceArg ?? previous?.source ?? selected?.source ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    );
    if (inside(root, source) || inside(source, root)) throw Error('Select separate project and SDK workspaces');
    let desired = await desiredProfile(root, source, distribution);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const launch = values['start-stopped'] ? await reviewedSdkLaunch(root, values.stack, values.review) : undefined;
      let built;
      if (interrupted || JSON.stringify(previous) !== JSON.stringify(desired)) {
        await requireStopped(root, values.stack);
        let registryAvailable = false;
        if (!previous) {
          try { await registryBaseline(root, distribution); registryAvailable = true; }
          catch { /* A missing or stale distribution is not a rollback target. */ }
        }
        built = await build(desired, Object.keys(desired.links), controller.signal);
        if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
          throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
        let prepared = distribution;
        let installationStarted = false;
        try {
          prepared = await bootstrapPackageManager(root, distribution);
          desired = { ...desired, lockSha256: lockIdentity(prepared) };
          installationStarted = true;
          await installDevelopment(root, desired);
          if (!launch) await checkpointSdkBuild(desired, built, undefined, controller.signal);
          await atomic(selection, JSON.stringify(desired, null, 2) + '\n');
          if (prepared !== distribution)
            console.log('Accepted pnpm package-manager metadata in the distribution lock; the application dependency graph is unchanged.');
        } catch (error) {
          if (!installationStarted || !previous && !registryAvailable) {
            try { await restoreDistribution(root, distribution, prepared); }
            catch (restore) { throw new AggregateError([error, restore], 'SDK switch failed; a changed distribution lock was preserved'); }
            if (!installationStarted) throw error;
            throw new Error(error.message + '. No verified registry baseline is available; the SDK installation is incomplete. Run sdk dev again to finish it.', { cause: error });
          }
          let recovery;
          try {
            if (previous) await installDevelopment(root, previous, lockIdentity(prepared));
            else if (registryAvailable) { await frozen(root); await verifyLinks(root, null); }
          } catch (rollback) { recovery = rollback; }
          try { await restoreDistribution(root, distribution, prepared); }
          catch (restore) { throw new AggregateError([error, ...(recovery ? [recovery] : []), restore], 'SDK switch failed; a changed distribution lock was preserved'); }
          if (recovery) throw new AggregateError([error, recovery], 'SDK switch and recovery failed');
          throw error;
        }
      } else {
        await verifyLinks(root, desired);
        if (values['no-watch'] || launch) {
          if (values.stack && !launch) {
            const { client } = await localStack(root, values.stack);
            await client.disconnect();
          }
          // Profile equality says nothing about source or built output. Let the
          // normal Turbo graph decide which tasks need rebuilding on every dev.
          built = await build(desired, Object.keys(desired.links), controller.signal);
          if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
            throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
          await verifyLinks(root, desired);
          if (!launch) await checkpointSdkBuild(desired, built, values.stack, controller.signal);
        }
      }
      if (launch) await checkpointSdkBuild(desired, built, values.stack, controller.signal, undefined, launch);
      if (!values['no-watch']) await watchSdk(desired, values.stack, controller.signal);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  sdkCommand(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
