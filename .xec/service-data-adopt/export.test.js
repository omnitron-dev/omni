import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { checkPipelineDefinition } from '../../apps/omnitron/src/services/pipeline-definition.ts';
import { adoptionBinding, adoptionDefinition, imageProbeDefinition } from '../commands/service-data-adopt.js';
import { retainedColdDefinition } from '../commands/service-data-cold.js';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const id = 'b1410007-f7e4-4cd4-82a2-4010331ffa1c',
  run = '4cea20df-2e35-412a-a497-ccbb0cc75024';
const rows = [
  ['postgres-data', '/var/lib/postgresql/data', 1],
  ['nominatim-data', '/var/lib/postgresql/14/main', 2],
  ['nominatim-flatnode', '/nominatim/flatnode', 2],
  ['nominatim-merged', '/merged', 2],
  ['redis-data', '/data', 3],
  ['minio-data', '/data', 4],
];
const seed = {
  id,
  sourceNode: 'source',
  receiverNode: 'receiver',
  sourceFingerprint: 'SHA256:' + 'A'.repeat(43),
  receiverFingerprint: 'SHA256:' + 'B'.repeat(43),
  sourceIp: '192.0.2.10',
  receiverIp: '192.0.2.20',
  receiverPort: 22,
  stageParent: '/srv/fixture',
  rateKiB: 200,
  ttlMinutes: 60,
  project: 'fixture',
  stack: 'test',
  clusters: { postgres: '123', nominatim: '456' },
  volumes: rows.map(([tag, target, n], i) => ({
    tag,
    target,
    volume: 'vol-' + tag,
    container: String(n).repeat(64),
    image: 'sha256:' + String(n + 4).repeat(64),
    device: '100',
    inode: String(i + 300),
  })),
};
const identity = [[0, 0, 4294967295]];
const maps = {
  uid_map: [
    [0, 995, 1],
    [1, 100000, 65536],
  ],
  gid_map: [
    [0, 984, 1],
    [1, 100000, 65536],
  ],
};
const observation = (name, nodeId, value) => ({
  name,
  nodeId,
  status: 'success',
  exitCode: 0,
  outputTruncated: false,
  output: JSON.stringify(value),
});
const donor = Object.fromEntries(rows.map(([tag]) => [tag, { uid_map: identity, gid_map: identity }]));
const evidence = {
  id: run,
  status: 'success',
  review: { digest: 'a'.repeat(64) },
  steps: [
    observation('source-volume-namespace', 'source', { maps: donor }),
    observation('target-engine-namespace', 'receiver', { daemonUid: 995, daemonPid: 21213, maps }),
  ],
};

test('the registered image-only probe has one receiver step with a bounded command', async () => {
  const g = await imageProbeDefinition(seed, evidence);
  await checkPipelineDefinition(g);
  assert.deepEqual(
    g.steps.map((s) => [s.name, s.nodeId]),
    [
      ['receiver-registration', undefined],
      ['image-only-probe', seed.receiverNode],
    ]
  );
  assert(g.steps.every((s) => Buffer.byteLength(s.run) <= 22 * 1024));
});

