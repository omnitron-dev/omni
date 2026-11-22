import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileScopeModule, replicaFileScope, serviceDataDefinition, serviceFileRows } from './service-data-preseed.js';

const script = new URL('../service-data-adopt/endpoint.py', import.meta.url);
const redisSource = new URL('../service-data-adopt/redis_aof.py', import.meta.url);
const validatorProfile = new URL('../service-data-adopt/validator.apparmor', import.meta.url);
const probeTool = new URL('../service-data-adopt/probe.py', import.meta.url);
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const ordered = (v) =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, ordered(v[k])])
        )
      : v;
const digest = (v) =>
  createHash('sha256')
    .update(JSON.stringify(ordered(v)))
    .digest('hex');
const pack = (v) => gzipSync(JSON.stringify(v), { level: 9 }).toString('base64');
const load = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);

async function adoptionWorker() {
  const [endpoint, redis] = await Promise.all([fs.readFile(script, 'utf8'), fs.readFile(redisSource)]);
  return (
    'import base64,gzip,sys,types\nredis=types.ModuleType("redis_aof");sys.modules[redis.__name__]=redis\nexec(compile(gzip.decompress(base64.b64decode("' +
    gzipSync(redis).toString('base64') +
    '")),"redis-aof","exec"),redis.__dict__)\n' +
    (await fileScopeModule()) +
    endpoint
  );
}

function mappedRoot(entries) {
  if (!Array.isArray(entries) || !entries.length || entries[0][0] !== 0 || entries[0][2] !== 1 || entries[0][1] === 0)
    return false;
  return entries.every(
    (row, i) =>
      Array.isArray(row) &&
      row.length === 3 &&
      row.every(Number.isSafeInteger) &&
      row[0] >= 0 &&
      row[1] > 0 &&
      row[2] > 0 &&
      row[0] + row[2] <= 0xffffffff &&
      row[1] + row[2] <= 0xffffffff &&
      entries
        .slice(0, i)
        .every((other) => [0, 1].every((j) => other[j] + other[2] <= row[j] || row[j] + row[2] <= other[j]))
  );
}

function checkedRun(evidence) {
  if (evidence && 'ok' in evidence) {
    if (evidence.ok !== true || !evidence.data) throw Error('Expected a successful Pipeline status response');
    evidence = evidence.data;
  }
  if (
    !evidence ||
    evidence.status !== 'success' ||
    !uuid(evidence.id) ||
    !hex(evidence.review?.digest) ||
    !Array.isArray(evidence.steps)
  )
    throw Error('Expected a completed evidence Pipeline');
  return evidence;
}

function checkedOutput(evidence, name, node) {
  const matches = evidence.steps.filter((s) => s.name === name);
  if (
    matches.length !== 1 ||
    matches[0].nodeId !== node ||
    matches[0].status !== 'success' ||
    matches[0].exitCode !== 0 ||
    matches[0].outputTruncated !== false
  )
    throw Error('Incomplete endpoint evidence');
  return matches[0].output;
}

export async function adoptionBinding(spec, evidence, { postgresReplicas = false } = {}) {
  if (typeof postgresReplicas !== 'boolean') throw Error('Invalid PostgreSQL replica file scope');
  await serviceDataDefinition('status', spec);
  evidence = checkedRun(evidence);
  const { maps: donor } = JSON.parse(checkedOutput(evidence, 'source-volume-namespace', spec.sourceNode)),
    target = JSON.parse(checkedOutput(evidence, 'target-engine-namespace', spec.receiverNode));
  const names = spec.volumes.map((r) => r.tag).sort();
  if (
    Object.keys(donor).sort().join() !== names.join() ||
    !Object.values(donor).every((m) =>
      ['uid_map', 'gid_map'].every((k) => JSON.stringify(m[k]) === '[[0,0,4294967295]]')
    )
  )
    throw Error('This restore requires identity mapping for every donor volume');
  if (
    !Number.isSafeInteger(target.daemonPid) ||
    target.daemonPid <= 1 ||
    !['uid_map', 'gid_map'].every((k) => mappedRoot(target.maps?.[k])) ||
    target.daemonUid !== target.maps.uid_map[0][1]
  )
    throw Error('Invalid rootless engine identity or mappings');
  return {
    schema: 1,
    seed: spec.id,
    spec: digest(spec),
    evidence: evidence.id,
    review: evidence.review.digest,
    donorMaps: donor,
    enginePid: target.daemonPid,
    maps: target.maps,
    ...(postgresReplicas && { fileScope: replicaFileScope }),
    volumes: Object.fromEntries(serviceFileRows(spec, postgresReplicas).map((r) => [r.tag, r.volume])),
  };
}

