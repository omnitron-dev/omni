import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareSdkTransition, readPreparedSdkTransition, beginSdkTransition, finishSdkTransition, recoverSdkTransition, sdkTransitionStatus,
  saveSdkBuildCheckpoint, sdkAdoptionTransition, supersedeSdkTransition } from '../../bin/sdk-transition.js';
import { sdkCommand, inspectSdk } from '../../bin/sdk.js';
import { prepareSdkState, exclusively } from '../../bin/sdk-operation.js';

const rpc = vi.hoisted(() => ({ projects: vi.fn(), stacks: vi.fn(), status: vi.fn(), disconnect: vi.fn(), mutable: vi.fn() }));
vi.mock('@omnitron-dev/omnitron/operations', async () => ({
  assertExecutionCapabilities: (await import('../../src/daemon/execution-capabilities.js')).assertExecutionCapabilities,
  LONG_REQUEST_TIMEOUT: 1000,
  createDaemonClient: () => ({ service: async () => ({ listProjects: rpc.projects, listStacks: rpc.stacks, assertSdkMutable: rpc.mutable }),
    status: rpc.status, disconnect: rpc.disconnect }),
}));

// Only synthetic bytes/directories on TMPDIR. No daemon, package manager,
// build, live package outputs or public registry is used by this file.
let temporary: string, root: string, source: string, cache: string, state: string, output: string, modules: string;
const json = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const present = (file: string) => fs.lstat(file).then(() => true, error => {
  if (error.code === 'ENOENT') return false; throw error;
});
beforeEach(async () => {
  vi.clearAllMocks();
  temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-transition-')));
  root = path.join(temporary, 'consumer'); source = path.join(temporary, 'source'); cache = path.join(temporary, 'retained');
  state = path.join(root, '.omnitron/dev-sdk'); output = path.join(source, 'dist'); modules = path.join(state, 'node_modules');
  for (const directory of [state, output, modules, cache]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(source, 'package.json'), '{"version":"0.4.9"}');
  await fs.writeFile(path.join(output, 'index.js'), 'old executable bytes');
  await fs.writeFile(path.join(output, 'tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.mkdir(path.join(modules, '.bin'));
  await fs.writeFile(path.join(modules, 'native.node'), 'old native bytes');
  await fs.symlink('../../../../source/dist/tool', path.join(modules, '.bin/tool'));
  const profile = { schema: 1, root, source, links: {} };
  for (const name of ['active.json', 'install.json']) await fs.writeFile(path.join(state, name), JSON.stringify(profile));
  await fs.writeFile(path.join(state, 'built.json'), JSON.stringify({ schema: 2, source, hashes: {}, applications: {} }));
  vi.stubEnv('OMNITRON_DEV_CACHE', cache); vi.stubEnv('OMNITRON_HOME', path.join(temporary, 'no-owner')); vi.stubEnv('OMNITRON_SOCKET', undefined);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); });
const inventory = () => ({ root, source,
  paths: [output, modules, path.join(root, 'pnpm-lock.yaml'), ...['built.json', 'install.json', 'active.json'].map(name => path.join(state, name))],
  guards: [path.join(source, 'package.json')] });
const prepare = () => prepareSdkTransition(inventory());
const inputs = () => ({ ...inventory(), detached: true, intent: 'fixture selection and revisions' });
async function stage() {
  const { journal } = await prepareSdkTransition(inputs());
  return { token: journal.id + '.' + journal.proof, snapshot: journal.snapshot };
}
async function mutate() {
  await fs.writeFile(path.join(output, 'index.js'), 'partially rebuilt');
  await fs.chmod(path.join(output, 'tool'), 0o600);
  await fs.writeFile(path.join(output, 'new-file'), 'new');
  await fs.writeFile(path.join(modules, 'native.node'), 'different ABI');
  await fs.unlink(path.join(modules, '.bin/tool')); await fs.symlink('/wrong-binding', path.join(modules, '.bin/tool'));
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'new lock');
  await fs.writeFile(path.join(state, 'built.json'), '{"schema":3}');
  await fs.writeFile(path.join(state, 'install.json'), '{"installing":true}');
}

