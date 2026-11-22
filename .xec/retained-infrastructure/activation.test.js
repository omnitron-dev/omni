import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { activationDefinition, checkedActivation } from './activation.mjs';
import { startOne, enginePort } from './activation-source.mjs';
import { tsImport } from 'tsx/esm/api';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const bytes = (s) => Buffer.from(JSON.stringify(s));
const expiry = () => Math.floor(Date.now() / 1000) + 800;
const ref = (step, body) => ({
  run: randomUUID(),
  pipeline: randomUUID(),
  review: sha(randomUUID()),
  revision: sha(randomUUID()),
  step,
  sourceHash: sha('reviewed step ' + step),
  outputSha256: sha(JSON.stringify(body)),
});
const witness = (r, node, body) => ({
  name: r.step,
  nodeId: node,
  kind: 'shell',
  status: 'success',
  exitCode: 0,
  outputTruncated: false,
  sourceHash: r.sourceHash,
  output: JSON.stringify(body),
});
const record = (reference, steps) => ({
  id: reference.run,
  pipelineId: reference.pipeline,
  status: 'success',
  completedAt: new Date().toISOString(),
  review: { digest: reference.review, definitionRevision: reference.revision },
  steps,
});

function fixture(restored = false) {
  const s = {
    protocol: 1,
    project: 'sample',
    stack: 'site',
    sourceNode: 'origin',
    receiverNode: 'next',
    sourceFingerprint: 'SHA256:' + 'a'.repeat(43),
    receiverFingerprint: 'SHA256:' + 'b'.repeat(43),
    nodeStop: randomUUID(),
    order: ['store', 'edge'],
    role: 'store',
    expires: expiry(),
    created: { store: sha('store'), edge: sha('edge') },
    declarationSha256: sha('canonical'),
    owner: {
      uid: 0,
      home: '/root/.omnitron',
      runtime: sha('old'),
      nodeSha256: sha('node'),
      socket: '/run/docker.sock',
      helper: '/opt/proof/helper',
      helperManifest: sha('helper'),
      directory: '/opt/proof/state',
      declarationFile: '/opt/proof/declaration',
      declarationFileSha256: sha('file'),
      seal: sha('seal'),
    },
  };
  const passive = {
    protocol: 1,
    project: s.project,
    stack: s.stack,
    declarationSha256: s.declarationSha256,
    created: s.created,
    running: 0,
  };
  const custody = {
    protocol: 1,
    project: s.project,
    stack: s.stack,
    sourceNode: s.sourceNode,
    receiverNode: s.receiverNode,
    nodeStop: s.nodeStop,
    returnDataReview: sha('independent data-owner handback'),
    beforeFirstNewWriter: true,
    receiverWriterFenced: true,
    exclusiveSigners: true,
    exclusivePublisher: true,
    roles: s.order,
    expires: s.expires,
  };
  const params = {
    expires: s.expires - 20,
    baseline: sha('baseline'),
    stopId: randomUUID(),
    placementReview: sha('placement'),
    returnDataReview: custody.returnDataReview,
    ...(!restored && { release: 'prior', prepared: sha('prepare') }),
  };
  const selected = {
    from: restored ? 'next' : 'origin',
    to: restored ? 'origin' : 'next',
    selected: restored,
    placementDigest: params.placementReview,
    fullStop: params.stopId,
  };
  s.passive = ref('passive-source', passive);
  s.custody = ref('accepted-data-custody', custody);
  s.handback = {
    mode: restored ? 'restored' : 'unchanged',
    record: ref(restored ? 'commit-native-return' : 'recheck-original-allocation', selected),
    params,
  };
  const h = s.handback.record,
    common = randomUUID();
  const extra = (name, node, value) => witness(ref(name, value), node, value);
  const runs = [
    record(s.passive, [witness(s.passive, 'origin', passive)]),
    record(s.custody, [witness(s.custody, 'local', custody)]),
    record(h, [
      witness(h, 'local', selected),
      extra('recheck-recipient-closed', 'next', { operationId: common, recipient: 'inactive', portalConsumers: 0 }),
      extra(restored ? 'release-signer-holds' : 'release-original-holds', 'origin', {
        operationId: common,
        oldRulesRestored: true,
        processesStarted: 0,
        publisherCreated: false,
      }),
    ]),
  ];
  return { s, runs };
}

