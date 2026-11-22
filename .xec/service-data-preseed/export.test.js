import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { checkPipelineDefinition } from '../../apps/omnitron/src/services/pipeline-definition.ts';
import { grantContract, receiverProgram, serviceDataDefinition } from '../commands/service-data-preseed.js';

const run = promisify(execFile),
  spec = {
    id: 'b1410007-f7e4-4cd4-82a2-4010331ffa1c',
    project: 'fixture',
    stack: 'test',
    sourceNode: 'source',
    receiverNode: 'receiver',
    sourceIp: '192.0.2.10',
    receiverIp: '192.0.2.20',
    receiverPort: 22,
    sourceFingerprint: 'SHA256:' + 'A'.repeat(43),
    receiverFingerprint: 'SHA256:' + 'B'.repeat(43),
    stageParent: '/srv/staging',
    rateKiB: 2048,
    ttlMinutes: 60,
    clusters: { postgres: '100', nominatim: '200' },
  };
const roots = [
  ['postgres-data', '/var/lib/postgresql/data', 1],
  ['nominatim-data', '/var/lib/postgresql/14/main', 2],
  ['nominatim-flatnode', '/nominatim/flatnode', 2],
  ['nominatim-merged', '/merged', 2],
  ['redis-data', '/data', 3],
  ['minio-data', '/data', 4],
];
spec.volumes = roots.map(([tag, target, n], i) => ({
  tag,
  target,
  container: String(n).repeat(64),
  image: 'sha256:' + String(n + 4).repeat(64),
  volume: 'fixture-' + tag,
  device: '15',
  inode: String(123 + i),
}));
const pub = Buffer.concat([
  Buffer.from('0000000b7373682d6564323535313900000020', 'hex'),
  generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
]);
const key = 'ssh-ed25519 ' + pub.toString('base64'),
  fp = 'SHA256:' + createHash('sha256').update(pub).digest('base64').replace(/=+$/, '');
const stop = '4cea20df-2e35-412a-a497-ccbb0cc75024';
test('ordinary seed can resume the admitted helper with an explicit bounded idle timeout', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'retained-warm-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const exp = Math.floor(Date.now() / 1000) + 1800,
    c = await grantContract(spec, key, exp, '11', '12');
  const common = { spec: c.source.spec, keySha256: fp, expires: exp };
  const grants = { source: { ...common, side: 'source' }, receiver: { ...common, side: 'receiver', stage: c.stage } };
  const helper = '1774d8587171e5481ba010493223470fdc6e737f858806dd4d9ae3238edde3ff';
  const boot = (side, id) => ({
    id,
    status: 'success',
    review: { digest: 'e'.repeat(64) },
    steps: [
      ['helper-part-1', { part: 1, total: 1, helperSha256: helper }],
      ['bootstrap-' + side, { side, spec: c.source.spec, stage: c.stage }],
    ].map(([name, v]) => ({
      name,
      nodeId: spec[side + 'Node'],
      status: 'success',
      exitCode: 0,
      outputTruncated: false,
      output: JSON.stringify(v),
    })),
  });
  const input = { spec, grants, source: boot('source', stop), receiver: boot('receiver', spec.id) };
  const file = (name) => path.join(dir, name + '.json');
  await Promise.all(Object.entries(input).map(([n, v]) => fs.writeFile(file(n), JSON.stringify(v))));
  const exe = path.resolve('node_modules/.bin/xec'),
    base = ['service-data-preseed', 'seed', file('spec'), '--grants', file('grants')];
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH };
  const cli = (more) => run(exe, [...base, ...more], { maxBuffer: 1024 ** 2, env });
  const old = await serviceDataDefinition('seed', spec, { grants });
  assert(!old.steps.at(-1).run.includes('registered-warm-budget'));
  const result = JSON.parse(
    (
      await cli([
        '--source-bootstrap',
        file('source'),
        '--receiver-bootstrap',
        file('receiver'),
        '--idle-timeout',
        '1800',
      ])
    ).stdout
  );
  await checkPipelineDefinition(result);
  assert.deepEqual(
    result.steps.map((s) => s.name),
    ['registered-pins', 'registered-seed-helpers', 'check-receiver', 'seed']
  );
  assert(result.steps.filter((s) => s.nodeId).every((s) => s.run.includes(helper)));
  assert(result.steps.at(-1).run.includes('registered-warm-budget'));
  assert(result.steps.every((s) => Buffer.byteLength(s.run) <= 22 * 1024));
  await assert.rejects(cli(['--source-bootstrap', file('source')]), /Both endpoint/);
  await assert.rejects(serviceDataDefinition('seed', spec, { grants, warmIdleSeconds: 1801 }), /idle timeout/);
  await assert.rejects(serviceDataDefinition('cold', spec, { grants, stop, warmIdleSeconds: 90 }), /Only a warm seed/);
});