it('uses a detached image once and restores its exact bytes through public recover', async () => {
  const { token, snapshot } = await stage();
  expect(await sdkTransitionStatus(root)).toBeNull();
  const selection = await readPreparedSdkTransition(inputs(), token);
  await beginSdkTransition(selection); await mutate(); await finishSdkTransition(selection, true);
  await sdkCommand(['recover', '--project-dir', root]);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('old executable bytes');
  expect(await fs.readlink(path.join(modules, '.bin/tool'))).toBe('../../../../source/dist/tool');
  expect(await present(path.join(root, 'pnpm-lock.yaml'))).toBe(false);
  expect(await present(path.join(snapshot, 'claimed'))).toBe(true);
  await expect(readPreparedSdkTransition(inputs(), token)).rejects.toThrow('already been used');
});

it.each(['.gitignore', 'operation.sqlite', 'operation.sqlite-journal'])('preserves a foreign target of linked coordination metadata: %s', async file => {
  const foreign = path.join(output, 'index.js');
  await fs.symlink(foreign, path.join(state, file));
  const admitted = vi.fn();
  await expect((async () => exclusively(await prepareSdkState(root), admitted))()).rejects.toThrow('workspace-owned file');
  expect(admitted).not.toHaveBeenCalled();
  expect(await fs.readFile(foreign, 'utf8')).toBe('old executable bytes');
});

it.each(['guard', 'live bytes', 'retained bytes', 'lost retained file', 'new output', 'removed guard', 'source identity',
  'consumer identity', 'profile', 'predecessor', 'token'])('refuses detached preparation drift before taking ownership: %s', async drift => {
  const prior = await prepare(); await beginSdkTransition(prior); await finishSdkTransition(prior, true);
  const staged = await stage(), input = inputs();
  let token = staged.token;
  if (drift === 'guard') await fs.appendFile(input.guards[0]!, 'changed');
  if (drift === 'live bytes') await fs.appendFile(path.join(output, 'index.js'), 'changed');
  if (drift === 'retained bytes') await fs.appendFile(path.join(staged.snapshot, '0/index.js'), 'changed');
  if (drift === 'lost retained file') await fs.unlink(path.join(staged.snapshot, '0/index.js'));
  if (drift === 'new output') input.paths.push(path.join(root, 'generated'));
  if (drift === 'removed guard') input.guards.pop();
  if (drift === 'profile') input.intent += 'changed';
  if (drift === 'token') token = token.slice(0, 37) + '0'.repeat(64);
  if (drift === 'predecessor') await recoverSdkTransition(root);
  if (drift === 'source identity' || drift === 'consumer identity') {
    const directory = drift === 'source identity' ? source : root;
    await fs.rename(directory, directory + '-old');
    await fs.cp(directory + '-old', directory, { recursive: true, verbatimSymlinks: true });
  }
  const current = await fs.readFile(path.join(state, 'transition.json'));
  await expect((async () => beginSdkTransition(await readPreparedSdkTransition(input, token)))()).rejects.toThrow();
  expect(await fs.readFile(path.join(state, 'transition.json'))).toEqual(current);
  expect(await present(path.join(staged.snapshot, 'claimed'))).toBe(false);
});

