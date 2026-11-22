import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { sealOriginal, stageStopped, readStoppedAllocation } from './stage.mjs';

const digest = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fingerprint = v => digest(v).slice(0, 16);
const imageId = 'sha256:' + '1'.repeat(64);
const operation = 'f3d46bb2-1967-43ec-aab7-69e7cceb8037';

function fixture(root) {
  const scope = { project: 'sample', stack: 'test' };
  const registry = new Map(), created = [], bindings = { 'site:store': 'temporary-synthetic-secret' };
  const services = ['cache', 'store'].map((role, index) => {
    const name = 'sample-test-' + role, volume = name + '-data', originalId = String(index + 2).repeat(64);
    fs.mkdirSync(path.join(root, volume, '_data'), { recursive: true });
    const spec = { name, image: 'alpine-local:qualified', environment: role === 'store' ? { DB_PASSWORD: { binding: 'site:store' } } : {},
      labels: { 'omnitron.managed': 'true', 'omnitron.project': 'sample', 'omnitron.stack': 'test', 'omnitron.service': role },
      ports: [], volumes: [{ source: volume, target: '/data' }], network: 'isolated', restart: 'unless-stopped', command: ['sleep', '60'] };
    const environment = role === 'store' ? { DB_PASSWORD: bindings['site:store'] } : {};
    registry.set(originalId, { scope, role, name, status: 'running',
      labels: { ...spec.labels, 'omnitron.spec-hash': fingerprint({ ...spec, environment }) } });
    return { originalId, imageId, spec };
  });
  const declaration = { protocol: 1, ...scope, release: 'accepted', manifestSha256: 'd'.repeat(64), services };
  let lost = true;
  function docker(args, input) {
    if (args[0] === 'volume') return args.at(-1).slice(6, -1);
    if (args[0] === 'network') return '9'.repeat(64);
    if (args[0] === 'image') return imageId;
    if (args[0] === 'ps') {
      return [...registry].filter(([, row]) => {
        if (!args.includes('--all') && row.status !== 'running') return false;
        return args.filter((_, i) => args[i - 1] === '--filter').every(s => {
          if (s.startsWith('name=')) return s === 'name=^/' + row.name + '$';
          const [key, val] = s.slice(6).split('=');
          return Object.hasOwn(row.labels, key) && (!val || row.labels[key] === val);
        });
      }).map(([id]) => id).join('\n');
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      const object = args.at(-1), row = registry.get(object), spec = services.find(r => r.spec.name === row.name).spec;
      if (args[3].startsWith('[{{json .Id}}')) return JSON.stringify([object, imageId, spec.image, spec.network, spec.restart,
        67108864, 0, 0, 0, 0, 0, false, null, null, false, ['no-new-privileges'], {}, []]);
      if (args.includes('{{json .Mounts}}')) return JSON.stringify(spec.volumes.map(v => ({ Type: 'volume', Name: v.source,
        Destination: v.target, RW: !v.readonly, Source: path.join(root, v.source, '_data') })));
      return [object, '/' + row.name, imageId, spec.image, 'created', spec.restart, row.labels['omnitron.creation'], row.labels['omnitron.spec-hash']].join('|');
    }
    assert.deepEqual(args.slice(0,2), ['container','create']);
    assert(args.includes('--pull=never'));assert(args.includes('--restart=unless-stopped'));assert(args.some(a => a.includes('volume-nocopy')));
    assert(!args.join(' ').includes(bindings['site:store']));
    const name = args[args.indexOf('--name') + 1], role = name.split('-').at(-1);
    const labels = Object.fromEntries(args.filter((_, i) => args[i - 1] === '--label').map(v => v.split('=')));
    const id = (role === 'store' ? '7' : '8').repeat(64);
    registry.set(id, { name, status: 'created', labels, role });created.push(id);
    if (role === 'store') assert.equal(input, 'DB_PASSWORD=' + bindings['site:store'] + '\n');
    if (lost) { lost = false; throw Error('simulated lost allocation reply'); }
    return id;
  }
  const record = { phase: 'stopped', plan: { protocol: 1, ...scope, applications: true, operationId: operation, execution: { project: scope.project, stack: 'deployed', apps: [{name: 'sample/deployed/app'}] },
    containers: services.map(r => ({ id: r.originalId, name: r.spec.name })) },
    receipt: { protocol: 1, ...scope, outcome: 'stopped', operationId: operation,
      applications: { project: scope.project, stack: 'deployed', operationId: operation, revision: 4, stopped: ['sample/deployed/app'] },
      removedContainers: services.map(r => r.originalId) } };
  return { declaration, registry, created, docker, bindings, record };
}

test('current source-native stop and a private physical seal allow one passive allocation per original volume', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-retained-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { declaration, registry, created, docker, bindings, record } = fixture(root);
  const sealed = sealOriginal(declaration, { docker, fingerprint, bindings, volumeRoot: root });
  assert(!JSON.stringify(sealed).includes(bindings['site:store']));
  const dbPath = path.join(root, 'journal.db'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE state_kv(key TEXT PRIMARY KEY, value TEXT)');
  const store = r => db.prepare('INSERT OR REPLACE INTO state_kv VALUES (?,?)').run('lifecycle:node-stack-stops:v1', JSON.stringify({ 'sample/test': r }));
  t.after(() => db.close());
  const gate = () => readStoppedAllocation(dbPath, declaration, operation);
  let reservations = 0;
  const run = values => stageStopped(declaration, sealed, { docker, fingerprint, bindings: values, confirmedStop: gate,
    reserve: () => { reservations++; } });
  store({ ...record, phase: 'applying' });registry.clear();
  await assert.rejects(run(bindings), /completed native stop/);assert.equal(created.length, 0);
  store({ ...record, receipt: {...record.receipt, removedContainers: []} });
  await assert.rejects(run(bindings), /completed native stop/);assert.equal(created.length, 0);
  store(record);
  await assert.rejects(run({ 'site:store': 'different' }), /private binding/);assert.equal(created.length, 0);
  const dir = path.join(root, declaration.services[0].spec.volumes[0].source, '_data');
  fs.renameSync(dir, dir + '-original');fs.mkdirSync(dir);
  await assert.rejects(run(bindings), /physical objects/);assert.equal(created.length, 0);
  assert.equal(reservations, 0);
  fs.rmdirSync(dir);fs.renameSync(dir + '-original', dir);
  const result = await run(bindings);
  assert.equal(created.length, 2);assert.equal(result.running, 0);
  assert.deepEqual(await run(bindings), result);assert.equal(created.length, 2);assert.equal(reservations, 2);
  assert(!JSON.stringify(result).includes(bindings['site:store']));
});