export function seedBootstrap(spec, raw, side = 'receiver') {
  const run = checkedRun(raw),
    node = spec[side + 'Node'],
    parts = run.steps.filter((s) => /^helper-part-[0-9]+$/.test(s.name));
  if (!parts.length || parts.length > 24) throw Error('Incomplete endpoint bootstrap parts');
  const steps = {};
  const step = (name) => {
    const output = checkedOutput(run, name, node);
    steps[name] = createHash('sha256').update(output).digest('hex');
    return JSON.parse(output);
  };
  const admission = step('bootstrap-' + side);
  if (
    admission.side !== side ||
    admission.spec !== digest(spec) ||
    (side === 'receiver' && admission.stage !== spec.stageParent + '/service-data-' + spec.id)
  )
    throw Error('Endpoint bootstrap belongs to another operation or stage');
  let helper;
  for (let i = 1; i <= parts.length; i++) {
    const r = step('helper-part-' + i);
    if (!hex(r.helperSha256) || r.part !== i || r.total !== parts.length || (helper && r.helperSha256 !== helper))
      throw Error('Endpoint bootstrap helper identity differs');
    helper = r.helperSha256;
  }
  return { id: run.id, review: run.review.digest, helper, steps };
}

const evidenceGate = `import base64,gzip,hashlib,json,subprocess,sys
b,s,boot=json.loads(gzip.decompress(base64.b64decode(sys.argv[1])))
def reviewed(run,digest):
    r=subprocess.run(['omnitron','--json','pipeline','status',run,'--output'],capture_output=True,timeout=60,check=True)
    v=json.loads(r.stdout); d=v.get('data',{})
    if not v.get('ok') or d.get('id')!=run or (d.get('review') or {}).get('digest')!=digest or d.get('status')!='success': sys.exit('Evidence review changed')
    return d
def checked(d,name,node):
    found=[p for p in d['steps'] if p['name']==name]
    if len(found)!=1 or found[0].get('nodeId')!=node or found[0].get('status')!='success' or found[0].get('exitCode')!=0 or found[0].get('outputTruncated') is not False: sys.exit('Incomplete reviewed namespace observation')
    return found[0]['output']
d=reviewed(b['evidence'],b['review'])
src=json.loads(checked(d,'source-volume-namespace',s['sourceNode'])); dst=json.loads(checked(d,'target-engine-namespace',s['receiverNode']))
if src['maps']!=b['donorMaps'] or dst['maps']!=b['maps'] or dst['daemonPid']!=b['enginePid'] or dst['daemonUid']!=b['maps']['uid_map'][0][1]: sys.exit('Declared namespace differs from the registered observation')
d=reviewed(boot['id'],boot['review'])
for name,sha in boot['steps'].items():
    if hashlib.sha256(checked(d,name,s['receiverNode']).encode()).hexdigest()!=sha: sys.exit('Registered seed bootstrap changed')
print('Registered namespace and sealed seed helper evidence matches.')`;