test('one immutable source object is started once; a lost acknowledgment is reconciled by its running state', async () => {
  const { s } = fixture();
  s.passiveReview = s.passive.review;
  const live = new Set(),
    commands = [],
    scope = Object.values(s.created);
  let stored;
  const inventory = () => ({
    all: scope,
    ours: scope,
    created: scope.filter((id) => !live.has(id)),
    running: [...live],
    roles: Object.fromEntries(Object.entries(s.created).map(([k, v]) => [k, [v]])),
  });
  const context = () => ({
    inventory,
    guard: async () => {},
    journal: stored,
    write: (value) => {
      stored = structuredClone(value);
    },
    engine: {
      verify: async (id, name, running) => {
        assert(scope.includes(id));
        assert.equal(live.has(id), running);
        assert(name.startsWith('sample-site-'));
      },
      start: async (id) => {
        commands.push(id);
        live.add(id);
        throw Error('lost reply');
      },
    },
  });
  await assert.rejects(startOne({ ...s, role: 'edge' }, context()), /earlier/);
  assert.deepEqual(commands, []);
  const first = await startOne(s, context());
  assert.equal(first.containerId, s.created.store);
  assert.deepEqual(await startOne(s, context()), first);
  assert.deepEqual(commands, [s.created.store]);
  await assert.rejects(startOne({ ...s, created: { ...s.created, edge: sha('wrong') } }, context()), /Another passive/);
  const other = await startOne({ ...s, role: 'edge' }, context());
  assert.equal(other.containerId, s.created.edge);
  assert.deepEqual(commands, scope);
  live.delete(s.created.store);
  await assert.rejects(startOne(s, context()), /history/);
  assert.deepEqual(commands, scope);
});

test('unknown starts, a foreign running allocation, or expiration cannot dispatch another start', async () => {
  const { s } = fixture();
  s.passiveReview = s.passive.review;
  const ids = Object.values(s.created),
    inventory = { all: ids, ours: ids, created: ids, running: [], roles: { store: [ids[0]], edge: [ids[1]] } };
  let journal;
  let calls = 0;
  const ctx = () => ({
    inventory: () => inventory,
    engine: {
      verify: async () => {},
      start: async () => {
        calls++;
        throw Error('unknown');
      },
    },
    guard: async () => {},
    write: (value) => {
      journal = structuredClone(value);
    },
    journal,
  });
  await assert.rejects(startOne({ ...s, expires: 1 }, ctx()), /expired/);
  await assert.rejects(
    startOne(s, { ...ctx(), inventory: () => ({ ...inventory, all: [...ids, sha('foreign')] }) }),
    /extra/
  );
  await assert.rejects(
    startOne(s, { ...ctx(), inventory: () => ({ ...inventory, created: [ids[1]], running: [ids[0]] }) }),
    /history/
  );
  await assert.rejects(startOne(s, ctx()), /retain its original/);
  assert.equal(calls, 1);
  await assert.rejects(startOne(s, ctx()), /issued start/);
  assert.equal(calls, 1);
});

test('the local engine port only asks the selected full ID for public stats, numeric PIDs and detached start', async () => {
  const id = sha('new'),
    requests = [],
    socket = '/run/docker.sock';
  const root = '/containers/' + id;
  let running = false;
  const engine = enginePort(socket, async (sock, method, url) => {
    requests.push([sock, method, url]);
    if (url.endsWith('stats?stream=false&one-shot=true')) return [200, { id, name: '/sample-site-edge' }];
    if (url.endsWith('top?ps_args=-eo%20pid'))
      return running ? [200, { Titles: ['PID'], Processes: [['731']] }] : [409, {}];
    assert.equal(method, 'POST');
    assert.equal(url, root + '/start');
    running = true;
    return [204, null];
  });
  await engine.verify(id, 'sample-site-edge', false);
  await engine.start(id);
  await engine.verify(id, 'sample-site-edge', true);
  assert.equal(requests.length, 5);
  assert(requests.every(([sock, , url]) => sock === socket && url.startsWith(root + '/')));
  await assert.rejects(engine.start('sample-site-edge'), /identity/);
  await assert.rejects(engine.verify(id, 'unrelated', true), /different/);
});