it.each(['admission', 'fence', 'mutating publication'])('cancellation at %s preserves the predecessor and the unspent image', async point => {
  const prior = await prepare(); await beginSdkTransition(prior); await finishSdkTransition(prior, true);
  const previous = await fs.readFile(path.join(state, 'transition.json')), { token, snapshot } = await stage();
  const selection = await readPreparedSdkTransition(inputs(), token), controller = new AbortController();
  const marker = path.join(state, 'fixture-fence');
  const rename = fs.rename;
  vi.spyOn(fs, 'rename').mockImplementation(async (a, b) => {
    await rename(a, b);
    if (point === 'mutating publication' && b === path.join(state, 'transition.json') && (await json(String(b))).phase === 'mutating')
      controller.abort();
  });
  const admit = async () => { if (point === 'admission') controller.abort(); };
  const fence = async () => { await fs.writeFile(marker, 'held'); if (point === 'fence') controller.abort(); };
  await expect(beginSdkTransition(selection, { signal: controller.signal, admit, fence,
    unfence: () => fs.unlink(marker) })).rejects.toThrow(/abort/i);
  expect(await fs.readFile(path.join(state, 'transition.json'))).toEqual(previous);
  expect(await present(marker)).toBe(false);
  expect(await present(path.join(snapshot, 'claimed'))).toBe(false);
  await beginSdkTransition(await readPreparedSdkTransition(inputs(), token));
  await finishSdkTransition(selection, true);
});

it('compares stopped-stage copies and full payload reads on the same one-MiB fixture', async () => {
  const payload = path.join(output, 'payload');
  await fs.writeFile(payload, Buffer.alloc(1024 * 1024, 0x47));
  const open = vi.spyOn(fs, 'open'), cp = vi.spyOn(fs, 'cp');
  const counts = () => ({ copies: cp.mock.calls.length, liveReads: open.mock.calls.filter(([file]) => file === payload).length,
    retainedReads: open.mock.calls.filter(([file]) => String(file).startsWith(cache + path.sep) && path.basename(String(file)) === 'payload').length });
  const coldStart = performance.now();
  const cold = await prepareSdkTransition(inputs()); await beginSdkTransition(cold);
  const coldMs = Math.round(performance.now() - coldStart), coldCounts = counts();
  await finishSdkTransition(cold, true);
  const { token } = await stage();
  open.mockClear(); cp.mockClear();
  const warmStart = performance.now();
  await beginSdkTransition(await readPreparedSdkTransition(inputs(), token));
  const warmMs = Math.round(performance.now() - warmStart), warmCounts = counts();
  expect(coldCounts.copies).toBeGreaterThan(0);
  expect(coldCounts).toMatchObject({ liveReads: 3, retainedReads: 1 });
  expect(warmCounts).toEqual({ copies: 0, liveReads: 1, retainedReads: 1 });
  console.log(JSON.stringify({ fixtureBytes: 1024 * 1024, cold: { ...coldCounts, ms: coldMs }, prepared: { ...warmCounts, ms: warmMs } }));
});

it.each([false, true])('public recover restores exact outputs, native dependencies, links, modes and absent files: committed=%s', async committed => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, committed);
  await sdkCommand(['recover', '--project-dir', root]);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('old executable bytes');
  expect((await fs.stat(path.join(output, 'tool'))).mode & 0o777).toBe(0o755);
  expect(await present(path.join(output, 'new-file'))).toBe(false);
  expect(await fs.readFile(path.join(modules, 'native.node'), 'utf8')).toBe('old native bytes');
  expect(await fs.readlink(path.join(modules, '.bin/tool'))).toBe('../../../../source/dist/tool');
  expect(await present(path.join(root, 'pnpm-lock.yaml'))).toBe(false);
  expect(await json(path.join(state, 'built.json'))).toMatchObject({ schema: 2 });
  expect(await json(path.join(state, 'active.json'))).toEqual(await json(path.join(state, 'install.json')));
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'restored' });
  await sdkCommand(['recover', '--project-dir', root]);
});

it('refuses an unacknowledged interrupted writer and never declares readiness', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate();
  await expect(sdkCommand(['recover', '--project-dir', root])).rejects.toThrow('cannot overwrite unproven changes');
  await expect(inspectSdk(root)).rejects.toThrow('readiness is unconfirmed');
  await expect(prepare()).rejects.toThrow('unfinished');
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
});

