import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareSdkTransition, beginSdkTransition, finishSdkTransition, recoverSdkTransition, sdkTransitionStatus } from '../../bin/sdk-transition.js';
import { sdkCommand, inspectSdk } from '../../bin/sdk.js';

const rpc = vi.hoisted(() => ({ projects: vi.fn(), stacks: vi.fn(), status: vi.fn(), disconnect: vi.fn() }));
vi.mock('@omnitron-dev/omnitron/operations', async () => ({
  assertExecutionCapabilities: (await import('../../src/daemon/execution-capabilities.js')).assertExecutionCapabilities,
  LONG_REQUEST_TIMEOUT: 1000,
  createDaemonClient: () => ({ service: async () => ({ listProjects: rpc.projects, listStacks: rpc.stacks }),
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
  vi.stubEnv('OMNITRON_DEV_CACHE', cache); vi.stubEnv('OMNITRON_HOME', path.join(temporary, 'no-owner'));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(temporary, { recursive: true, force: true }); });
const prepare = () => prepareSdkTransition({ root, source,
  paths: [output, modules, path.join(root, 'pnpm-lock.yaml'), ...['built.json', 'install.json', 'active.json'].map(name => path.join(state, name))],
  guards: [path.join(source, 'package.json')] });
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
  rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { applicationRuntimeResolution: 1 },
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
