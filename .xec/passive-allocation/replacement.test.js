import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkAllocationParents, stagePassiveAllocation } from './receiver.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const linux = { skip: process.platform !== 'linux' && 'requires Linux directory exchange' };
const configFile = 'omnitron.config.mjs';
const sdk = new URL('../../apps/omnitron/dist/', import.meta.url);

async function fixture(t) {
  const { renderNodeAppConfig } = await import(new URL('project/node-app-config.js', sdk));
  const { prepareNodeConfigPublication } = await import(new URL('services/node-registration.js', sdk));
  const { stackDefinitionFingerprint } = await import(new URL('project/node-stack-stop.js', sdk));
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'passive-replace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projects = path.join(root, 'projects'), artifacts = path.join(root, 'artifacts');
  await fs.mkdir(projects, { mode: 0o700 }); await fs.mkdir(artifacts, { mode: 0o700 });
  const dir = path.join(projects, 'sample');
  const state = { rows: [], loaded: null, handles: [], containers: [], owner: 'owner-one', exchanges: 0, installs: [], loseReply: false, stale: false };
  const releases = new Map(), receipts = new Map();
  async function release(id, apps) {
    const prepared = { project: 'sample', stack: 'original', release: id, commit: hash(id).slice(0, 40), nodeId: 'receiver',
      manifestSha256: hash('manifest-' + id) };
    const files = apps.map(app => ({ app, version: id, launch: { file: 'index.mjs', mode: 'script' } }));
    releases.set(id, { manifestSha256: prepared.manifestSha256, manifest: { project: { commit: prepared.commit }, artifacts: files }, files });
    const entries = apps.map(name => ({ name, mode: 'script' }));
    return { prepared, apps: entries, ticket: hash(id) };
  }
  const old = await release('one', ['first', 'removed']);
  const next = await release('two', ['first', 'added']);
  const readConfig = target => fs.readFile(path.join(target, configFile), 'utf8')
    .then(body => JSON.parse(body.slice(body.indexOf('export default ') + 15).trim().slice(0, -1)));
  const ports = {
    render: renderNodeAppConfig, publication: prepareNodeConfigPublication, fingerprint: stackDefinitionFingerprint,
    loadRelease: id => releases.get(id), readReceipt: root => receipts.get(root),
    install: async (rel, _stack, entries, { prepare, ownerPackage }) => {
      state.installs.push({ release: rel.files[0].version, prepare });
      return Promise.all(entries.map(async ({ name }) => {
        const id = rel.files[0].version, releaseRoot = path.join(root, 'installed', id, name);
        if (prepare) {
          await fs.mkdir(releaseRoot, { mode: 0o700, recursive: true });
          await fs.writeFile(path.join(releaseRoot, 'index.mjs'), 'export const version = ' + JSON.stringify(id) + ';\n');
          receipts.set(releaseRoot, { version: 2, root: releaseRoot, ownerPackage, treeSha256: hash(id + name),
            origin: { app: name, artifactSha256: hash(name + id), releaseId: id, manifestSha256: rel.manifestSha256 } });
        } else await fs.access(path.join(releaseRoot, 'index.mjs'));
        return { name, releaseRoot, script: path.join(releaseRoot, 'index.mjs') };
      }));
    },
    owner: () => ({ root: '/fixture-owner', target: { executableSha256: hash('executable') }, execution: { pid: 42, ownerId: state.owner } }),
    sameOwner: (before, after) => assert.deepEqual(before, after),
    checkParents: name => checkAllocationParents(artifacts, projects, name, true),
    processes: () => state.handles, containers: () => state.containers,
    projects: {
      listProjects: () => state.rows,
      addProject: async ({ name, path }) => {
        const reread = state.rows.length > 0;
        if (!state.stale) state.loaded = await readConfig(path);
        if (!reread) state.rows = [{ name, path, enabledStacks: [], runningStacks: 0 }];
        if (reread) state.exchanges++;
        if (state.loseReply) { state.loseReply = false; throw Error('acknowledgement unavailable'); }
        return { name, path, ...(reread && { reread: { redefined: 0 } }) };
      },
      reviewStackStop: () => ({ digest: hash('preview'), keepInfrastructure: false, targets: [
        { node: 'local', definitionSha256: stackDefinitionFingerprint(['sample', 'deployed', state.loaded.stacks.deployed, state.loaded.apps]), applications: [], containers: [],
          runtime: { project: 'sample', stack: 'deployed', phase: 'stopped', revision: 4 } },
      ] }),
    },
  };
  const previous = await stagePassiveAllocation(old, dir, ports);
  next.replaces = { ticket: previous.ticket, release: previous.release, manifestSha256: previous.manifestSha256,
    configSha256: previous.configSha256, definitionSha256: previous.definitionSha256, previousOwner: state.owner, owner: state.owner };
  const exchange = path.join(projects, '.passive-replacements', next.ticket, 'exchange');
  return { dir, state, previous, next, ports, exchange, readConfig };
}