async function adoption() {
  const observed = await sdkAdoptionTransition(root);
  const evidence = { protocol: 1, root, source, stack: 'dev', transition: observed.transition,
    startAttemptsSha256: observed.startAttemptsSha256 };
  return { evidence, review: createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
}

it('supersedes current files without restoring a changed old guard or rewriting the original uncertain history', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const original = await fs.readFile(path.join(state, 'transition.json'), 'utf8');
  const proof = await fs.readFile(path.join(transition.journal.snapshot, 'proof.json'), 'utf8');
  const attempts = '{ "project/dev": "legacy-stop-id" }\n';
  await fs.writeFile(path.join(state, 'start-attempts.json'), attempts, { mode: 0o600 });
  await fs.writeFile(path.join(source, 'package.json'), '{"version":"later-current-dependencies"}');
  await expect(recoverSdkTransition(root)).rejects.toThrow('inputs changed outside');
  const plan = await adoption(), revalidate = vi.fn(async () => {});
  const accepted = await supersedeSdkTransition(root, plan.evidence, plan.review, revalidate);
  expect(revalidate).toHaveBeenCalledOnce();
  expect(await json(accepted.history)).toEqual({ schema: 1, journal: original, attempts });
  expect(await fs.readFile(path.join(transition.journal.snapshot, 'proof.json'), 'utf8')).toBe(proof);
  expect(await fs.readFile(path.join(state, 'start-attempts.json'), 'utf8')).toBe(attempts);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
  expect(await fs.readFile(path.join(source, 'package.json'), 'utf8')).toBe('{"version":"later-current-dependencies"}');
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'superseded', adoption: { review: plan.review, launch: 'unconfirmed' } });
  await expect(recoverSdkTransition(root)).rejects.toThrow('superseded without restoration');
  expect(await supersedeSdkTransition(root, plan.evidence, plan.review, revalidate)).toEqual(accepted);
  const next = await prepare();
  expect(next.journal.id).not.toBe(transition.journal.id);
  expect(await fs.readFile(path.join(next.journal.snapshot, '0/index.js'), 'utf8')).toBe('partially rebuilt');
  expect(await json(accepted.history)).toEqual({ schema: 1, journal: original, attempts });
});

it('refuses adoption while an interrupted writer or restoration is unresolved', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate();
  await expect(sdkAdoptionTransition(root)).rejects.toThrow('interrupted writer or restoration');
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'mutating' });
});

it('preserves current files and the old receipt if admission changes after its history was retained', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const original = await fs.readFile(path.join(state, 'transition.json'), 'utf8'), plan = await adoption();
  await expect(supersedeSdkTransition(root, plan.evidence, plan.review, async () => { throw Error('current graph changed'); }))
    .rejects.toThrow('current graph changed');
  expect(await fs.readFile(path.join(state, 'transition.json'), 'utf8')).toBe(original);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
  await fs.writeFile(path.join(state, 'start-attempts.json'), '{"project/dev":"another-stop"}\n', { mode: 0o600 });
  const changed = await adoption();
  expect(changed.review).not.toBe(plan.review);
  await supersedeSdkTransition(root, changed.evidence, changed.review, async () => {});
  expect(await fs.readdir(path.join(state, 'history'))).toHaveLength(2);
});

it('recovers an acknowledgement lost after the atomic admission write without restoring or replaying a start', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const plan = await adoption(), rename = fs.rename;
  const injected = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (String(to) === path.join(state, 'transition.json')) throw Error('lost admission acknowledgement');
  });
  await expect(supersedeSdkTransition(root, plan.evidence, plan.review, async () => {})).rejects.toThrow('lost admission');
  injected.mockRestore();
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'superseded' });
  await supersedeSdkTransition(root, plan.evidence, plan.review, async () => {});
  expect(await fs.readdir(path.join(state, 'history'))).toHaveLength(1);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
});