test('the retained cold and seal gates re-read each registered bootstrap and keep the historical installed worker', async (t) => {
  const helper = '1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff';
  const b = await adoptionBinding(seed, evidence);
  const stage = seed.stageParent + '/service-data-' + id;
  const make = (side, operation) => ({
    id: operation,
    status: 'success',
    review: { digest: 'c'.repeat(64) },
    steps: [
      observation('helper-part-1', seed[side + 'Node'], { helperSha256: helper, part: 1, total: 1 }),
      observation('bootstrap-' + side, seed[side + 'Node'], {
        side,
        spec: b.spec,
        ...(side === 'receiver' ? { stage } : {}),
      }),
    ],
  });
  const source = make('source', run),
    receiver = make('receiver', '4708659f-8c4b-4041-9d1c-416ecb8d0161');
  const common = { spec: b.spec, keySha256: 'SHA256:' + 'C'.repeat(43), expires: 123 };
  const grants = {
    source: { ...common, side: 'source', redisPersistence: 'aof' },
    receiver: { ...common, side: 'receiver', stage },
  };
  const trees = Object.fromEntries(
    rows
      .map((r) => r[0])
      .sort()
      .map((tag) => [tag, { bytes: 1, files: 1, sha256: 'd'.repeat(64) }])
  );
  const receipt = { id, spec: b.spec, stop: run, trees, sha256: hash(JSON.stringify(trees)) };
  const base = { sourceBootstrap: source, receiverBootstrap: receiver, stop: run };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'adopt-bootstrap-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const cli = path.join(tmp, 'omnitron');
  await fs.writeFile(
    cli,
    "#!/usr/bin/env python3\nimport pathlib,sys\nassert sys.argv[1:4]==['--json','pipeline','status'] and sys.argv[5:]==['--output']\nprint((pathlib.Path(__file__).parent/(sys.argv[4]+'.json')).read_text())\n",
    { mode: 0o700 }
  );
  const store = (r) => fs.writeFile(path.join(tmp, r.id + '.json'), JSON.stringify({ ok: true, data: r }));
  await Promise.all([store(source), store(receiver)]);
  const runShell = promisify(execFile);
  for (const phase of ['cold', 'seal']) {
    const opts = phase === 'cold' ? { ...base, grants } : { ...base, receipt };
    const g = await retainedColdDefinition(phase, seed, opts);
    await checkPipelineDefinition(g);
    assert.deepEqual(
      g.steps.map((s) => s.name),
      phase === 'cold'
        ? ['registered-pins', 'registered-seed-helpers', 'confirm-stop', 'check-receiver', 'cold', 'recheck-stop']
        : [
            'registered-pins',
            'registered-seed-helpers',
            'confirm-stop',
            'receiver-observe',
            'source-check',
            'seal',
            'recheck-stop',
          ]
    );
    for (const s of g.steps.filter((s) => s.nodeId)) {
      assert(s.run.includes(helper));
      assert.equal(s.run.includes('checked-redis-compat'), s.name === 'cold');
      assert(Buffer.byteLength(s.run) <= 22 * 1024);
    }
    const check = () =>
      runShell('/bin/sh', ['-ec', g.steps[1].run], {
        env: { ...process.env, PATH: tmp + path.delimiter + process.env.PATH },
      });
    await check();
    const changed = structuredClone(source);
    changed.steps[0].output += ' ';
    await store(changed);
    await assert.rejects(check(), /attestation differs/);
    await store(source);
  }
  const invalid = structuredClone(source);
  invalid.steps[0].output = JSON.stringify({ helperSha256: 'e'.repeat(64), part: 1, total: 1 });
  await assert.rejects(
    retainedColdDefinition('cold', seed, { ...base, grants, sourceBootstrap: invalid }),
    /qualified/
  );
  await assert.rejects(retainedColdDefinition('cold', seed, { ...base, grants, receiverBootstrap: source }));
});

test('the four-tree branch retains the full grant, excludes all PostgreSQL mounts and cannot satisfy full acceptance', async () => {
  const spec = structuredClone(seed);
  const extras = [
    ['postgres-data', 'postgres-wal', '/mnt/wal', '401'],
    ['nominatim-data', 'nominatim-tblspc-98765', '/srv/space', '402'],
  ];
  const maps = structuredClone(donor);
  for (const [parent, tag, target, inode] of extras) {
    spec.volumes.push({ ...spec.volumes.find((r) => r.tag === parent), volume: 'vol-' + tag, tag, target, inode });
    maps[tag] = maps[parent];
  }
  const observed = structuredClone(evidence);
  observed.steps[0].output = JSON.stringify({ maps });
  const options = { postgresReplicas: true };
  const full = await adoptionBinding(spec, observed);
  const files = await adoptionBinding(spec, observed, options);
  assert.equal(full.spec, files.spec);
  assert.notDeepEqual(full, files);
  const tags = ['minio-data', 'nominatim-flatnode', 'nominatim-merged', 'redis-data'];
  assert.deepEqual(Object.keys(files.volumes).sort(), tags);
  assert.deepEqual(files.donorMaps, full.donorMaps);
  const stage = spec.stageParent + '/service-data-' + id;
  const helper = '1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff';
  const bootstrap = (side, op) => ({
    id: op,
    status: 'success',
    review: { digest: 'a'.repeat(64) },
    steps: [
      observation('helper-part-1', spec[side + 'Node'], { helperSha256: helper, part: 1, total: 1 }),
      observation('bootstrap-' + side, spec[side + 'Node'], {
        side,
        spec: full.spec,
        ...(side === 'receiver' && { stage }),
      }),
    ],
  });
  const receiver = bootstrap('receiver', id);
  const input = { sourceBootstrap: bootstrap('source', run), receiverBootstrap: receiver, stop: run };
  const admitted = { spec: full.spec, keySha256: 'SHA256:' + 'C'.repeat(43), expires: 123 };
  const grants = { source: { ...admitted, side: 'source' }, receiver: { ...admitted, side: 'receiver', stage } };
  const trees = Object.fromEntries(tags.map((tag) => [tag, { bytes: 7, files: 1, sha256: 'd'.repeat(64) }]));
  const cold = {
    id,
    spec: full.spec,
    stop: run,
    fileScope: files.fileScope,
    trees,
    sha256: hash(JSON.stringify(trees)),
  };
  const sealed = {
    id,
    spec: full.spec,
    stop: run,
    fileScope: files.fileScope,
    sha256: cold.sha256,
    stage,
    sealed: true,
  };
  const exporter = (phase, opts) => adoptionDefinition(phase, spec, observed, cold, sealed, receiver, opts);
  for (const graph of [
    await retainedColdDefinition('cold', spec, { ...options, ...input, grants }),
    await retainedColdDefinition('seal', spec, { ...options, ...input, receipt: cold }),
    await exporter('restore', options),
    await exporter('verify', options),
  ]) {
    await checkPipelineDefinition(graph);
    assert(graph.name.endsWith('-files'));
    assert(graph.steps.every((s) => Buffer.byteLength(s.run) <= 22 * 1024));
    assert(graph.steps.some((s) => s.name === 'confirm-stop'));
    assert(graph.steps.some((s) => s.name === 'recheck-stop'));
  }
  await assert.rejects(exporter('restore', {}), /exact stack stop and volume set/);
  await assert.rejects(retainedColdDefinition('seal', spec, { ...input, receipt: cold }), /volume set/);
  for (const broken of [Object.keys(full.volumes), tags.slice(1), [...tags.slice(1), 'postgres-data']]) {
    const changed = Object.fromEntries(broken.sort().map((tag) => [tag, trees['redis-data']]));
    await assert.rejects(
      retainedColdDefinition('seal', spec, {
        ...options,
        ...input,
        receipt: { ...cold, trees: changed, sha256: hash(JSON.stringify(changed)) },
      }),
      /volume set/
    );
  }
  await assert.rejects(
    adoptionDefinition('verify', spec, observed, cold, { ...sealed, fileScope: undefined }, receiver, options),
    /matching sealed/
  );
});