test('independent grants and a fresh controller stop are necessary for each supported entry point', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 1800,
    contract = await grantContract(spec, key, expiry, '11', '12');
  assert.equal(contract.source.spec, contract.receiver.spec);
  assert.equal(
    contract.receiverHelperSha256,
    createHash('sha256')
      .update(await receiverProgram())
      .digest('hex')
  );
  assert(contract.authorizedKey.startsWith('restrict,from="192.0.2.10",expiry-time='));
  const grants = {
    source: { side: 'source', spec: contract.source.spec, keySha256: fp, expires: expiry },
    receiver: { side: 'receiver', spec: contract.source.spec, keySha256: fp, expires: expiry, stage: contract.stage },
  };
  for (const phase of [
    'bootstrap-source',
    'bootstrap-receiver',
    'source-grant',
    'receiver-grant',
    'seed',
    'cold',
    'status',
    'revoke',
  ]) {
    const args = ['seed', 'cold'].includes(phase) ? { grants } : {};
    if (phase === 'cold') args.stop = stop;
    const graph = await serviceDataDefinition(phase, spec, args);
    await checkPipelineDefinition(graph);
    assert.equal(graph.steps[0].name, 'registered-pins');
    assert(!graph.steps.some((s) => s.run.includes('BEGIN OPENSSH PRIVATE KEY')));
    assert(graph.steps.every((s) => Buffer.byteLength(s.run) <= 24576));
    if (phase.startsWith('bootstrap-')) {
      const side = phase.slice(10);
      assert(graph.steps.slice(1).every((s) => s.nodeId === spec[side + 'Node']));
      assert(graph.steps.slice(1, -1).every((s, i) => s.name === 'helper-part-' + (i + 1)));
      assert.equal(graph.steps.at(-1).name, phase);
    }
    if (phase === 'seed')
      assert.deepEqual(
        graph.steps.map((s) => s.name),
        ['registered-pins', 'check-receiver', 'seed']
      );
    if (phase === 'cold')
      assert.deepEqual(
        graph.steps.map((s) => s.name),
        ['registered-pins', 'confirm-stop', 'check-receiver', 'cold', 'recheck-stop']
      );
  }
  await assert.rejects(serviceDataDefinition('seed', spec), /grants/);
  await assert.rejects(serviceDataDefinition('cold', spec, { grants }), /stop/);
  await assert.rejects(
    serviceDataDefinition('seed', spec, {
      grants: { ...grants, receiver: { ...grants.receiver, keySha256: 'SHA256:' + 'Q'.repeat(43) } },
    }),
    /independently/
  );
  await assert.rejects(serviceDataDefinition('seal', spec, { stop, receipt: {} }), /receipt/);
  const tree = { sha256: 'a'.repeat(64), files: 1, bytes: 5 };
  const trees = Object.fromEntries(
    spec.volumes
      .map((r) => r.tag)
      .sort()
      .map((tag) => [tag, tree])
  );
  const sorted = Object.fromEntries(
    Object.entries(trees).map(([tag, r]) => [tag, { bytes: r.bytes, files: r.files, sha256: r.sha256 }])
  );
  const receipt = {
    id: spec.id,
    spec: contract.source.spec,
    stop,
    trees,
    sha256: createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
  };
  const seal = await serviceDataDefinition('seal', spec, { stop, receipt });
  await checkPipelineDefinition(seal);
  assert.deepEqual(
    seal.steps.map((s) => s.name),
    ['registered-pins', 'confirm-stop', 'receiver-observe', 'source-check', 'seal', 'recheck-stop']
  );
  assert(seal.steps.every((s) => Buffer.byteLength(s.run) <= 24576));
  await assert.rejects(serviceDataDefinition('source-grant', { ...spec, volumes: spec.volumes.slice(1) }), /volume/);
});