it.each(['bytes', 'permissions'])('rejects changed archived history %s without weakening recovery guards', async change => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const plan = await adoption();
  const accepted = await supersedeSdkTransition(root, plan.evidence, plan.review, async () => {});
  if (change === 'bytes') await fs.appendFile(accepted.history, ' ');
  else await fs.chmod(path.dirname(accepted.history), 0o777);
  await expect(sdkTransitionStatus(root)).rejects.toThrow(/history changed|protected path/);
  await expect(prepare()).rejects.toThrow(/history changed|protected path/);
});

it('retains workspace identity and refuses adoption of a replaced source', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await finishSdkTransition(transition, false);
  await fs.rename(source, source + '-prior'); await fs.mkdir(source);
  await expect(sdkAdoptionTransition(root)).rejects.toThrow('workspace directory was replaced');
});

it('does not leave a partial history record after a failed archive publication', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await finishSdkTransition(transition, false);
  const original = await fs.readFile(path.join(state, 'transition.json'), 'utf8'), plan = await adoption();
  const injected = vi.spyOn(fs, 'link').mockRejectedValueOnce(Error('archive publication failed'));
  await expect(supersedeSdkTransition(root, plan.evidence, plan.review, async () => {})).rejects.toThrow('archive publication');
  injected.mockRestore();
  expect(await fs.readdir(path.join(state, 'history'))).toEqual([]);
  expect(await fs.readFile(path.join(state, 'transition.json'), 'utf8')).toBe(original);
  await supersedeSdkTransition(root, plan.evidence, plan.review, async () => {});
});

it('retains recovery of SDK-owned application receipts without adopting foreign output bytes', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, true);
  const before = await json(path.join(state, 'transition.json'));
  await fs.writeFile(path.join(output, 'index.js'), 'foreign output');
  await saveSdkBuildCheckpoint(root, { schema: 3, applications: { observed: true } });
  const after = await json(path.join(state, 'transition.json'));
  const changed = after.owned.flatMap((entry: unknown, index: number) =>
    JSON.stringify(entry) === JSON.stringify(before.owned[index]) ? [] : [transition.proof.entries[index]!.path]);
  expect(changed).toEqual([path.join(state, 'built.json')]);
  await expect(recoverSdkTransition(root)).rejects.toThrow('preserved files changed outside');
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('foreign output');
});

it('preserves a foreign checkpoint instead of blessing it as owned metadata', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, true);
  const before = await fs.readFile(path.join(state, 'transition.json'), 'utf8');
  await fs.writeFile(path.join(state, 'built.json'), '{"foreign":true}');
  await expect(saveSdkBuildCheckpoint(root, { schema: 3 })).rejects.toThrow('changed outside its committed selection');
  expect(await fs.readFile(path.join(state, 'transition.json'), 'utf8')).toBe(before);
  expect(await fs.readFile(path.join(state, 'built.json'), 'utf8')).toBe('{"foreign":true}');
});

it('does not report successful recovery again after restored bytes change', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  await recoverSdkTransition(root);
  await fs.writeFile(path.join(output, 'index.js'), 'later foreign edit');
  await expect(sdkCommand(['recover', '--project-dir', root])).rejects.toThrow('Previously restored SDK files changed');
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('later foreign edit');
});

it.each(['output', 'manifest', 'snapshot', 'proof', 'workspace'])('preserves foreign edits when %s changes after the owned result', async changed => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, true);
  if (changed === 'output') await fs.writeFile(path.join(output, 'index.js'), 'foreign edit');
  if (changed === 'manifest') await fs.writeFile(path.join(source, 'package.json'), '{"version":"another"}');
  if (changed === 'snapshot') await fs.writeFile(path.join(transition.journal.snapshot, '0/index.js'), 'tampered');
  if (changed === 'proof') await fs.appendFile(path.join(transition.journal.snapshot, 'proof.json'), ' ');
  if (changed === 'workspace') { await fs.rename(source, source + '-old'); await fs.mkdir(source); }
  await expect(recoverSdkTransition(root)).rejects.toThrow(/changed|replaced/);
  expect(await fs.readFile(path.join(modules, 'native.node'), 'utf8')).toBe('different ABI');
  expect((await json(path.join(state, 'transition.json'))).phase).toBe('committed');
});

