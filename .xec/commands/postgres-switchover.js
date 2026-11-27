import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { ExecutionEngine, quoteForShell } from '@xec-sh/core';
import { serviceDataDefinition } from './service-data-preseed.js';
import { fullStopCommand } from '../../apps/omnitron/data/operations/controller-inspection.js';
import { pipelineShellReceipt } from '../../apps/omnitron/data/operations/pipeline-shell-receipt.js';

const phases = ['base', 'source', 'replay', 'promote'];
const predecessors = {
  base: [],
  source: [],
  replay: ['base', 'source'],
  promote: ['base', 'source', 'replay'],
  receipt: phases,
};
const names = {
  base: 'verify-native-bases',
  source: 'read-terminal-wal',
  replay: 'witness-standby-replay',
  promote: 'promote-private-standbys',
};
const sha = (value) => createHash('sha256').update(value).digest('hex');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const pack = (value) => gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }).toString('base64');
const load = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const hash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const uuid = (s) => typeof s === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s);
const keys = (o, wanted) =>
  o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...wanted].sort().join();
function ordered(value, cmp) {
  if (Array.isArray(value)) return value.map((x) => ordered(x, cmp));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(cmp)
      .map((k) => [k, ordered(value[k], cmp)])
  );
}
const digest = (v) => sha(JSON.stringify(ordered(v)));
const stepHashes = (step) => [
  sha(JSON.stringify(step)),
  sha(
    JSON.stringify(
      ordered(
        step,
        (a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b))
      )
    )
  ),
];

