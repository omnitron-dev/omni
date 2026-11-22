import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { checkPipelineDefinition } from '../../apps/omnitron/src/services/pipeline-definition.ts';
import { postgresSwitchoverDefinition } from '../commands/postgres-switchover.js';

const seed = randomUUID(),
  stop = randomUUID();
const volumes = [
  ['postgres-data', '/var/lib/postgresql/data', 1],
  ['nominatim-data', '/var/lib/postgresql/14/main', 2],
  ['nominatim-flatnode', '/nominatim/flatnode', 2],
  ['nominatim-merged', '/merged', 2],
  ['redis-data', '/data', 3],
  ['minio-data', '/data', 4],
].map(([tag, target, group], i) => ({
  tag,
  target,
  container: String(group).repeat(64),
  image: 'sha256:' + String(group + 4).repeat(64),
  volume: tag,
  device: '1',
  inode: String(i + 10),
}));
const spec = {
  id: seed,
  project: 'fixture',
  stack: 'test',
  sourceNode: 'donor',
  receiverNode: 'candidate',
  sourceIp: '192.0.2.10',
  receiverIp: '192.0.2.20',
  receiverPort: 22,
  sourceFingerprint: 'SHA256:' + 'a'.repeat(43),
  receiverFingerprint: 'SHA256:' + 'b'.repeat(43),
  stageParent: '/srv/fixture-stage',
  rateKiB: 32768,
  ttlMinutes: 60,
  clusters: { postgres: '101', nominatim: '202' },
  volumes,
};
const binding = {
  schema: 1,
  seed,
  engineUid: 995,
  candidates: Object.fromEntries(
    ['postgres', 'nominatim'].map((s, i) => [
      s,
      {
        container: String(i + 4).repeat(64),
        volume: 'private-' + s,
        device: '2',
        inode: String(i + 20),
        socketInode: String(i + 30),
        socketDevice: '2',
      },
    ])
  ),
};
const sha = (x) => createHash('sha256').update(x).digest('hex');
const sort = (v, compare) =>
  Array.isArray(v)
    ? v.map((a) => sort(a, compare))
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort(compare)
            .map((k) => [k, sort(v[k], compare)])
        )
      : v;
const digest = (v) => sha(JSON.stringify(sort(v)));
const names = {
  base: 'verify-native-bases',
  source: 'read-terminal-wal',
  replay: 'witness-standby-replay',
  promote: 'promote-private-standbys',
};
function run(phase, graph) {
  const clusters = Object.fromEntries(
    Object.entries(spec.clusters).map(([s, systemIdentifier]) => {
      const source = spec.volumes.find((row) => row.tag === s + '-data');
      const physical = phase === 'source' ? source : binding.candidates[s];
      const record = {
        systemIdentifier,
        major: s === 'postgres' ? 17 : 14,
        image: source.image,
        volume: physical.volume,
        device: physical.device,
        inode: physical.inode,
      };
      if (phase === 'source')
        Object.assign(record, {
          timeline: 1,
          shutdownCheckpointLsn: '0/3000170',
          writerFence: 'immutable-pgdata',
          ...(s === 'nominatim' && {
            importFinished: { sha256: '2'.repeat(64), bytes: 0, mtimeNs: '1700000000000000000' },
          }),
        });
      else
        Object.assign(record, {
          container: physical.container,
          manifestSha256: '8'.repeat(64),
          ...(phase !== 'base' && {
            sourceTimeline: 1,
            terminal: '0/3000170',
            standby: { systemIdentifier, timeline: 1, lsn: '0/30001E8' },
          }),
        });
      if (phase === 'promote')
        record.privatePrimary = { systemIdentifier, timeline: 2, lsn: '0/3000220', forkLsn: '0/30001E8' };
      return [s, record];
    })
  );
  const output = JSON.stringify({
    protocol: 'omnitron.postgres-switchover/1',
    phase,
    seed,
    spec: digest(spec),
    binding: digest(binding),
    stop: phase === 'base' ? null : stop,
    clusters,
  });
  return {
    id: randomUUID(),
    status: 'success',
    review: { digest: '3'.repeat(64) },
    steps: graph.steps.map((step) => ({
      name: step.name,
      kind: 'shell',
      nodeId: step.nodeId ?? 'local',
      status: 'success',
      exitCode: 0,
      sourceHash: sha(
        JSON.stringify(sort(step, (a, b) => a.length - b.length || Buffer.compare(Buffer.from(a), Buffer.from(b))))
      ),
      outputTruncated: false,
      output: step.name === names[phase] ? output : 'ok',
    })),
  };
}