it('resumes restoration after a lost rename acknowledgement without adopting other directories', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const rename = fs.rename;
  const injected = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (String(from) === output) throw Error('simulated crash after displacement');
  });
  await expect(recoverSdkTransition(root)).rejects.toThrow('simulated crash');
  injected.mockRestore();
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'restoring' });
  await recoverSdkTransition(root);
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('old executable bytes');
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'restored' });
});

it('preserves an edit arriving during displacement instead of deleting it as recovered output', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const rename = fs.rename;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (String(from) === output) await fs.writeFile(path.join(String(to), 'index.js'), 'concurrent displacement edit');
  });
  await expect(recoverSdkTransition(root)).rejects.toThrow('changed during displacement');
  const receipt = await json(path.join(state, 'transition.json'));
  expect(await fs.readFile(path.join(receipt.restoration[0].directory, 'displaced/index.js'), 'utf8')).toBe('concurrent displacement edit');
  expect(await fs.readFile(path.join(modules, 'native.node'), 'utf8')).toBe('different ABI');
});

it('does not publish a partial before-image or permit a build after failed copying', async () => {
  vi.spyOn(fs, 'cp').mockRejectedValueOnce(Error('disk unavailable'));
  await expect(prepare()).rejects.toThrow('disk unavailable');
  expect(await sdkTransitionStatus(root)).toBeNull();
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('old executable bytes');
});

it('retains the existing depth-first digest for small, empty and streamed files', async () => {
  const large = Buffer.alloc(300 * 1024, 0x5a);
  await fs.chmod(output, 0o700);
  await fs.mkdir(path.join(output, 'a'), { mode: 0o700 });
  await fs.writeFile(path.join(output, 'a/x'), '', { mode: 0o600 });
  await fs.writeFile(path.join(output, 'a-x'), large, { mode: 0o600 });
  await fs.chmod(path.join(output, 'index.js'), 0o600);
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const rows = [
    ['', 'directory', 0o700], ['a', 'directory', 0o700],
    [path.join('a', 'x'), 'file', 0o600, 0, digest('')],
    ['a-x', 'file', 0o600, large.length, digest(large)],
    ['index.js', 'file', 0o600, 20, digest('old executable bytes')],
    ['tool', 'file', 0o755, 17, digest('#!/bin/sh\nexit 0\n')],
  ];
  const transition = await prepare();
  expect(transition.proof.entries[0]?.before.digest).toBe(digest(JSON.stringify(rows)));
});

it('bounds parallel file readers and closes every descriptor before completing', async () => {
  for (let index = 0; index < 48; index++)
    await fs.writeFile(path.join(output, `part-${index}`), Buffer.alloc(2048, index));
  const open = fs.open;
  let active = 0, peak = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    active++; peak = Math.max(peak, active);
    const close = handle.close.bind(handle);
    handle.close = async () => { try { await close(); } finally { active--; } };
    return handle;
  });
  await prepare();
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(16);
  expect(active).toBe(0);
});