export async function adoptionDefinition(
  phase,
  spec,
  evidence,
  cold,
  sealed,
  bootstrap,
  { validatorApparmor = false, postgresReplicas = false } = {}
) {
  if (!['restore', 'verify'].includes(phase)) throw Error('Unknown service adoption phase');
  const binding = await adoptionBinding(spec, evidence, { postgresReplicas });
  const boot = seedBootstrap(spec, bootstrap);
  const sourceGraph = await serviceDataDefinition('seal', spec, { stop: cold.stop, receipt: cold, postgresReplicas });
  if (
    sealed.sealed !== true ||
    sealed.id !== spec.id ||
    sealed.spec !== binding.spec ||
    sealed.fileScope !== binding.fileScope ||
    sealed.stop !== cold.stop ||
    sealed.sha256 !== cold.sha256 ||
    sealed.stage !== spec.stageParent + '/service-data-' + spec.id
  )
    throw Error('A matching sealed cold receiver receipt is required');
  const helper = await adoptionWorker(),
    sha = createHash('sha256').update(helper).digest('hex');
  const loader =
    'import sys,gzip,base64,hashlib;h=sys.argv.pop(1);p=gzip.decompress(base64.b64decode(sys.argv.pop(1)));assert hashlib.sha256(p).hexdigest()==h;exec(compile(p,"service-adopt","exec"),{"__name__":"__main__","SELF":p,"__file__":"service-adopt"})';
  const profile = validatorApparmor
    ? createHash('sha256')
        .update(await fs.readFile(validatorProfile))
        .digest('hex')
    : null;
  const payload = pack([spec, binding, cold, sealed, boot.helper, profile]);
  const perform =
    '/usr/bin/python3 -I -c ' +
    quote(loader) +
    ' ' +
    [sha, gzipSync(helper, { level: 9 }).toString('base64'), phase, payload].map(quote).join(' ');
  const steps = [
    ...sourceGraph.steps.slice(0, 2),
    {
      name: 'namespace-evidence',
      dependsOn: ['confirm-stop'],
      retries: 0,
      timeout: 90000,
      run:
        '/usr/bin/python3 -I -c ' +
        quote(evidenceGate) +
        ' ' +
        pack([binding, { sourceNode: spec.sourceNode, receiverNode: spec.receiverNode }, boot]),
    },
    {
      name: phase,
      nodeId: spec.receiverNode,
      dependsOn: ['namespace-evidence'],
      retries: 0,
      timeout: 86400000,
      run: perform,
    },
    { ...sourceGraph.steps.at(-1), dependsOn: [phase] },
  ];
  if (steps.some((s) => Buffer.byteLength(s.run) > 22 * 1024))
    throw Error('Rootless restore exceeds the bounded SSH management command size');
  return {
    name: 'service-data-adopt-' + spec.id + '-' + phase + (postgresReplicas ? '-files' : ''),
    description: 'Restore sealed service data into fresh, unattached rootless Docker volumes.',
    triggers: [{ type: 'manual', config: {} }],
    steps,
  };
}