test('a precise source and rootless destination observation bind new named volumes through the normal stop and pin gates', async () => {
  const b = await adoptionBinding(seed, evidence);
  assert.deepEqual(b.maps, maps);
  assert.deepEqual(await adoptionBinding(seed, { ok: true, data: evidence }), b);
  await assert.rejects(adoptionBinding(seed, { ok: false, data: evidence }), /successful/);
  const trees = Object.fromEntries(
    rows
      .map((r) => r[0])
      .sort()
      .map((tag) => [tag, { bytes: 1, files: 1, sha256: 'b'.repeat(64) }])
  );
  const cold = { id, spec: b.spec, stop: run, sha256: hash(JSON.stringify(trees)), trees };
  const seal = {
    id,
    spec: b.spec,
    stop: run,
    stage: seed.stageParent + '/service-data-' + id,
    sha256: cold.sha256,
    sealed: true,
  };
  const part = observation('helper-part-1', 'receiver', { helperSha256: 'c'.repeat(64), part: 1, total: 1 });
  const bootstrap = {
    id: run,
    status: 'success',
    review: { digest: 'd'.repeat(64) },
    steps: [part, observation('bootstrap-receiver', 'receiver', { side: 'receiver', spec: b.spec, stage: seal.stage })],
  };
  for (const phase of ['restore', 'verify']) {
    const graph = await adoptionDefinition(phase, seed, evidence, cold, seal, bootstrap);
    await checkPipelineDefinition(graph);
    assert.deepEqual(
      graph.steps.map((s) => s.name),
      ['registered-pins', 'confirm-stop', 'namespace-evidence', phase, 'recheck-stop']
    );
    assert.deepEqual(
      graph.steps.filter((s) => s.nodeId).map((s) => s.nodeId),
      ['receiver']
    );
    assert(graph.steps.every((step) => Buffer.byteLength(step.run) <= 22 * 1024));
  }
  await assert.rejects(
    adoptionDefinition('restore', seed, evidence, cold, { ...seal, sealed: false }, bootstrap),
    /sealed/
  );
  const foreign = structuredClone(bootstrap);
  foreign.steps[0].nodeId = 'source';
  await assert.rejects(adoptionDefinition('restore', seed, evidence, cold, seal, foreign), /evidence/);
  const partial = structuredClone(bootstrap);
  partial.steps[0].output = JSON.stringify({ helperSha256: 'c'.repeat(64), part: 1, total: 2 });
  await assert.rejects(adoptionDefinition('restore', seed, evidence, cold, seal, partial), /identity/);
});

test('foreign roles, a partial map and overlapping IDs fail before export', async () => {
  for (const edit of [
    (e) => {
      e.steps[0].nodeId = 'other';
    },
    (e) => {
      e.steps[1].outputTruncated = true;
    },
    (e) => {
      const changed = structuredClone(donor);
      delete changed['redis-data'];
      e.steps[0].output = JSON.stringify({ maps: changed });
    },
    (e) => {
      e.steps[1].output = JSON.stringify({
        daemonUid: 995,
        daemonPid: 21213,
        maps: {
          ...maps,
          uid_map: [
            [0, 995, 1],
            [1, 995, 65536],
          ],
        },
      });
    },
  ]) {
    const changed = structuredClone(evidence);
    edit(changed);
    await assert.rejects(adoptionBinding(seed, changed));
  }
});