it.each(['inventory', 'prepare', 'verify'])('reads independent SDK paths concurrently during %s and retains their order', async phase => {
  const files = Array.from({ length: 32 }, (_, index) => path.join(source, `input-${index}.ts`));
  await Promise.all(files.map((file, index) => fs.writeFile(file, String(index))));
  const repeated = [...files, files[0]!];
  const inventory = phase === 'inventory';
  const retain = () => prepareSdkTransition({ root, source, paths: inventory ? repeated : [output], guards: inventory ? [] : repeated });
  if (phase === 'verify') await retain();

  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const opened = new Set<string>();
  const open = fs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
    if (files.includes(String(args[0]))) {
      opened.add(String(args[0]));
      await barrier;
    }
    return open(...args);
  });
  const operation = phase === 'verify' ? sdkTransitionStatus(root, true) : retain();
  try {
    await vi.waitFor(() => expect(opened.size).toBeGreaterThan(1));
    expect(opened.size).toBeLessThanOrEqual(inventory ? 4 : 16);
  } finally {
    release();
    await operation;
  }
  const journal = await json(path.join(state, 'transition.json'));
  const proof = await json(path.join(journal.snapshot, 'proof.json'));
  const entries = inventory ? proof.entries : proof.guards;
  expect(entries.map((item: { path: string }) => item.path)).toEqual(files);
  expect(opened.size).toBe(files.length);
});

it('drains concurrent copies before removing a failed staging directory', async () => {
  const cp = fs.cp;
  let started!: () => void;
  const copying = new Promise<void>(resolve => { started = resolve; });
  let active = 0, completed = false;
  vi.spyOn(fs, 'cp').mockImplementation(async (from, to, options) => {
    if (String(from) === output) { await copying; throw Error('synthetic copy failure'); }
    if (String(from) !== modules) return cp(from, to, options);
    active++; started();
    try { await cp(from, to, options); completed = true; } finally { active--; }
  });
  await expect(prepare()).rejects.toThrow('synthetic copy failure');
  expect(completed).toBe(true);
  expect(active).toBe(0);
  expect(await fs.readdir(path.join(cache, 'sdk-transitions'))).toEqual([]);
  expect(await sdkTransitionStatus(root)).toBeNull();
});

it('rejects a changing source during retention and leaves the foreign contents intact', async () => {
  const cp = fs.cp;
  vi.spyOn(fs, 'cp').mockImplementation(async (from, to, options) => {
    await cp(from, to, options);
    if (String(from) === output) await fs.writeFile(path.join(output, 'index.js'), 'concurrent edit');
  });
  await expect(prepare()).rejects.toThrow('changed while retaining');
  expect(await sdkTransitionStatus(root)).toBeNull();
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('concurrent edit');
});

it('refuses a change after retention before admitting the build', async () => {
  const transition = await prepare();
  await fs.writeFile(path.join(output, 'index.js'), 'foreign edit after snapshot');
  await expect(beginSdkTransition(transition)).rejects.toThrow('changed after retaining');
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'prepared' });
});

it.each(['shared-source', 'unknown-binding'])('requires stopped or proven independent consumers before public recovery: %s', async binding => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const other = path.join(temporary, 'other'); await fs.mkdir(other);
  rpc.projects.mockResolvedValue([{ name: 'consumer', path: root }, { name: 'other', path: binding === 'shared-source' ? source : other }]);
  rpc.stacks.mockImplementation(async ({ project }: { project: string }) => [{ name: 'dev', type: 'local',
    apps: [{ name: 'app', status: project === 'consumer' ? 'stopped' : 'online' }] }]);
  rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { applicationRuntimeResolution: 2 },
    connection: { status: 'connected' }, ownerRuntime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch } } });
  await expect(sdkCommand(['recover', '--project-dir', root, '--stack', 'dev']))
    .rejects.toThrow(binding === 'shared-source' ? 'before changing shared SDK outputs' : 'Cannot prove SDK isolation');
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
  expect(await sdkTransitionStatus(root)).toMatchObject({ phase: 'recoverable' });
});

it('does not certify a second consumer while the shared source has an unfinished selection', async () => {
  const transition = await prepare(); await beginSdkTransition(transition);
  const sourceState = path.join(source, '.omnitron/dev-sdk'); await fs.mkdir(sourceState, { recursive: true });
  await fs.writeFile(path.join(sourceState, 'pending-selection'), JSON.stringify({ root, id: transition.journal.id }));
  const other = path.join(temporary, 'other'), otherState = path.join(other, '.omnitron/dev-sdk');
  await fs.mkdir(otherState, { recursive: true });
  await fs.writeFile(path.join(otherState, 'active.json'), JSON.stringify({ schema: 1, root: other, source, links: {} }));
  await expect(inspectSdk(other)).rejects.toThrow('Shared SDK source has an unfinished selection');
});

