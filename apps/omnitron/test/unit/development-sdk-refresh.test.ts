import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ projects: vi.fn(), stacks: vi.fn(), stack: vi.fn(), status: vi.fn(), watch: vi.fn(), review: vi.fn(), start: vi.fn(),
  automatic: vi.fn(), manual: vi.fn(), disconnect: vi.fn() }));
vi.mock('@omnitron-dev/omnitron/operations', async () => ({
  assertExecutionCapabilities: (await import('../../src/daemon/execution-capabilities.js')).assertExecutionCapabilities,
  LONG_REQUEST_TIMEOUT: 1000,
  createDaemonClient: () => ({ service: async () => ({ listProjects: rpc.projects, listStacks: rpc.stacks,
    getStack: rpc.stack, reviewStackStart: rpc.review, startStack: rpc.start }),
    status: rpc.status, getWatchStatus: rpc.watch, restartAfterChange: rpc.automatic,
    restartApp: rpc.manual, disconnect: rpc.disconnect }),
}));
const { inspectSdk, sdkCommand, watchSdk } = await import('../../bin/sdk.js');
const require = createRequire(import.meta.url);

interface Application {
  name: string;
  handleKey: string;
  status: string;
  generation: string;
  definitionRevision: number;
}

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-refresh-')));
  const previousCache = process.env['OMNITRON_DEV_CACHE'];
  const retained = path.join(root, 'retained'); await fs.mkdir(retained);
  process.env['OMNITRON_DEV_CACHE'] = retained;
  const source = path.join(root, 'sdk'), consumer = path.join(root, 'consumer');
  const pkg = path.join(source, 'packages/probe'), state = path.join(consumer, '.omnitron/dev-sdk');
  for (const directory of [source, consumer]) {
    await fs.mkdir(path.join(directory, 'node_modules/.bin'), { recursive: true });
    await fs.writeFile(path.join(directory, '.gitignore'), 'node_modules/\n.omnitron/\n.turbo/\ndist/\n');
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: path.basename(directory),
      private: true, packageManager: 'pnpm@12.16.1', ...(directory === consumer && { dependencies: { '@omnitron-dev/probe': '1.0.0' } }) }));
    await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    await fs.writeFile(path.join(directory, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/probe: {}\n");
    await fs.writeFile(path.join(directory, 'turbo.json'), JSON.stringify({ tasks: { build: { outputs: ['dist/**'] } } }));
    await fs.symlink(path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo'), path.join(directory, 'node_modules/.bin/turbo'));
  }
  await fs.mkdir(path.join(pkg, 'src'), { recursive: true });
  await fs.mkdir(state, { recursive: true });
  await fs.mkdir(path.join(consumer, 'node_modules/@omnitron-dev'), { recursive: true });
  await fs.symlink(pkg, path.join(consumer, 'node_modules/@omnitron-dev/probe'));
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: '@omnitron-dev/probe', version: '1.0.0', type: 'module', scripts: { build: 'node build.js' } }));
  await fs.writeFile(path.join(pkg, 'build.js'), "import fs from 'node:fs/promises'; await fs.mkdir('dist',{recursive:true}); await fs.copyFile('src/index.js','dist/index.js');\n");
  await fs.writeFile(path.join(pkg, 'src/index.js'), 'export const version = 1;\n');

  const stacks = new Map<string, Application[]>();
  function add(stack = 'dev', name = 'site') {
    const app = { name, handleKey: `project/${stack}/${name}`, status: 'online', generation: randomUUID(), definitionRevision: 0 };
    stacks.set(stack, [...(stacks.get(stack) ?? []), app]);
    return app;
  }
  const app = add();
  const binding = (item: Application) => ({ name: item.handleKey, directory: consumer,
    generation: item.generation, definitionRevision: item.definitionRevision });
  function observations() {
    for (const method of Object.values(rpc)) method.mockReset();
    rpc.projects.mockResolvedValue([{ name: 'project', path: consumer,
      configurations: [{ name: 'default', runtimeProject: 'project', path: consumer, stacks: {} }] }]);
    rpc.stack.mockImplementation(async ({ stack }: { stack: string }) => ({ type: 'local', config: { watch: true },
      runtimeScope: { project: 'project', stack }, apps: structuredClone(stacks.get(stack) ?? []) }));
    rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { applicationRuntimeResolution: 1, sourceRefresh: 1 },
      connection: { status: 'connected' }, ownerRuntime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch } } });
    rpc.watch.mockImplementation(async () => {
      const apps = [...stacks.values()].flat().filter(item => item.status === 'online').map(binding);
      return { enabled: true, watching: apps.length > 0, apps };
    });
    rpc.automatic.mockImplementation(async (request: { name: string; generation: string; definitionRevision: number }) => {
      const item = [...stacks.values()].flat().find(candidate => candidate.handleKey === request.name)!;
      expect(request).toEqual({ name: item.handleKey, generation: item.generation, definitionRevision: item.definitionRevision });
      item.generation = randomUUID();
      item.definitionRevision = 0;
      return { process: { name: item.handleKey, status: 'online', generation: item.generation }, source: binding(item) };
    });
  }
  observations();
  const profile = { schema: 1 as const, root: consumer, source, links: { '@omnitron-dev/probe': pkg } };
  const checkpoint = path.join(state, 'built.json');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const messages = vi.spyOn(console, 'log').mockImplementation(() => {});
  async function run(stack: string | undefined) {
    errors.mockClear(); messages.mockClear(); rpc.automatic.mockClear(); rpc.manual.mockClear();
    const controller = new AbortController();
    let failure: unknown;
    const watching = watchSdk(profile, stack, controller.signal).catch(error => { failure = error; });
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !failure && !errors.mock.calls.length &&
          !messages.mock.calls.some(call => stack
            ? String(call[0]).startsWith(`Development SDK refresh confirmed for project/${stack}:`)
            : /^Development SDK build /.test(String(call[0])))) await delay(25);
      expect(Date.now(), 'SDK must report build/refresh success or its actual failure').toBeLessThan(deadline);
    } finally {
      controller.abort(); await watching;
    }
    expect(failure).toBeUndefined();
    expect(rpc.manual).not.toHaveBeenCalled();
    return { errors: errors.mock.calls.map(call => call.map(String).join(' ')),
      messages: messages.mock.calls.map(call => call.map(String).join(' ')),
      checkpoint: JSON.parse(await fs.readFile(checkpoint, 'utf8').catch(() => 'null')) };
  }
  return { app, add, binding, observations, run, source, consumer, pkg, checkpoint, profile,
    close: async () => {
      errors.mockRestore(); messages.mockRestore();
      if (previousCache === undefined) delete process.env['OMNITRON_DEV_CACHE'];
      else process.env['OMNITRON_DEV_CACHE'] = previousCache;
      await fs.rm(root, { recursive: true, force: true });
    } };
}