test('the ordinary receiver atomically replaces all disabled apps and preserves the previous publication', linux, async t => {
  const { dir, state, previous, next, ports, exchange, readConfig } = await fixture(t);
  const oldInode = (await fs.lstat(dir)).ino;
  const accepted = await stagePassiveAllocation(next, dir, ports);
  assert.equal(accepted.replaced, previous.ticket);
  assert.notEqual(accepted.definitionSha256, previous.definitionSha256);
  assert.notEqual(accepted.configSha256, previous.configSha256);
  assert.deepEqual(state.loaded.apps.map(a => a.name), ['first', 'added']);
  assert.ok(state.loaded.apps.every(a => a.enabled === false && a.cwd === a.releaseRoot && a.cwd.includes('/installed/two/')));
  assert.deepEqual((await readConfig(exchange)).apps.map(a => a.name), ['first', 'removed']);
  assert.equal((await fs.lstat(exchange)).ino, oldInode);
  const inode = (await fs.lstat(dir)).ino;
  assert.deepEqual(await stagePassiveAllocation(next, dir, ports), accepted);
  assert.equal(state.exchanges, 1);
  assert.equal((await fs.lstat(dir)).ino, inode);
  assert.deepEqual(state.installs.at(-1), { release: 'two', prepare: false });
});

test('an acknowledgement with stale daemon launch paths cannot confirm the replacement', linux, async t => {
  const { dir, state, next, ports } = await fixture(t);
  state.stale = true;
  await assert.rejects(() => stagePassiveAllocation(next, dir, ports), /did not confirm the replacement definition/);
  assert.deepEqual(state.loaded.apps.map(a => a.name), ['first', 'removed']);
  state.stale = false;
  const accepted = await stagePassiveAllocation(next, dir, ports);
  assert.notEqual(accepted.definitionSha256, next.replaces.definitionSha256);
  assert.deepEqual(state.loaded.apps.map(a => a.name), ['first', 'added']);
});

test('a lost same-path reread acknowledgement reconciles the two exact publications on retry', linux, async t => {
  const { dir, state, next, ports, exchange } = await fixture(t);
  state.loseReply = true;
  await assert.rejects(() => stagePassiveAllocation(next, dir, ports), /acknowledgement unavailable/);
  const inode = (await fs.lstat(dir)).ino, original = (await fs.lstat(exchange)).ino;
  assert.deepEqual(state.loaded.apps.map(a => a.name), ['first', 'added']);
  assert.equal(state.exchanges, 1);
  state.handles.push({ name: 'foreign' });
  await assert.rejects(() => stagePassiveAllocation(next, dir, ports), /handles/);
  state.handles.length = 0;
  const accepted = await stagePassiveAllocation(next, dir, ports);
  assert.equal(accepted.replaced, next.replaces.ticket);
  assert.equal((await fs.lstat(dir)).ino, inode);
  assert.equal((await fs.lstat(exchange)).ino, original);
  assert.equal(state.exchanges, 2);
  await stagePassiveAllocation(next, dir, ports);
  assert.equal(state.exchanges, 2);
});

test('foreign, active, missing or changed previous state is retained before any new installation', linux, async t => {
  const { dir, state, next, ports, exchange } = await fixture(t);
  const inode = (await fs.lstat(dir)).ino, priorRows = state.rows;
  async function refuses(message) {
    await assert.rejects(() => stagePassiveAllocation(next, dir, ports), message);
    assert.equal((await fs.lstat(dir)).ino, inode);
    assert.equal(state.installs.length, 1);
    assert.equal(state.exchanges, 0);
    await assert.rejects(fs.stat(exchange), { code: 'ENOENT' });
  }
  state.owner = 'another-owner'; await refuses(/owner changed/); state.owner = next.replaces.owner;
  state.rows = []; await refuses(/must remain registered/);
  state.rows = [{ ...priorRows[0], path: dir + '-foreign' }]; await refuses(/occupied/);
  state.rows = [{ ...priorRows[0], enabledStacks: ['deployed'] }]; await refuses(/occupied/); state.rows = priorRows;
  state.handles = [{ pid: 41 }]; await refuses(/handles/); state.handles = [];
  state.containers = ['unexpected']; await refuses(/physical stack containers/); state.containers = [];
  const fingerprint = next.replaces.definitionSha256;
  next.replaces.definitionSha256 = hash('unreviewed definition'); await refuses(/definition differs/);
  next.replaces.definitionSha256 = fingerprint;
  const additional = path.join(dir, '.registration-' + next.replaces.ticket, 'unreviewed');
  await fs.writeFile(additional, 'fixture'); await refuses(/unreviewed files/); await fs.unlink(additional);
  const file = path.join(dir, configFile), bytes = await fs.readFile(file);
  await fs.rename(file, file + '.prior');
  await fs.writeFile(file, bytes, { mode: 0o600 }); await fs.unlink(file + '.prior');
  await refuses(/changed after passive preparation/);
});