test('the ordinary CLI emits a complete graph and the full stop gate rejects a resume or retained containers', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'service-data-cli-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const specFile = path.join(dir, 'spec.json');
  await fs.writeFile(specFile, JSON.stringify(spec));
  const { stdout } = await run(
    path.resolve('node_modules/.bin/xec'),
    ['service-data-preseed', 'source-grant', specFile],
    {
      maxBuffer: 2 * 1024 ** 2,
      env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
    }
  );
  assert.deepEqual(JSON.parse(stdout), await serviceDataDefinition('source-grant', spec));
  const expiry = Math.floor(Date.now() / 1000) + 1800,
    contract = await grantContract(spec, key, expiry, '11', '12');
  const source = { side: 'source', spec: contract.source.spec, keySha256: fp, expires: expiry };
  const graph = await serviceDataDefinition('cold', spec, {
    stop,
    grants: { source, receiver: { ...source, side: 'receiver', stage: contract.stage } },
  });
  const file = path.join(dir, 'omnitron');
  await fs.writeFile(
    file,
    '#!/usr/bin/env python3\nimport os,sys\ncommands={("--json","stack","status","fixture","test"):"FIXTURE",("--json","node","list"):"REGISTRY"}\nprint(os.environ[commands[tuple(sys.argv[1:])]])\n',
    { mode: 0o700 }
  );
  const registered = { id: 'source', host: spec.sourceIp, daemonPort: 9700 };
  const observed = { node: 'source', outcome: 'stopped', operationId: 'remote-stop', observedAt: '2026-01-03T12:00:00Z' };
  const byAddress = { ...observed, node: `${spec.sourceIp}:9700` };
  const gate = (state, registry = [registered]) =>
    run('/bin/sh', ['-c', graph.steps[1].run], {
      env: {
        ...process.env,
        PATH: dir + path.delimiter + process.env.PATH,
        REGISTRY: JSON.stringify({ ok: true, data: { nodes: registry } }),
        FIXTURE: JSON.stringify({
          ok: true,
          data: {
            status: 'stopped',
            stopOperation: { id: stop, phase: 'stopped', nodes: [observed], ...state },
          },
        }),
      },
    });
  await gate({});
  await gate({ nodes: [byAddress] });
  await gate({ nodes: [{ ...byAddress, nodeId: 'source' }] });
  await gate({ nodes: [{ ...observed, node: 'local', authority: { nodeId: 'source' } }] });
  await assert.rejects(gate({ nodes: [byAddress] }, [registered, { ...registered, id: 'another' }]), /approved full stack stop/);
  await assert.rejects(gate({ nodes: [byAddress] }, [{ ...registered, host: '192.0.2.12' }]), /approved full stack stop/);
  for (const state of [
    { id: 'stale' },
    { keepInfrastructure: true },
    { supersededAt: 'now' },
    { nodes: [{ node: 'elsewhere', outcome: 'stopped' }] },
    { nodes: [{ ...byAddress, authority: { nodeId: 'elsewhere' } }] },
    { nodes: [{ ...byAddress, nodeId: 'elsewhere' }] },
    { nodes: [{ ...byAddress, node: `${spec.sourceIp}:9701` }] },
    { nodes: [{ ...byAddress, operationId: undefined }] },
    { nodes: [{ ...byAddress, observedAt: undefined }] },
    { nodes: [observed, byAddress] },
  ])
    await assert.rejects(gate(state), /approved full stack stop/);
});