async function coldFixture() {
  const f = await fixture();
  const apps = [f.app, f.add('dev', 'worker')];
  const digest = 'a'.repeat(64);
  const target = { project: 'project', stack: 'dev', workingTree: true, infrastructure: 'preserve' };
  const stop = { id: randomUUID(), phase: 'stopped', intentCommitted: true, supersededAt: undefined as string | undefined };
  const state = { name: 'dev', type: 'local', status: 'running', config: { watch: true },
    runtimeScope: { project: 'project', stack: 'dev' }, infrastructureMode: 'preserve', stopOperation: stop, apps };
  const observe = () => structuredClone(state);
  rpc.stack.mockImplementation(async () => observe());
  rpc.stacks.mockImplementation(async () => [observe()]);
  rpc.review.mockResolvedValue({ ...target, protocol: 1, selection: { workingTree: true }, digest });
  const start = () => {
    for (const app of apps) { app.status = 'online'; app.generation = randomUUID(); }
    state.status = 'running'; stop.supersededAt = new Date().toISOString();
    return observe();
  };
  rpc.start.mockImplementation(async () => start());
  const halt = () => {
    for (const app of apps) app.status = 'stopped';
    state.status = 'stopped'; stop.id = randomUUID(); stop.supersededAt = undefined;
  };
  halt();
  await sdkCommand(['init', '--project-dir', f.consumer]);
  const command = () => sdkCommand(['dev', f.source, '--project-dir', f.consumer, '--stack', 'dev',
    '--start-stopped', '--review', digest, '--no-watch']);
  return { ...f, apps, state, stop, target, digest, start, halt, command };
}

