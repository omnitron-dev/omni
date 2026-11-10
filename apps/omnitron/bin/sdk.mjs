#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { parseAllDocuments } from 'yaml';
import { readFrameworkLayout } from '@omnitron-dev/omnitron/source-layout';

const help = `omnitron sdk init [--project-dir PATH]
omnitron sdk dev [SDK_CHECKOUT] [--project-dir PATH] [--stack NAME] [--no-watch]
omnitron sdk registry [--project-dir PATH]
omnitron sdk status [--project-dir PATH]

dev selects the local SDK and watches its sources. Start again without a path to
reuse the selection. --no-watch installs the profile for a separate watch session.
--stack also refreshes running, watched applications in that local source stack.
registry restores the frozen distribution dependencies. Releases always read Git.`;

const scope = '@omnitron-dev/';
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
    const child = spawn(program, args, {
      cwd,
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
async function desiredProfile(root, source, distribution) {
  const layout = readFrameworkLayout(distribution);
  if (layout.kind !== 'registry')
    throw Error('Commit an npm registry lockfile for the project before selecting a development SDK');
  const packages = await inventory(source);
  const links = {};
  for (const { name } of layout.packages) {
    const pkg = packages.get(name);
    if (!pkg || pkg.manifest.private) throw Error('SDK checkout does not provide ' + name);
    links[name] = pkg.directory;
  }
  return { schema: 1, root, source, lockSha256: sha256(distribution), links };
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
  const documents = parseAllDocuments(distribution);
  const app = documents.at(-1);
  const importers = app.get('importers');
  const prefix = path.relative(dir, root).split(path.sep).join('/');
  for (const entry of importers.items) entry.key.value = path.posix.normalize(path.posix.join(prefix, entry.key.value));
  await atomic(path.join(dir, 'pnpm-lock.yaml'), documents.map((doc) => doc.toString()).join('---\n'));
}

async function installDevelopment(root, profile) {
  const dir = statePath(root);
  const distribution = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  if (profile.lockSha256 !== sha256(distribution))
    throw Error('Distribution lock changed while preparing the development profile');
  await seedLock(root, dir, distribution);
  // The workspace hook selects the same graph for normal pnpm install, run and exec.
  await atomic(path.join(dir, 'install.json'), JSON.stringify(profile, null, 2) + '\n');
  await command('pnpm', ['install', '--force', '--no-frozen-lockfile', '--config.confirm-modules-purge=false'], root);
  if (sha256(await fs.readFile(path.join(root, 'pnpm-lock.yaml'))) !== profile.lockSha256)
    throw Error('Distributed lockfile changed during the local installation');
  await verifyLinks(root, profile);
}
async function verifyLinks(root, profile) {
  const importers = await inventory(root);
  const locked = profile ? null : readFrameworkLayout(await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  if (locked && locked.kind !== 'registry') throw Error('The distribution lock must select registry packages');
  let verified = 0;
  for (const { directory, manifest } of importers.values()) {
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    })) {
      if (!name.startsWith(scope)) continue;
      if (
        manifest.peerDependenciesMeta?.[name]?.optional &&
        !manifest.dependencies?.[name] &&
        !manifest.devDependencies?.[name]
      )
        continue;
      const actual = await fs.realpath(path.join(directory, 'node_modules', name));
      if (!profile) {
        const identity = await readJson(path.join(actual, 'package.json'));
        const entry = locked.packages.find((pkg) => pkg.name === name);
        if (
          !entry ||
          identity.name !== name ||
          identity.version !== entry.version ||
          !inside(path.join(root, 'node_modules'), actual)
        )
          throw Error('Registry installation does not match the distribution lock for ' + name);
      } else if (actual !== profile.links[name])
        throw Error(`${manifest.name} resolves ${name} from ${actual}, expected ${profile.links[name]}`);
      verified++;
    }
  }
  return verified;
}
async function frozen(root) {
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
    for (const project of await service.listProjects()) {
      if ((await fs.realpath(project.path).catch(() => null)) !== root) continue;
      for (const active of await service.listStacks({ project: project.name })) {
        if (active.type !== 'local' || active.selectedRelease) continue;
        if (active.name === stack) found = true;
        if (active.apps.some((app) => !['stopped', 'offline', 'not-started'].includes(app.status)))
          throw Error(`Stop ${project.name}/${active.name} before switching its working-tree dependencies`);
      }
    }
    if (stack && !found) throw Error('No local source stack named ' + stack + ' is registered for this checkout');
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

async function runtimeDigest(directory) {
  const root = path.join(directory, 'dist'),
    hash = createHash('sha256');
  async function visit(relative) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, e.name);
      if (e.isDirectory()) await visit(file);
      else if (e.isFile() && /\.(?:(?:c|m)?js|json|css|wasm)$/.test(file)) {
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

export async function watchSdk(profile, stack, signal) {
  const packages = new Map([...(await inventory(profile.source)), ...(await inventory(profile.root))]);
  const checkpoint = path.join(statePath(profile.root), 'built.json');
  const prior = await optionalJson(checkpoint);
  const hashes = prior?.source === profile.source ? prior.hashes : {};
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
    const changed = new Set();
    const next = { ...hashes };
    for (const name of names) {
      next[name] = await runtimeDigest(profile.links[name]);
      if (hashes[name] !== next[name]) changed.add(name);
    }
    if (signal.aborted) return;
    if (changed.size) await refresh(profile.root, stack, changed, packages);
    Object.assign(hashes, next);
    await atomic(checkpoint, JSON.stringify({ source: profile.source, hashes }) + '\n');
    console.log(changed.size ? 'Development SDK ready: ' + [...changed].join(', ') : 'Development SDK is current');
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
  const distribution = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const selected = await optionalJson(path.join(dir, 'install.json'));
  if (JSON.stringify(selected) !== JSON.stringify(active))
    throw Error('An SDK switch was interrupted. Run sdk registry or sdk dev to reconcile the installation.');
  return active
    ? {
        mode: 'development',
        source: active.source,
        verifiedImports: await verifyLinks(root, active),
        distributionLockChanged: sha256(distribution) !== active.lockSha256,
      }
    : { mode: readFrameworkLayout(distribution).kind, verifiedImports: await verifyLinks(root, null) };
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
  const template = await fs.readFile(new URL('./pnpmfile-sdk.mjs', import.meta.url), 'utf8');
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
    if (await optionalJson(path.join(dir, 'install.json')))
      throw Error('Restore the registry profile before initializing its distribution hook');
    try {
      await fs.writeFile(bridge, template, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if ((await fs.readFile(bridge, 'utf8')) !== template)
        throw Error(
          'An existing pnpm hook owns ' +
            bridge +
            '. Preserve that hook and integrate the SDK selection before enabling development.'
        );
    }
    await command('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'], root);
    console.log('Commit the pnpm hook and distribution lockfile.');
    return;
  }
  const distribution = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  if (action === 'status') {
    console.log(JSON.stringify(await inspectSdk(root), null, 2));
    return;
  }
  if (action === 'dev' && (await fs.readFile(bridge, 'utf8').catch(() => null)) !== template)
    throw Error('Initialize the supported local SDK bridge with omnitron sdk init');
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
      try {
        await frozen(root);
        await verifyLinks(root, null);
        await fs.rm(selection, { force: true });
      } catch (error) {
        try {
          if (previous) await installDevelopment(root, previous);
        } catch (rollback) {
          throw new AggregateError([error, rollback], 'Registry switch and recovery failed');
        }
        throw error;
      }
      return;
    }
    const source = await fs.realpath(
      sourceArg ?? previous?.source ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    );
    if (inside(root, source) || inside(source, root)) throw Error('Select separate project and SDK workspaces');
    const desired = await desiredProfile(root, source, distribution);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      if (interrupted || JSON.stringify(previous) !== JSON.stringify(desired)) {
        await requireStopped(root, values.stack);
        await build(source, Object.keys(desired.links), controller.signal);
        try {
          await installDevelopment(root, desired);
          const hashes = {};
          for (const [name, directory] of Object.entries(desired.links)) hashes[name] = await runtimeDigest(directory);
          await atomic(path.join(dir, 'built.json'), JSON.stringify({ source: desired.source, hashes }) + '\n');
          await atomic(selection, JSON.stringify(desired, null, 2) + '\n');
        } catch (error) {
          try {
            if (previous) await installDevelopment(root, previous);
            else await frozen(root);
          } catch (rollback) {
            throw new AggregateError([error, rollback], 'SDK switch and recovery failed');
          }
          throw error;
        }
      } else await verifyLinks(root, desired);
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