export async function imageProbeDefinition(spec, evidence) {
  const binding = await adoptionBinding(spec, evidence);
  const row = spec.volumes.find((r) => r.tag === 'postgres-data');
  const receiver = {
    node: spec.receiverNode,
    fingerprint: spec.receiverFingerprint,
    engine: { enginePid: binding.enginePid, maps: binding.maps },
    image: row.image,
    dataTarget: row.target,
    observation: binding.evidence,
    review: binding.review,
  };
  const pin = `import base64,gzip,json,subprocess,sys
a=json.loads(gzip.decompress(base64.b64decode(sys.argv[1])))
def call(*v):
    r=subprocess.run(['omnitron','--json',*v],capture_output=True,timeout=60,check=True)
    x=json.loads(r.stdout)
    if x.get('ok') is not True: sys.exit('Receiver registration inspection failed')
    return x['data']
k=call('node','ssh-key',a['node'])
if k.get('nodeId')!=a['node'] or k.get('observed')!=a['fingerprint'] or k.get('trusted')!=a['fingerprint']: sys.exit('Receiver SSH pin changed')
r=call('pipeline','status',a['observation'],'--output')
if r.get('id')!=a['observation'] or r.get('status')!='success' or (r.get('review') or {}).get('digest')!=a['review']: sys.exit('Namespace evidence changed')
s=[s for s in r['steps'] if s['name']=='target-engine-namespace']
if len(s)!=1 or s[0].get('nodeId')!=a['node'] or s[0].get('status')!='success' or s[0].get('exitCode')!=0 or s[0].get('outputTruncated') is not False:sys.exit('Invalid registered rootless evidence')
v=json.loads(s[0]['output'])
if v.get('daemonPid')!=a['engine']['enginePid'] or v.get('maps')!=a['engine']['maps'] or v.get('daemonUid')!=a['engine']['maps']['uid_map'][0][1]:sys.exit('Registered engine differs')
print('Receiver SSH and rootless namespace registration match.')`;
  const loader = `import base64,gzip,hashlib,json,sys
p=gzip.decompress(base64.b64decode(sys.argv[2],validate=True))
if hashlib.sha256(p).hexdigest()!=sys.argv[1]:sys.exit('Probe payload digest differs')
e,t,a=json.loads(p);m={'__name__':'checked_adoption_tools','__file__':'checked_adoption_tools'}
exec(compile(e,'checked-adoption','exec'),m)
scope={'__name__':'checked_image_probe'}
exec(compile(t,'checked-image-probe','exec'),scope)
sys.exit(scope['probe'](a,m['engine_identity']))`;
  const source = Buffer.from(
    JSON.stringify([await fs.readFile(script, 'utf8'), await fs.readFile(probeTool, 'utf8'), receiver])
  );
  const target =
    '/usr/bin/python3 -I -c ' +
    quote(loader) +
    ' ' +
    createHash('sha256').update(source).digest('hex') +
    ' ' +
    gzipSync(source, { level: 9 }).toString('base64');
  if (Buffer.byteLength(target) > 22 * 1024) throw Error('Image-only probe exceeds the SSH management budget');
  return {
    name: 'service-data-adopt-' + spec.id + '-image-probe',
    description:
      'Check the pinned PostgreSQL image on the registered rootless engine using an empty synthetic filesystem.',
    triggers: [{ type: 'manual', config: {} }],
    steps: [
      {
        name: 'receiver-registration',
        retries: 0,
        timeout: 150000,
        run: '/usr/bin/python3 -I -c ' + quote(pin) + ' ' + pack(receiver),
      },
      {
        name: 'image-only-probe',
        nodeId: spec.receiverNode,
        dependsOn: ['receiver-registration'],
        retries: 0,
        timeout: 240000,
        run: target,
      },
    ],
  };
}

export function command(program) {
  const entry = program
    .command('service-data-adopt')
    .description('Restore sealed service volumes at their container UID/GID and ACL identities');
  const print = (value) =>
    new Promise((resolve, reject) =>
      process.stdout.write(JSON.stringify(value, null, 2) + '\n', (e) => (e ? reject(e) : resolve()))
    );
  entry
    .command('probe <spec>')
    .requiredOption('--namespaces <file>', 'Completed receiver engine observation')
    .action(async (file, o) => print(await imageProbeDefinition(await load(file), await load(o.namespaces))));
  entry
    .command('binding <spec>')
    .requiredOption('--namespaces <file>', 'Completed namespace observation run')
    .option('--postgres-replicas', 'Reserve only flatnode, merged, Redis and MinIO volumes')
    .action(async (file, o) => {
      const binding = await adoptionBinding(await load(file), await load(o.namespaces), {
        postgresReplicas: Boolean(o.postgresReplicas),
      });
      await print({ binding, sha256: digest(binding) });
    });
  for (const phase of ['restore', 'verify'])
    entry
      .command(phase + ' <spec>')
      .requiredOption('--namespaces <file>', 'Completed namespace observation run')
      .requiredOption('--cold <file>', 'Fenced source cold receipt')
      .requiredOption('--bootstrap <file>', 'Completed receiver bootstrap Pipeline status')
      .requiredOption('--seal <file>', 'Sealed target receipt')
      .option('--postgres-replicas', 'Restore or verify only flatnode, merged, Redis and MinIO volumes')
      .option('--validator-apparmor', 'Use the independently admitted, enforcing read-only validator profile')
      .action(async (file, o) =>
        print(
          await adoptionDefinition(
            phase,
            await load(file),
            await load(o.namespaces),
            await load(o.cold),
            await load(o.seal),
            await load(o.bootstrap),
            { validatorApparmor: Boolean(o.validatorApparmor), postgresReplicas: Boolean(o.postgresReplicas) }
          )
        )
      );
}