it('starts a stopped working tree once, records the acknowledged generations and resumes watching without another refresh', async () => {
  const f = await coldFixture();
  try {
    await f.command();
    expect(rpc.review).toHaveBeenCalledWith(f.target);
    expect(rpc.start).toHaveBeenCalledExactlyOnceWith({ ...f.target, review: f.digest });
    expect(rpc.automatic).not.toHaveBeenCalled();
    const before = await fs.readFile(f.checkpoint, 'utf8');
    expect((await inspectSdk(f.consumer, 'dev')).refresh?.confirmed).toEqual(f.apps.map(app => app.handleKey));
    expect(await fs.readFile(f.checkpoint, 'utf8')).toBe(before);
    expect((await f.run('dev')).errors).toEqual([]);
    expect(rpc.automatic).not.toHaveBeenCalled();
    await expect(f.command()).rejects.toThrow('fully stopped');
    f.halt(); f.app.status = 'online';
    await expect(f.command()).rejects.toThrow('fully stopped');
    expect(rpc.start).toHaveBeenCalledTimes(1);
    f.halt(); await f.command();
    expect(rpc.start).toHaveBeenCalledTimes(2);
    expect(rpc.automatic).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);

it.each(['stale-review', 'late-review', 'lost-reply', 'lost-online-reply', 'changed-output', 'old-generation',
  'changed-generation', 'changed-binding', 'changed-graph'] as const)(
  'refuses SDK application receipts after %s and never restarts to manufacture evidence', async fault => {
    const f = await coldFixture();
    try {
      if (fault === 'stale-review' || fault === 'late-review') {
        const review = { ...f.target, protocol: 1, selection: { workingTree: true }, digest: f.digest };
        rpc.review.mockResolvedValue({ ...review, digest: 'b'.repeat(64) });
        if (fault === 'late-review') rpc.review.mockResolvedValueOnce(review);
      }
      else rpc.start.mockImplementationOnce(async () => {
        const prior = f.app.generation;
        if (fault === 'lost-reply') throw Error('RPC reply lost');
        const result = f.start();
        if (fault === 'lost-online-reply') throw Error('acknowledgement lost');
        if (fault === 'changed-output') await fs.writeFile(path.join(f.pkg, 'dist/index.js'), 'export default 2;');
        if (fault === 'changed-graph') {
          const file = path.join(f.consumer, 'package.json');
          const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
          await fs.writeFile(file, JSON.stringify({ ...manifest, description: 'changed after start' }));
        }
        if (fault === 'old-generation') result.apps[0]!.generation = prior;
        if (fault === 'changed-generation') f.app.generation = randomUUID();
        if (fault === 'changed-binding') {
          const readWatch = rpc.watch.getMockImplementation()!;
          let calls = 0;
          rpc.watch.mockImplementation(async () => {
            if (++calls === 5) f.app.definitionRevision++;
            return readWatch();
          });
        }
        return result;
      });
      const reason = {
        'stale-review': /reviewed working-tree launch.*changed/, 'late-review': /reviewed working-tree launch.*changed/,
        'lost-reply': /Current stack: stopped.*RPC reply lost/, 'lost-online-reply': /Current stack: running.*acknowledgement lost/,
        'changed-output': /SDK output changed/, 'old-generation': /generation/, 'changed-generation': /generation/,
        'changed-binding': /Source binding changed/, 'changed-graph': /package graph changed/,
      };
      await expect(f.command()).rejects.toThrow(reason[fault]);
      expect(rpc.automatic).not.toHaveBeenCalled(); expect(rpc.manual).not.toHaveBeenCalled();
      if (fault === 'stale-review' || fault === 'late-review') {
        expect(rpc.start).not.toHaveBeenCalled();
        if (fault === 'stale-review') expect(await fs.stat(path.join(path.dirname(f.checkpoint), 'active.json')).catch(() => null)).toBeNull();
      } else {
        if (fault === 'lost-reply') {
          // The owner still observes a stopped stack: selection recovery
          // restores the original absence of a build, retaining launch intent.
          expect(await fs.stat(f.checkpoint).catch(() => null)).toBeNull();
          await expect(f.command()).rejects.toThrow('already had a start request');
        } else {
          expect(JSON.parse(await fs.readFile(f.checkpoint, 'utf8')).applications['project/dev'] ?? {}).toEqual({});
        }
        if (fault === 'lost-online-reply') {
          await expect(f.command()).rejects.toThrow('SDK transition is unfinished');
          await expect(sdkCommand(['recover', '--project-dir', f.consumer, '--stack', 'dev']))
            .rejects.toThrow('before switching its working-tree dependencies');
        }
        expect(rpc.start).toHaveBeenCalledTimes(1);
      }
    } finally { await f.close(); }
  }, 120_000);

it('records completed builds without inventing application receipts after a refused refresh', async () => {
  const f = await fixture();
  try {
    for (const fault of ['disabled', 'missing', 'retarget', 'owner-refusal', 'unconfirmed', 'invalid-receipt', 'starting', 'starting-sibling', 'missing-handle']) {
      f.observations();
      f.app.status = fault === 'starting' ? 'starting' : 'online';
      f.app.handleKey = fault === 'missing-handle' ? '' : 'project/dev/site';
      if (fault === 'starting-sibling') f.add('dev', 'waiting').status = 'starting';
      await fs.rm(f.checkpoint, { force: true });
      if (fault === 'disabled') rpc.watch.mockResolvedValue({ enabled: false, watching: false, reason: 'watching is disabled', apps: [] });
      if (fault === 'missing') rpc.watch.mockResolvedValue({ enabled: true, watching: true, apps: [] });
      if (fault === 'retarget') rpc.watch.mockResolvedValueOnce({ enabled: true, watching: true, apps: [f.binding(f.app)] })
        .mockResolvedValue({ enabled: true, watching: true, apps: [{ ...f.binding(f.app), definitionRevision: 1 }] });
      if (fault === 'owner-refusal') rpc.automatic.mockRejectedValue(new Error('Source binding changed in the owner queue'));
      if (fault === 'unconfirmed' || fault === 'invalid-receipt') rpc.automatic.mockResolvedValue({
        process: { name: f.app.handleKey, status: 'online', generation: fault === 'unconfirmed' ? f.app.generation : 'new' },
        source: { ...f.binding(f.app), generation: fault === 'unconfirmed' ? f.app.generation : 'new',
          ...(fault === 'invalid-receipt' && { definitionRevision: -1 }) },
      });
      const result = await f.run('dev');
      expect(result.errors, fault).toHaveLength(1);
      if (fault.startsWith('starting')) expect(result.errors[0]).toContain('application is starting');
      if (fault === 'missing-handle') expect(result.errors[0]).toContain('application has no owned handle');
      expect(result.messages.some(message => message.includes('refresh confirmed')), fault).toBe(false);
      expect(result.checkpoint.hashes['@omnitron-dev/probe'], fault).toMatch(/^[a-f0-9]{64}$/);
      expect(result.checkpoint.applications['project/dev'] ?? {}, fault).toEqual({});
      if (['owner-refusal', 'unconfirmed', 'invalid-receipt'].includes(fault)) expect(rpc.automatic, fault).toHaveBeenCalledTimes(1);
      else expect(rpc.automatic, fault).not.toHaveBeenCalled();
    }
  } finally { await f.close(); }
}, 120_000);

it('refreshes the watched backend alongside a self-watching portal, and rejects a revoked exemption', async () => {
  const f = await fixture();
  try {
    const portal = f.add('dev', 'portal');
    const config = path.join(f.consumer, 'omnitron.config.js');
    const declare = (watch: boolean) => fs.writeFile(config, `module.exports = { apps: [
      { name: 'site', script: './server.js' }, { name: 'portal', script: './portal.js', watch: ${watch} }
    ] };`);
    await declare(false);
    rpc.watch.mockImplementation(async () => ({ enabled: true, watching: true, apps: [f.binding(f.app)] }));
    const first = await f.run('dev');
    expect(first.errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
    expect(first.checkpoint.applications['project/dev'][portal.handleKey]).toBeUndefined();
    expect(first.messages).toContain('Development SDK refresh confirmed for project/dev: 1 applications, 0 inactive, 1 opted out of owner refresh');
    for (const name of ['active.json', 'install.json'])
      await fs.writeFile(path.join(path.dirname(f.checkpoint), name), JSON.stringify(f.profile));
    const saved = await fs.readFile(f.checkpoint, 'utf8');
    rpc.automatic.mockClear();
    expect((await inspectSdk(f.consumer, 'dev')).refresh).toEqual({
      stack: 'project/dev', confirmed: [f.app.handleKey], inactive: [], unaffected: [], optedOut: [portal.handleKey],
    });
    f.app.generation = randomUUID();
    await expect(inspectSdk(f.consumer, 'dev')).rejects.toThrow('No current SDK refresh receipt');
    expect(rpc.automatic).not.toHaveBeenCalled();
    expect(await fs.readFile(f.checkpoint, 'utf8')).toBe(saved);
    f.app.status = 'stopped';
    rpc.watch.mockResolvedValue({ enabled: true, watching: false, apps: [] });
    const external = await f.run('dev');
    expect(external.errors).toEqual([]);
    expect(rpc.automatic).not.toHaveBeenCalled();
    rpc.watch.mockResolvedValueOnce({ enabled: true, watching: false, apps: [] }).mockImplementation(async () => {
      await declare(true);
      return { enabled: true, watching: false, apps: [] };
    });
    const changed = await f.run('dev');
    expect(changed.errors[0]).toContain('Watch policy or generation changed while confirming');
    expect(changed.messages.some(message => message.includes('refresh confirmed'))).toBe(false);
    expect((await f.run('dev')).errors[0]).toContain('has no active watcher');
  } finally { await f.close(); }
}, 120_000);

it('reconciles build-only output and then reuses only the exact application binding', async () => {
  const f = await fixture();
  try {
    const built = await f.run(undefined);
    expect(built.errors).toEqual([]);
    expect(built.checkpoint.applications).toEqual({});
    expect(rpc.automatic).not.toHaveBeenCalled();
    const applied = await f.run('dev');
    expect(applied.errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
    expect(applied.checkpoint.applications['project/dev'][f.app.handleKey]).toMatchObject({
      generation: f.app.generation, definitionRevision: f.app.definitionRevision, directory: f.consumer,
    });
    const repeated = await f.run('dev');
    expect(repeated.errors).toEqual([]);
    expect(repeated.checkpoint).toEqual(applied.checkpoint);
    expect(rpc.automatic).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);

it('does not use one stack receipt to certify another stack sharing the same built SDK', async () => {
  const f = await fixture();
  try {
    const second = f.add('second');
    expect((await f.run('dev')).errors).toEqual([]);
    const initial = second.generation;
    const result = await f.run('second');
    expect(result.errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledExactlyOnceWith({ name: second.handleKey, generation: initial, definitionRevision: 0 });
    expect(Object.keys(result.checkpoint.applications).sort()).toEqual(['project/dev', 'project/second']);
  } finally { await f.close(); }
}, 120_000);

it('refreshes local tools whose selected SDK is declared as a development dependency', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.consumer, 'package.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.devDependencies = manifest.dependencies;
    delete manifest.dependencies;
    await fs.writeFile(file, JSON.stringify(manifest));
    const result = await f.run('dev');
    expect(result.errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
    expect(result.checkpoint.applications['project/dev'][f.app.handleKey].generation).toBe(f.app.generation);
  } finally { await f.close(); }
}, 120_000);

it('preserves the exact nonzero definition revision returned by the owner', async () => {
  const f = await fixture();
  try {
    const original = rpc.automatic.getMockImplementation()!;
    rpc.automatic.mockImplementationOnce(async request => {
      const receipt = await original(request);
      f.app.definitionRevision = 7;
      return { ...receipt, source: f.binding(f.app) };
    });
    const applied = await f.run('dev');
    expect(applied.errors).toEqual([]);
    expect(applied.checkpoint.applications['project/dev'][f.app.handleKey].definitionRevision).toBe(7);
    const repeated = await f.run('dev');
    expect(repeated.errors).toEqual([]);
    expect(repeated.checkpoint).toEqual(applied.checkpoint);
    expect(rpc.automatic).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);

it('reconciles changed generations and redefinitions even when output hashes are unchanged', async () => {
  const f = await fixture();
  try {
    expect((await f.run('dev')).errors).toEqual([]);
    for (const change of ['generation', 'definition']) {
      if (change === 'generation') f.app.generation = randomUUID();
      else f.app.definitionRevision++;
      const expected = { name: f.app.handleKey, generation: f.app.generation, definitionRevision: f.app.definitionRevision };
      expect((await f.run('dev')).errors).toEqual([]);
      expect(rpc.automatic).toHaveBeenCalledExactlyOnceWith(expected);
    }
  } finally { await f.close(); }
}, 120_000);

it('removes a stopped application receipt and reconciles its next online generation', async () => {
  const f = await fixture();
  try {
    expect((await f.run('dev')).errors).toEqual([]);
    f.app.status = 'stopped';
    const stopped = await f.run('dev');
    expect(stopped.errors).toEqual([]);
    expect(stopped.checkpoint.applications['project/dev']).toEqual({});
    expect(stopped.messages.some(message => message.includes('Inactive project/dev/site'))).toBe(true);
    expect(rpc.automatic).not.toHaveBeenCalled();
    f.app.status = 'online'; f.app.generation = randomUUID();
    expect((await f.run('dev')).errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
}, 120_000);

it('preserves acknowledged applications on partial failure and retries only the unapplied binding', async () => {
  const f = await fixture();
  try {
    const second = f.add('dev', 'second');
    const original = rpc.automatic.getMockImplementation()!;
    rpc.automatic.mockImplementation(async request => {
      if (request.name === second.handleKey) throw new Error('Second application refused refresh');
      return original(request);
    });
    const partial = await f.run('dev');
    expect(partial.errors).toHaveLength(1);
    expect(partial.messages.some(message => message.includes('refresh confirmed'))).toBe(false);
    expect(Object.keys(partial.checkpoint.applications['project/dev'])).toEqual([f.app.handleKey]);
    const firstGeneration = f.app.generation;
    f.observations();
    const expected = { name: second.handleKey, generation: second.generation, definitionRevision: second.definitionRevision };
    const complete = await f.run('dev');
    expect(complete.errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledExactlyOnceWith(expected);
    expect(f.app.generation).toBe(firstGeneration);
    expect(Object.keys(complete.checkpoint.applications['project/dev']).sort()).toEqual([second.handleKey, f.app.handleKey].sort());
  } finally { await f.close(); }
}, 120_000);

it('requires a fresh application acknowledgement for a legacy build checkpoint', async () => {
  const f = await fixture();
  try {
    const prior = (await f.run('dev')).checkpoint;
    await fs.writeFile(f.checkpoint, JSON.stringify({ source: prior.source, hashes: prior.hashes, applications: prior.applications }));
    expect((await f.run('dev')).errors).toEqual([]);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
}, 120_000);

it('refuses unchanged application receipts when SDK source changes during read-only status', async () => {
  const f = await fixture();
  try {
    expect((await f.run('dev')).errors).toEqual([]);
    for (const name of ['active.json', 'install.json'])
      await fs.writeFile(path.join(path.dirname(f.checkpoint), name), JSON.stringify(f.profile));
    const checkpoint = await fs.readFile(f.checkpoint, 'utf8');
    const output = await fs.readFile(path.join(f.pkg, 'dist/index.js'), 'utf8');
    rpc.automatic.mockClear();
    const originalWatch = rpc.watch.getMockImplementation()!;
    rpc.watch.mockImplementationOnce(async () => {
      await fs.writeFile(path.join(f.pkg, 'src/index.js'), 'export const version = 2;\n');
      return originalWatch();
    });
    await expect(inspectSdk(f.consumer, 'dev')).rejects.toThrow('SDK build inputs changed');
    expect(rpc.automatic).not.toHaveBeenCalled();
    expect(await fs.readFile(f.checkpoint, 'utf8')).toBe(checkpoint);
    expect(await fs.readFile(path.join(f.pkg, 'dist/index.js'), 'utf8')).toBe(output);
    rpc.watch.mockClear();
    await expect(inspectSdk(f.consumer, 'dev')).rejects.toThrow('SDK build inputs changed');
    expect(rpc.watch).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);

it('does not certify or refresh a build whose inputs changed while it was running', async () => {
  const f = await fixture();
  try {
    expect((await f.run('dev')).errors).toEqual([]);
    const checkpoint = await fs.readFile(f.checkpoint, 'utf8');
    // A real build consumes version 1 and then changes its input to version 2.
    // The completed output cannot certify either the edited source or apps.
    await fs.writeFile(path.join(f.pkg, 'build.js'), `import fs from 'node:fs/promises';
await fs.copyFile('src/index.js', 'dist/index.js');
await fs.writeFile('src/index.js', 'export const version = 2;\\n');\n`);
    const result = await f.run('dev');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('SDK build inputs changed');
    expect(rpc.automatic).not.toHaveBeenCalled();
    expect(await fs.readFile(f.checkpoint, 'utf8')).toBe(checkpoint);
    expect(await fs.readFile(path.join(f.pkg, 'dist/index.js'), 'utf8')).toBe('export const version = 1;\n');
  } finally { await f.close(); }
}, 120_000);

it.each(['generation', 'status'] as const)('refuses final success if the first application changes %s while the second refreshes', async change => {
  const f = await fixture();
  try {
    const second = f.add('dev', 'second');
    const original = rpc.automatic.getMockImplementation()!;
    rpc.automatic.mockImplementation(async request => {
      const receipt = await original(request);
      if (request.name === second.handleKey) {
        if (change === 'generation') f.app.generation = randomUUID();
        else f.app.status = 'stopped';
      }
      return receipt;
    });
    const refused = await f.run('dev');
    expect(refused.errors).toHaveLength(1);
    expect(refused.errors[0]).toContain('changed while confirming');
    expect(refused.messages.some(message => message.includes('refresh confirmed'))).toBe(false);
    expect(Object.keys(refused.checkpoint.applications['project/dev']).sort()).toEqual([f.app.handleKey, second.handleKey].sort());
    f.observations();
    const retried = await f.run('dev');
    expect(retried.errors).toEqual([]);
    if (change === 'generation') {
      expect(rpc.automatic).toHaveBeenCalledTimes(1);
      expect(rpc.automatic.mock.calls[0]?.[0].name).toBe(f.app.handleKey);
    } else {
      expect(rpc.automatic).not.toHaveBeenCalled();
      expect(retried.checkpoint.applications['project/dev'][f.app.handleKey]).toBeUndefined();
    }
  } finally { await f.close(); }
}, 120_000);

it('rejects output rebuilt by another consumer during refresh, then confirms a normal rebuild and retry', async () => {
  const f = await fixture();
  let otherController: AbortController | undefined, otherWatching: Promise<void> | undefined;
  try {
    const original = rpc.automatic.getMockImplementation()!;
    rpc.automatic.mockImplementationOnce(async request => {
      const receipt = await original(request);
      const other = path.join(path.dirname(f.consumer), 'second-consumer');
      await fs.cp(f.consumer, other, { recursive: true, verbatimSymlinks: true });
      const otherCheckpoint = path.join(other, '.omnitron/dev-sdk/built.json');
      const before = JSON.parse(await fs.readFile(otherCheckpoint, 'utf8')).hashes['@omnitron-dev/probe'];
      await fs.writeFile(path.join(f.pkg, 'src/index.js'), 'export const version = 2;\n');
      otherController = new AbortController();
      otherWatching = watchSdk({ schema: 1, root: other, source: f.source,
        links: { '@omnitron-dev/probe': f.pkg } }, undefined, otherController.signal);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && JSON.parse(await fs.readFile(otherCheckpoint, 'utf8')).hashes['@omnitron-dev/probe'] === before) await delay(25);
      otherController.abort(); await otherWatching; otherWatching = undefined;
      expect(Date.now()).toBeLessThan(deadline);
      expect(await fs.readFile(path.join(f.pkg, 'dist/index.js'), 'utf8')).toBe('export const version = 2;\n');
      return receipt;
    });
    const refused = await f.run('dev');
    expect(refused.errors).toHaveLength(1);
    expect(refused.errors[0]).toContain('SDK output changed while confirming');
    expect(refused.checkpoint.applications['project/dev']).toEqual({});
    expect(refused.messages.some(message => message.includes('refresh confirmed'))).toBe(false);
    f.observations();
    const retried = await f.run('dev');
    expect(retried.errors).toEqual([]);
    expect(retried.checkpoint.hashes['@omnitron-dev/probe']).not.toBe(refused.checkpoint.hashes['@omnitron-dev/probe']);
    expect(retried.checkpoint.applications['project/dev'][f.app.handleKey].generation).toBe(f.app.generation);
    expect(rpc.automatic).toHaveBeenCalledTimes(1);
  } finally {
    otherController?.abort(); await otherWatching;
    await f.close();
  }
}, 120_000);

it('leaves both the build and application receipts unchanged when the SDK build fails', async () => {
  const f = await fixture();
  try {
    expect((await f.run('dev')).errors).toEqual([]);
    const before = await fs.readFile(f.checkpoint, 'utf8');
    await fs.writeFile(path.join(f.pkg, 'build.js'), "throw new Error('Fixture compilation failed');\n");
    const result = await f.run('dev');
    expect(result.errors).toHaveLength(1);
    expect(await fs.readFile(f.checkpoint, 'utf8')).toBe(before);
    expect(rpc.automatic).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);

it('refuses a build output symlink rather than certifying unhashed bytes outside the SDK', async () => {
  const f = await fixture();
  try {
    const external = path.join(path.dirname(f.source), 'outside-sdk.js');
    await fs.writeFile(external, 'export const hidden = true;\n');
    await fs.appendFile(path.join(f.pkg, 'build.js'), `await fs.symlink(${JSON.stringify(external)}, 'dist/external.js');\n`);
    const result = await f.run('dev');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unsupported SDK build output entry');
    expect(result.errors[0]).toContain(path.join(f.pkg, 'dist/external.js'));
    expect(result.checkpoint).toBeNull();
    expect(rpc.automatic).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 120_000);
