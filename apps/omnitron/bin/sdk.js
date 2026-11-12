#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { frameworkPackage } from './pnpmfile-sdk.js';

const help = `omnitron sdk init [--project-dir PATH]
omnitron sdk dev [SDK_CHECKOUT] [--project-dir PATH] [--stack NAME] [--no-watch]
omnitron sdk registry [--project-dir PATH]
omnitron sdk status [--project-dir PATH]

init installs the pnpm bridge without resolving registry dependencies.
dev selects the local SDK and watches its sources. Start again without a path to
reuse the selection. --no-watch builds the selected graph once without watching.
--stack also refreshes running, watched applications in that local source stack.
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

function command(program, args, cwd, capture = false, signal) {
  return new Promise((resolve, reject) => {
    // pnpm and its lifecycle scripts must use the Node selected for this CLI,
    // including when it was invoked by absolute path under a different shell.
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    const child = spawn(program, args, {
      cwd,
      env: { ...process.env, [pathKey]: path.dirname(process.execPath) + path.delimiter + (process.env[pathKey] ?? '') },
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

async function inventory(root) {
  const rows = JSON.parse(
    await command(
      'pnpm',
      ['--config.lockfile=false', '--config.ignore-pnpmfile=true', '-r', 'list', '--depth', '-1', '--json'],
      root,
      true
    )
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
  const settings = await Promise.all(['nodeLinker', 'virtualStoreDir'].map(async key => JSON.parse(await command(
    'pnpm', ['--config.lockfile=false', '--config.ignore-pnpmfile=true', 'config', 'get', key, '--json'], root, true
  ))));
  return { nodeLinker: settings[0] ?? 'isolated', virtualStoreDir: path.resolve(root, settings[1] ?? 'node_modules/.pnpm') };
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
  const manifests = [...consumers.values()].map(({ directory, manifest }) => [path.relative(root, directory), manifest])
    .sort(([left], [right]) => left.localeCompare(right));
  const settings = [];
  for (const file of ['pnpm-workspace.yaml', '.npmrc']) settings.push([file,
    await fs.readFile(path.join(root, file), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })]);
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
async function registryBaseline(root, distribution, consumers) {
  if (distribution === null)
    throw Error('No distribution lock is available. Create a registry lock with pnpm install --lockfile-only --config.ignore-pnpmfile=true before sdk registry.');
  if (applicationDocument(distribution) === null)
    throw Error('The distribution lock contains package-manager metadata only; create a current registry application lock before sdk registry');
  consumers ??= await inventory(root);
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
    for (const section of sections) {
      const wanted = manifest[section] ?? {}, locked = importer[section] ?? {};
      if (Object.entries(wanted).some(([name, specifier]) => locked[name]?.specifier !== specifier) ||
          Object.keys(locked).some(name => !Object.hasOwn(wanted, name) && !Object.hasOwn(manifest.peerDependencies ?? {}, name)))
        throw Error('Distribution lock is stale for ' + key + ' / ' + section + '; create a current registry lock before sdk registry');
    }
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

async function verifyLinks(root, profile) {
  const importers = await inventory(root);
  const locked = profile ? null : await registryBaseline(root, await distributionLock(root), importers);
  const installed = profile ? null : await registryInstallation(root);
  let verified = 0;
  for (const { directory, manifest } of importers.values()) {
    for (const name of frameworkDependencies(manifest, true)) {
      const actual = await fs.realpath(path.join(directory, 'node_modules', name));
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
      const actual = await fs.realpath(path.join(directory, 'node_modules', dependency));
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

async function build(source, names, signal) {
  if (!names.length) return;
  const dir = await prepareState(source);
  await exclusively(
    dir,
    () =>
      command(
        'pnpm',
        ['exec', 'turbo', 'run', 'build', ...names.map((n) => '--filter=' + n + '...')],
        source,
        false,
        signal
      ),
    signal
  );
}

async function profileStatus(root) {
  const active = await optionalJson(path.join(statePath(root), 'active.json'));
  if (active && (active.schema !== 1 || active.root !== root || typeof active.source !== 'string'))
    throw Error('Invalid local SDK selection');
  return active;
}

async function requireApplicationRuntime(client) {
  const { assertExecutionCapabilities } = await import('@omnitron-dev/omnitron/operations');
  const status = await client.status();
  assertExecutionCapabilities(status.execution?.ownerCapabilities,
    { applicationRuntimeResolution: 1 }, 'Development SDK activation');
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
      if ((await fs.realpath(p.path).catch(() => null)) === root) candidates.push(p.name);
    if (candidates.length !== 1) throw Error('Expected exactly one registered project for ' + root);
    const state = await projects.getStack({ project: candidates[0], stack });
    if (state.type !== 'local' || state.selectedRelease || state.config.watch === false)
      throw Error('SDK refresh requires an unpinned local development stack with watching enabled');
    await requireApplicationRuntime(client);
    return { client, state, project: candidates[0] };
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
async function refresh(root, stack, changed, packages) {
  if (!stack) return;
  const { client, state, project } = await localStack(root, stack);
  try {
    const watched = await client.getWatchStatus();
    if (!watched.enabled || !watched.watching) return;
    for (const app of state.apps) {
      if (app.status !== 'online' || !app.handleKey) continue;
      const info = watched.apps.find((entry) => entry.name === app.handleKey);
      if (!info) continue;
      const directory = await fs.realpath(info.directory).catch(() => null);
      if (!directory || !inside(root, directory)) continue;
      const pkg = [...packages.values()]
        .filter((p) => inside(p.directory, directory))
        .sort((a, b) => b.directory.length - a.directory.length)[0];
      if (!pkg || !dependsOn(pkg.manifest, changed, packages)) continue;
      const current = await client.service('OmnitronProject').then((s) => s.getStack({ project, stack }));
      const latestWatch = await client.getWatchStatus();
      if (
        !latestWatch.enabled ||
        !latestWatch.watching ||
        !latestWatch.apps.some((w) => w.name === app.handleKey && w.directory === info.directory)
      )
        continue;
      if (
        current.selectedRelease ||
        current.type !== 'local' ||
        current.config.watch === false ||
        !current.apps.some((a) => a.handleKey === app.handleKey && a.status === 'online')
      )
        continue;
      await client.restartApp({ name: app.handleKey });
      console.log('Refreshed ' + app.handleKey);
    }
  } finally {
    await client.disconnect();
  }
}

async function buildDigest(directory) {
  const root = path.join(directory, 'dist'),
    hash = createHash('sha256');
  async function visit(relative) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
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
      }
    }
  }
  await visit('');
  return hash.digest('hex');
}

async function checkpointSdkBuild(profile, names, stack, signal, packages) {
  const checkpoint = path.join(statePath(profile.root), 'built.json');
  const prior = await optionalJson(checkpoint);
  const hashes = prior?.source === profile.source ? prior.hashes : {};
  const next = Object.fromEntries(Object.entries(hashes).filter(([name]) => Object.hasOwn(profile.links, name)));
  const changed = new Set();
  for (const name of names) {
    next[name] = await buildDigest(profile.links[name]);
    if (hashes[name] !== next[name]) changed.add(name);
  }
  signal?.throwIfAborted();
  if (changed.size && stack) {
    packages ??= new Map([...(await inventory(profile.source)), ...(await inventory(profile.root))]);
    await refresh(profile.root, stack, changed, packages);
  }
  await atomic(checkpoint, JSON.stringify({ source: profile.source, hashes: next }) + '\n');
  console.log(changed.size ? 'Development SDK ready: ' + [...changed].join(', ') : 'Development SDK is current');
}

export async function watchSdk(profile, stack, signal) {
  if (stack) {
    const { client } = await localStack(profile.root, stack);
    await client.disconnect();
  }
  const packages = new Map([...(await inventory(profile.source)), ...(await inventory(profile.root))]);
  const sdkPackages = new Map([...packages].filter(([name]) => Object.hasOwn(profile.links, name)));
  const pending = new Set(Object.keys(profile.links));
  const handles = [];
  let timer, running;
  async function rebuild() {
    const edits = new Set(pending);
    pending.clear();
    const names = [...sdkPackages]
      .filter(([name, pkg]) => edits.has(name) || dependsOn(pkg.manifest, edits, sdkPackages))
      .map(([name]) => name);
    await build(profile.source, names, signal);
    await verifyLinks(profile.root, profile);
    await checkpointSdkBuild(profile, names, stack, signal, packages);
  }
  const flush = async () => {
    if (running || signal.aborted || !pending.size) return;
    const attempted = [...pending];
    running = rebuild();
    let replay = true;
    try {
      await running;
    } catch (error) {
      if (!signal.aborted) {
        replay = pending.size > 0;
        for (const name of attempted) pending.add(name);
        console.error('SDK build or refresh failed:', error.message);
      }
    } finally {
      running = undefined;
      if (!signal.aborted && pending.size && replay) queueMicrotask(flush);
    }
  };
  function schedule(names) {
    for (const name of names) pending.add(name);
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  }
  try {
    for (const [name, dir] of Object.entries(profile.links)) {
      handles.push(watch(path.join(dir, 'src'), { recursive: true }, () => schedule([name])));
      handles.push(
        watch(dir, (_event, file) => {
          if (file && /^(?:package\.json|tsconfig.*\.json|(?:tsup|vite)\.config\..+)$/.test(String(file)))
            schedule([name]);
        })
      );
    }
    handles.push(
      watch(profile.source, (_event, file) => {
        if (['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.json'].includes(String(file)))
          schedule(Object.keys(profile.links));
      })
    );
    console.log('Watching SDK sources at ' + profile.source);
    void flush();
    if (!signal.aborted)
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', resolve, { once: true });
        for (const handle of handles) handle.once('error', reject);
      });
  } finally {
    clearTimeout(timer);
    for (const handle of handles) handle.close();
    await running?.catch(() => {});
  }
}

export async function inspectSdk(projectDirectory = process.cwd()) {
  const root = await fs.realpath(projectDirectory);
  const dir = statePath(root);
  const active = await profileStatus(root);
  const distribution = await distributionLock(root);
  const selected = await optionalJson(path.join(dir, 'install.json'));
  if (JSON.stringify(selected) !== JSON.stringify(active))
    throw Error('An SDK switch was interrupted. Run sdk dev to complete it, or sdk registry if a current registry lock is available.');
  return active
    ? {
        mode: 'development',
        source: active.source,
        verifiedImports: await verifyLinks(root, active),
        distributionLock: distribution === null ? 'absent' : applicationDocument(distribution) === null ? 'manager-only' : 'present',
        distributionLockChanged: lockIdentity(distribution) !== active.lockSha256,
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
    console.log(JSON.stringify(await inspectSdk(root), null, 2));
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
      if (interrupted || JSON.stringify(previous) !== JSON.stringify(desired)) {
        await requireStopped(root, values.stack);
        let registryAvailable = false;
        if (!previous) {
          try { await registryBaseline(root, distribution); registryAvailable = true; }
          catch { /* A missing or stale distribution is not a rollback target. */ }
        }
        await build(source, Object.keys(desired.links), controller.signal);
        if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
          throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
        let prepared = distribution;
        let installationStarted = false;
        try {
          prepared = await bootstrapPackageManager(root, distribution);
          desired = { ...desired, lockSha256: lockIdentity(prepared) };
          installationStarted = true;
          await installDevelopment(root, desired);
          await checkpointSdkBuild(desired, Object.keys(desired.links), undefined, controller.signal);
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
        if (values['no-watch']) {
          if (values.stack) {
            const { client } = await localStack(root, values.stack);
            await client.disconnect();
          }
          // Profile equality says nothing about source or built output. Let the
          // normal Turbo graph decide which tasks need rebuilding on every dev.
          await build(source, Object.keys(desired.links), controller.signal);
          if (!isDeepStrictEqual(await desiredProfile(root, source, distribution), desired))
            throw Error('Consumer or SDK inputs changed while building; run sdk dev again');
          await verifyLinks(root, desired);
          await checkpointSdkBuild(desired, Object.keys(desired.links), values.stack, controller.signal);
        }
      }
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