function validBinding(spec, binding) {
  if (
    !keys(binding, [
      'schema',
      'seed',
      'engineUid',
      'candidates',
      ...(binding?.apparmor === undefined ? [] : ['apparmor']),
    ]) ||
    (binding.apparmor !== undefined &&
      (!keys(binding.apparmor, ['name', 'sha256']) ||
        !/^omnitron-[a-z0-9-]{1,64}$/.test(binding.apparmor.name) ||
        !hash(binding.apparmor.sha256))) ||
    binding.schema !== 1 ||
    binding.seed !== spec.id ||
    !Number.isSafeInteger(binding.engineUid) ||
    binding.engineUid <= 0 ||
    binding.engineUid >= 0xffffffff ||
    !keys(binding.candidates, ['postgres', 'nominatim']) ||
    spec.volumes.length !== 6
  )
    return false;
  const seen = new Set();
  for (const row of Object.values(binding.candidates)) {
    if (
      !keys(row, ['container', 'volume', 'device', 'inode', 'socketDevice', 'socketInode']) ||
      !hash(row.container) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(row.volume) ||
      ![row.inode, row.device, row.socketDevice, row.socketInode].every(
        (s) => typeof s === 'string' && /^[1-9][0-9]{0,24}$/.test(s)
      )
    )
      return false;
    for (const key of [
      'c:' + row.container,
      'v:' + row.volume,
      'i:' + row.device + ':' + row.inode,
      'i:' + row.socketDevice + ':' + row.socketInode,
    ]) {
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

const wal = (s) => typeof s === 'string' && /^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/.test(s);
const timeline = (t) => Number.isSafeInteger(t) && t > 0 && t <= 0xffffffff;
const position = (s) => {
  const [high, low] = s.split('/');
  return (BigInt('0x' + high) << 32n) | BigInt('0x' + low);
};
function clusterWitness(phase, name, record, spec, binding, prior) {
  const major = name === 'postgres' ? 17 : 14;
  const source = spec.volumes.find((r) => r.tag === name + '-data');
  const physical = phase === 'source' ? source : binding.candidates[name];
  if (
    !record ||
    record.major !== major ||
    record.systemIdentifier !== spec.clusters[name] ||
    record.image !== source.image ||
    !['volume', 'device', 'inode'].every((key) => record[key] === physical[key])
  )
    return false;
  const fixed = ['major', 'systemIdentifier', 'image', 'volume', 'device', 'inode'];
  if (phase === 'source') {
    if (
      !keys(record, [
        ...fixed,
        'timeline',
        'shutdownCheckpointLsn',
        'writerFence',
        ...(major === 14 ? ['importFinished'] : []),
      ]) ||
      !timeline(record.timeline) ||
      !wal(record.shutdownCheckpointLsn) ||
      record.writerFence !== 'immutable-pgdata'
    )
      return false;
    const marker = record.importFinished;
    return (
      major === 17 ||
      (keys(marker, ['sha256', 'bytes', 'mtimeNs']) &&
        hash(marker.sha256) &&
        Number.isSafeInteger(marker.bytes) &&
        marker.bytes >= 0 &&
        marker.bytes <= 1024 ** 2 &&
        /^-?[0-9]+$/.test(marker.mtimeNs))
    );
  }
  fixed.push('container', 'manifestSha256');
  if (record.container !== physical.container || !hash(record.manifestSha256)) return false;
  if (phase === 'base') return keys(record, fixed);
  fixed.push('terminal', 'sourceTimeline', 'standby');
  const base = prior.base.clusters[name],
    terminal = prior.source.clusters[name],
    standby = record.standby;
  if (
    record.manifestSha256 !== base.manifestSha256 ||
    record.terminal !== terminal.shutdownCheckpointLsn ||
    record.sourceTimeline !== terminal.timeline ||
    !keys(standby, ['systemIdentifier', 'timeline', 'lsn']) ||
    standby.systemIdentifier !== record.systemIdentifier ||
    standby.timeline !== record.sourceTimeline ||
    !wal(standby.lsn) ||
    position(standby.lsn) <= position(record.terminal)
  )
    return false;
  if (phase === 'replay') return keys(record, fixed);
  const child = record.privatePrimary;
  return (
    keys(record, [...fixed, 'privatePrimary']) &&
    digest(standby) === digest(prior.replay.clusters[name].standby) &&
    keys(child, ['systemIdentifier', 'timeline', 'lsn', 'forkLsn']) &&
    child.systemIdentifier === record.systemIdentifier &&
    timeline(child.timeline) &&
    child.timeline > standby.timeline &&
    wal(child.lsn) &&
    wal(child.forkLsn) &&
    position(standby.lsn) <= position(child.forkLsn) &&
    position(child.forkLsn) <= position(child.lsn)
  );
}

function receipt(phase, raw, graph, spec, binding, stop, prior) {
  const run = raw?.ok === true ? raw.data : raw;
  const attestation = pipelineShellReceipt(run);
  if (run.steps.length !== graph.steps.length)
    throw Error('A completed native PostgreSQL witness Pipeline is required');
  const steps = new Map(run.steps.map(step => [step.name, step]));
  for (const expected of graph.steps) {
    const s = steps.get(expected.name);
    if (!s || s.nodeId !== (expected.nodeId ?? 'local') || !stepHashes(expected).includes(s.sourceHash))
      throw Error('A native witness step, node or reviewed command differs');
  }
  const result = JSON.parse(steps.get(names[phase]).output);
  if (
    result.protocol !== 'omnitron.postgres-switchover/1' ||
    result.phase !== phase ||
    result.seed !== spec.id ||
    result.spec !== digest(spec) ||
    result.binding !== digest(binding) ||
    result.stop !== (phase === 'base' ? null : stop) ||
    !keys(result.clusters, ['postgres', 'nominatim'])
  )
    throw Error('Native receipt belongs to another switchover');
  if (!['postgres', 'nominatim'].every((s) => clusterWitness(phase, s, result.clusters[s], spec, binding, prior)))
    throw Error('Native PostgreSQL receipt has a different cluster, physical binding, backup or WAL witness');
  return { result, attestation };
}

const receiptArgs = id => ['--json', 'pipeline', 'status', id, '--shell-receipt'];

export async function postgresSwitchoverDefinition(phase, spec, binding, { stop, evidence = {} } = {}) {
  if (
    !(phases.includes(phase) || phase === 'receipt') ||
    !validBinding(spec, binding) ||
    (phase === 'base' ? stop !== undefined : !uuid(stop)) ||
    !keys(evidence, predecessors[phase])
  )
    throw Error('Invalid PostgreSQL stage, receiver bindings, source stop or prerequisite runs');
  spec = ordered(spec);
  binding = ordered(binding);
  const pins = (await serviceDataDefinition('status', spec)).steps[0];
  // Keep the full preseed specification validation and the existing registered SSH pin check.
  const [proof, worker] = await Promise.all([
    fs.readFile(new URL('../postgres-switchover/proof.py', import.meta.url)),
    fs.readFile(new URL('../postgres-switchover/endpoint.py', import.meta.url)),
  ]);
  const loader = `import sys,base64,gzip,types
p=types.ModuleType('pg_switch_proof');sys.modules[p.__name__]=p
exec(compile(gzip.decompress(base64.b64decode('${gzipSync(proof).toString('base64')}')),'pg-switch-proof','exec'),p.__dict__)
exec(compile(gzip.decompress(base64.b64decode('${gzipSync(worker).toString('base64')}')),'pg-switch-endpoint','exec'),{'__name__':'__main__'})`;

  function graph(stage, results, attestations) {
    const steps = [pins];
    const local = (name, run, timeout = 90000) =>
      steps.push({ name, run, timeout, retries: 0, dependsOn: [steps.at(-1).name] });
    const native = (name, operation, site, inputs) => {
      const value = [spec, binding, digest(spec), digest(binding), stage === 'base' ? null : stop, inputs];
      steps.push({
        name,
        nodeId: spec[site + 'Node'],
        run: '/usr/bin/python3 -I -c ' + quote(loader) + ' ' + operation + ' ' + pack(value),
        timeout: stage === 'base' ? 86400000 : 600000,
        retries: 0,
        dependsOn: [steps.at(-1).name],
      });
    };
    const stopCheck = stage === 'base' ? undefined : fullStopCommand(spec, stop);
    if (stage !== 'base') local('confirm-full-source-stop', stopCheck);
    if (attestations.length) {
      local(
        'confirm-native-site-runs',
        attestations.map(({ id, digest }) =>
          ['omnitron', ...receiptArgs(id), digest].map(arg => quoteForShell(arg, 'posix')).join(' ')
        ).join(' && '),
        240000
      );
      native('confirm-source-fence', 'source', 'source', { source: results.source });
    }
    native(names[stage], stage, stage === 'source' ? 'source' : 'receiver', results);
    if (attestations.length) native('recheck-source-fence', 'source', 'source', { source: results.source });
    if (stage !== 'base') local('recheck-full-source-stop', stopCheck);
    if (steps.some((s) => Buffer.byteLength(s.run) > 22 * 1024))
      throw Error('PostgreSQL witness exceeds the bounded SSH command budget');
    return {
      name: 'postgres-switchover-' + spec.id + '-' + stage,
      description: 'Native physical PostgreSQL switchover under a registered source fence and isolated receiver.',
      triggers: [{ type: 'manual', config: {} }],
      steps,
    };
  }
  const checked = new Map();
  const make = (stage) => {
    const prior = predecessors[stage];
    return graph(
      stage,
      Object.fromEntries(prior.map((p) => [p, checked.get(p).result])),
      prior.map((p) => checked.get(p).attestation)
    );
  };
  for (const prior of predecessors[phase]) {
    const facts = Object.fromEntries(predecessors[prior].map((p) => [p, checked.get(p).result]));
    checked.set(prior, receipt(prior, evidence[prior], make(prior), spec, binding, stop, facts));
  }
  if (new Set([...checked.values()].map((p) => p.attestation.id)).size !== checked.size)
    throw Error('Distinct PostgreSQL witness runs are required');
  if (phase === 'receipt') {
    const registered = [...checked.values()].map((entry) => entry.attestation);
    const engine = new ExecutionEngine({ defaultShell: false, preferLocal: false, quiet: true, enableEvents: false, retry: { retries: 0 } });
    try {
      for (const expected of registered) {
        const reply = await engine.execute({ adapter: 'local', command: 'omnitron', args: receiptArgs(expected.id),
          shell: false, timeout: 60000, maxBuffer: 4096, nothrow: true });
        if (reply.exitCode !== 0) throw Error('Status failed');
        const { ok, data } = JSON.parse(reply.stdout);
        if (ok !== true || !keys(data, Object.keys(expected)) || data.protocol !== expected.protocol ||
            data.id !== expected.id || data.review !== expected.review || data.digest !== expected.digest) {
          throw Error('Registered shell receipt differs');
        }
      }
    } catch {
      throw Error('The registered controller did not confirm all four native PostgreSQL witness runs');
    } finally { await engine.dispose(); }
    const final = checked.get('promote').result;
    return {
      protocol: 'omnitron.postgres-private-promotion/1',
      seed: spec.id,
      stop,
      spec: digest(spec),
      binding: digest(binding),
      sourceNode: spec.sourceNode,
      receiverNode: spec.receiverNode,
      outcome: 'privately-promoted',
      runs: Object.fromEntries(
        [...checked].map(([stage, { attestation }]) => [stage, { id: attestation.id, review: attestation.review }])
      ),
      clusters: Object.fromEntries(
        Object.entries(final.clusters).map(([s, candidate]) => [
          s,
          {
            source: checked.get('source').result.clusters[s],
            candidate,
          },
        ])
      ),
    };
  }
  return make(phase);
}

export function command(program) {
  program
    .command('postgres-switchover <phase> <spec>')
    .description('Export base, source, replay, private promote, or collect the four registered receipts')
    .requiredOption('--binding <file>', 'Pinned private receiver container and physical volume bindings')
    .option('--stop <id>', 'Current full source stop for source, replay and promote')
    .option('--evidence <file>', 'Completed prerequisite Pipeline runs keyed by stage')
    .action(async (phase, file, o) => {
      const graph = await postgresSwitchoverDefinition(phase, await load(file), await load(o.binding), {
        stop: o.stop,
        evidence: o.evidence ? await load(o.evidence) : {},
      });
      await new Promise((resolve, reject) =>
        process.stdout.write(JSON.stringify(graph, null, 2) + '\n', (e) => (e ? reject(e) : resolve()))
      );
    });
}