test('registered admission rechecks completion, parameter commitment, current placement, per-role custody and exact passive objects', async (t) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-retained-activation-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'omnitron');
  await fs.writeFile(
    fake,
    `#!/usr/bin/env python3
import json,os,sys
f=json.load(open(os.environ['ACTIVATION_FIXTURE']));s=f['s'];a=sys.argv[2:]
if a[0:2]==['node','ssh-key']:v={'nodeId':a[2],'observed':s['sourceFingerprint' if a[2]=='origin' else 'receiverFingerprint'],'trusted':s['sourceFingerprint' if a[2]=='origin' else 'receiverFingerprint']}
elif a==['node','list']:v={'nodes':[{'id':'origin','host':'one'},{'id':'next','host':'two'}]}
elif a[0:2]==['stack','status']:v={'config':{'type':'remote','nodes':[{'host':f.get('route','one')}]}}
elif a[0:2]==['pipeline','status']:v=next(r for r in f['runs'] if r['id']==a[2])
elif a[0:2]==['pipeline','run']:
 assert '--prepare' in a and a[-1]=='/dev/stdin' and json.load(sys.stdin)==f['originalParams'];v=f['runs'][2]
else:sys.exit(2)
print(json.dumps({'ok':True,'data':v}))\n`,
    { mode: 0o755 }
  );
  async function run(f, adjust) {
    f.originalParams = structuredClone(f.s.handback.params);
    adjust?.(f);
    const raw = bytes(f.s),
      graph = await activationDefinition(raw, sha(raw));
    assert.equal(graph.steps[2].nodeId, 'origin');
    assert.deepEqual(graph.steps[2].dependsOn, ['verify-return-authority']);
    assert(graph.steps.every((step) => Buffer.byteLength(step.run) <= 22 * 1024));
    const data = path.join(dir, 'fixture.json');
    await fs.writeFile(data, JSON.stringify(f));
    return spawnSync('/bin/sh', ['-c', graph.steps[1].run], {
      encoding: 'utf8',
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, ACTIVATION_FIXTURE: data },
    }).status;
  }
  assert.equal(await run(fixture()), 0);
  assert.equal(await run(fixture(true)), 0);
  for (const mutate of [
    (f) => {
      f.route = 'two';
    },
    (f) => {
      f.runs[0].steps[0].outputTruncated = true;
    },
    (f) => {
      f.s.handback.params.returnDataReview = sha('another custody');
    },
    (f) => {
      f.s.handback.params.baseline = sha('new baseline');
    },
    (f) => {
      f.runs[1].steps[0].output = '{}';
    },
    (f) => {
      f.runs[2].steps[1].nodeId = 'origin';
    },
    (f) => {
      f.s.created.store = sha('replaced');
    },
  ])
    assert.notEqual(await run(fixture(), mutate), 0);
  const f = fixture().s;
  assert.throws(() => checkedActivation(bytes(f), 'f'.repeat(64)));
  f.owner.socket = 'tcp://another-machine';
  assert.throws(() => checkedActivation(bytes(f), sha(bytes(f))));
});

test('the normal Xec command emits a bounded definition accepted by the stock Pipeline checker', async (t) => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-protected-export-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { s } = fixture(),
    raw = bytes(s),
    request = path.join(directory, 'admission.json');
  await fs.writeFile(request, raw);
  const cli = spawnSync(
    path.resolve('node_modules/.bin/xec'),
    ['retained-infrastructure', 'start-one', request, '--expect', sha(raw)],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
    }
  );
  assert.equal(cli.status, 0, cli.stderr);
  const graph = JSON.parse(cli.stdout);
  assert.deepEqual(graph, await activationDefinition(raw, sha(raw)));
  const { checkPipelineDefinition } = await tsImport(
    '../../apps/omnitron/src/services/pipeline-definition.ts',
    import.meta.url
  );
  await checkPipelineDefinition(graph);
  assert(graph.steps.every((s) => !s.run.includes('{{')));
});