test('ordinary Xec exports both native gates and binds the exact earlier reviewed commands', async (t) => {
  const evidence = {};
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-switchover-export-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let promotedRun;
  for (const phase of ['base', 'source', 'replay', 'promote']) {
    const previous = ['base', 'source'].includes(phase) ? {} : evidence;
    const g = await postgresSwitchoverDefinition(phase, spec, binding, {
      stop: phase === 'base' ? undefined : stop,
      evidence: previous,
    });
    await checkPipelineDefinition(g);
    assert(g.steps.every((step) => Buffer.byteLength(step.run) <= 22 * 1024));
    if (phase !== 'base') assert(g.steps.some((s) => s.name === 'confirm-full-source-stop'));
    if (['replay', 'promote'].includes(phase))
      assert.deepEqual(
        g.steps.slice(-5).map((s) => s.nodeId ?? 'local'),
        ['local', spec.sourceNode, spec.receiverNode, spec.sourceNode, 'local']
      );
    if (phase !== 'promote') evidence[phase] = run(phase, g);
    else promotedRun = run(phase, g);
    if (phase !== 'promote') continue;
    for (const [key, value] of Object.entries({ spec, binding, evidence }))
      await fs.writeFile(path.join(dir, key), JSON.stringify(value));
    const result = await promisify(execFile)(
      path.resolve('node_modules/.bin/xec'),
      [
        'postgres-switchover',
        phase,
        path.join(dir, 'spec'),
        '--binding',
        path.join(dir, 'binding'),
        '--stop',
        stop,
        '--evidence',
        path.join(dir, 'evidence'),
      ],
      {
        env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
        maxBuffer: 1024 ** 2,
      }
    );
    assert.deepEqual(JSON.parse(result.stdout), g);
  }
  const all = { ...evidence, promote: promotedRun };
  const wanted = path.join(dir, 'all'),
    registered = path.join(dir, 'registered');
  await fs.writeFile(wanted, JSON.stringify(all));
  await fs.writeFile(registered, JSON.stringify(all));
  await fs.writeFile(
    path.join(dir, 'omnitron'),
    `#!/usr/bin/python3
import json,sys
from pathlib import Path
args=sys.argv[1:]
assert len(args)==5 and args[:3]==['--json','pipeline','status'] and args[4]=='--output'
run=next(r for r in json.loads(Path(__file__).with_name('registered').read_text()).values() if r['id']==args[3])
print(json.dumps({'ok':True,'data':run}))
`,
    { mode: 0o700 }
  );
  const collect = () =>
    promisify(execFile)(
      path.resolve('node_modules/.bin/xec'),
      [
        'postgres-switchover',
        'receipt',
        path.join(dir, 'spec'),
        '--binding',
        path.join(dir, 'binding'),
        '--stop',
        stop,
        '--evidence',
        wanted,
      ],
      { env: { ...process.env, PATH: [dir, path.dirname(process.execPath), process.env.PATH].join(path.delimiter) } }
    );
  const result = JSON.parse((await collect()).stdout);
  assert.equal(result.outcome, 'privately-promoted');
  assert.equal(result.clusters.postgres.candidate.privatePrimary.forkLsn, '0/30001E8');
  const different = structuredClone(all);
  different.promote.steps.at(-1).output = 'The registered source stop is different';
  await fs.writeFile(registered, JSON.stringify(different));
  await assert.rejects(collect(), /registered controller/);
  const invalid = structuredClone(all);
  const promoted = invalid.promote.steps.find((s) => s.name === names.promote);
  const claim = JSON.parse(promoted.output);
  claim.clusters.nominatim.privatePrimary.forkLsn = '0/3000170';
  promoted.output = JSON.stringify(claim);
  await assert.rejects(
    postgresSwitchoverDefinition('receipt', spec, binding, { stop, evidence: invalid }),
    /WAL witness/
  );
  const bad = structuredClone(evidence);
  bad.source.steps.find((s) => s.name === names.source).sourceHash = sha('echo self-reported fence');
  await assert.rejects(
    postgresSwitchoverDefinition('promote', spec, binding, { stop, evidence: bad }),
    /reviewed command/
  );
  await assert.rejects(
    postgresSwitchoverDefinition('promote', spec, binding, { stop: randomUUID(), evidence }),
    /receipt|reviewed command/i
  );
  await assert.rejects(
    postgresSwitchoverDefinition('replay', spec, binding, { stop, evidence: { source: evidence.source } }),
    /prerequisite/
  );
  await assert.rejects(
    postgresSwitchoverDefinition('base', spec, {
      ...binding,
      candidates: { postgres: binding.candidates.postgres, nominatim: binding.candidates.postgres },
    }),
    /bindings/
  );
});

test('native evidence rejects a standby still at the start of the shutdown checkpoint', async () => {
  await promisify(execFile)('python3', ['-B', path.resolve('.xec/postgres-switchover/proof_test.py')]);
});