it('checks the configured owner socket for an unscoped SDK mutation', async () => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, false);
  const socket = path.join(temporary, 'isolated-owner.sock'); await fs.writeFile(socket, '');
  vi.stubEnv('OMNITRON_SOCKET', socket);
  rpc.projects.mockResolvedValue([{ name: 'example', path: root }]);
  rpc.stacks.mockResolvedValue([{ name: 'serving', type: 'local', apps: [{ status: 'online' }] }]);
  await expect(sdkCommand(['recover', '--project-dir', root])).rejects.toThrow('Stop example/serving');
  expect((await sdkTransitionStatus(root))?.phase).toBe('recoverable');
});

it('rejects an overlapping cache and paths outside the admitted workspaces', async () => {
  vi.stubEnv('OMNITRON_DEV_CACHE', root);
  await expect(prepare()).rejects.toThrow('separate from both workspaces');
  vi.stubEnv('OMNITRON_DEV_CACHE', cache);
  await expect(prepareSdkTransition({ root, source, paths: [cache], guards: [] })).rejects.toThrow('escapes its workspace');
  expect(await sdkTransitionStatus(root)).toBeNull();
});

it('uses the canonical XDG development cache without an OMNITRON_DEV_CACHE prerequisite', async () => {
  vi.stubEnv('OMNITRON_DEV_CACHE', undefined); vi.stubEnv('XDG_CACHE_HOME', path.join(temporary, 'xdg'));
  const transition = await prepare();
  expect(transition.journal.cache).toBe(path.join(temporary, 'xdg/omnitron/development'));
  expect((await fs.stat(transition.journal.snapshot)).mode & 0o777).toBe(0o700);
});

it('refuses a symbolic cache prefix before creating anything through it', async () => {
  const outside = path.join(temporary, 'outside'); await fs.mkdir(outside);
  const alias = path.join(temporary, 'alias'); await fs.symlink(outside, alias);
  vi.stubEnv('OMNITRON_DEV_CACHE', path.join(alias, 'new-cache'));
  await expect(prepare()).rejects.toThrow('prefix is not physical');
  expect(await present(path.join(outside, 'new-cache'))).toBe(false);
});

it.each(['journal', 'cache', 'snapshot'])('refuses an unprotected %s without restoring dependencies', async target => {
  const transition = await prepare(); await beginSdkTransition(transition); await mutate(); await finishSdkTransition(transition, true);
  const file = target === 'journal' ? path.join(state, 'transition.json') : target === 'cache' ? path.dirname(transition.journal.snapshot) : transition.journal.snapshot;
  await fs.chmod(file, target === 'journal' ? 0o644 : 0o755);
  await expect(recoverSdkTransition(root)).rejects.toThrow('owned, protected path');
  expect(await fs.readFile(path.join(output, 'index.js'), 'utf8')).toBe('partially rebuilt');
});

it('rejects a symlinked destination parent instead of following it during recovery', async () => {
  const nested = path.join(source, 'package'); await fs.mkdir(nested);
  const destination = path.join(nested, 'dist'); await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'code'), 'old');
  const transition = await prepareSdkTransition({ root, source, paths: [destination], guards: [] });
  await beginSdkTransition(transition); await fs.writeFile(path.join(destination, 'code'), 'new'); await finishSdkTransition(transition, true);
  await fs.rename(nested, nested + '-moved'); await fs.symlink(nested + '-moved', nested);
  await expect(recoverSdkTransition(root)).rejects.toThrow('physical directory');
  expect(await fs.readFile(path.join(nested, 'dist/code'), 'utf8')).toBe('new');
});
