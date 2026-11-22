import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const name = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x) && !x.includes('..');
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const sha = x => createHash('sha256').update(x).digest('hex');
const pack = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";
const preparedFields = ['protocol', 'project', 'stack', 'release', 'manifestSha256', 'declarationsSha256', 'commit', 'nodeId', 'sshFingerprint', 'digest'];

export function allocationInput(record, bytes, options) {
  const prepared = record?.ok === true ? record.data : record;
  if (!prepared || Object.keys(prepared).sort().join() !== [...preparedFields].sort().join() || prepared.protocol !== 1 ||
      ![prepared.project, prepared.stack, prepared.release, prepared.nodeId, options.fromNode].every(name) ||
      options.fromNode === prepared.nodeId || [options.fromNode, prepared.nodeId].includes('local') ||
      ![prepared.manifestSha256, prepared.declarationsSha256, prepared.digest, options.backend, options.ownerArtifact].every(hash) ||
      prepared.digest !== options.expectPrepared || !/^[a-f0-9]{40}$/.test(prepared.commit) ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(prepared.sshFingerprint)) throw Error('Select the exact prepared source and distinct registered recipients');
  const uid = Number(options.uid);
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > 2147483647 || !/^[a-z_][a-z0-9_-]{0,31}$/.test(options.user) ||
      options.user === 'root') throw Error('Select the serving non-root system account and UID');
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024 || sha(bytes) !== prepared.declarationsSha256)
    throw Error('Producer declarations differ from the prepared receipt');
  const captured = JSON.parse(bytes);
  if (captured.protocol !== 1 || ['project', 'stack', 'release', 'commit', 'manifestSha256'].some(k => captured[k] !== prepared[k]))
    throw Error('Captured declarations identify another source');
  const stack = captured.config?.stacks?.[prepared.stack], input = captured.config?.apps;
  if (stack?.type !== 'remote' || stack.nodes?.length !== 1 || stack.nodes[0].nodeId !== prepared.nodeId ||
      !Array.isArray(input) || !input.length || input.length > 256) throw Error('Expected a single registered application placement');
  const names = input.map(a => a.name), nameset = new Set(names);
  if (nameset.size !== names.length || !names.every(name) || [stack.apps === 'all' ? undefined : stack.apps, stack.nodes[0].apps].some(value =>
    value !== undefined && (!Array.isArray(value) || [...value].sort().join() !== [...names].sort().join())))
    throw Error('The release must assign the complete unique application set to one recipient');
  const apps = input.map(a => {
    const deps = a.dependsOn ?? [];
    if (a.enabled === false || !Array.isArray(deps) || deps.some(d => !nameset.has(d)) || new Set(deps).size !== deps.length ||
        (a.releaseFrom ? a.bootstrap || a.script : !!a.bootstrap === !!a.script))
      throw Error('Incomplete application source declaration');
    const env = a.env ?? {}, nodeOptions = env.NODE_OPTIONS ?? '';
    if (typeof nodeOptions !== 'string' || (nodeOptions && (!/^--max-old-space-size=[1-9][0-9]{0,6}$/.test(nodeOptions) ||
        Number(nodeOptions.split('=')[1]) > 1048576)) || env.NODE_PATH || Object.keys(env).some(k => /^(LD_|DYLD_)/.test(k) && env[k]))
      throw Error('Unsupported application loader settings');
    if (a.releaseFrom && (Object.keys(a.releaseFrom).sort().join() !== 'app,manifestSha256,release' ||
        !name(a.releaseFrom.app) || !name(a.releaseFrom.release) || !hash(a.releaseFrom.manifestSha256)))
      throw Error('Invalid immutable producer reference');
    return { name: a.name, ...(a.releaseFrom ? { releaseFrom: a.releaseFrom } : { mode: a.bootstrap ? 'bootstrap' : 'script' }),
      ...(deps.length && { dependsOn: deps }), ...(nodeOptions && { nodeOptions }) };
  });
  const spec = { prepared: Object.fromEntries(preparedFields.map(k => [k, prepared[k]])), fromNode: options.fromNode,
    uid, user: options.user, backend: options.backend, ownerArtifact: options.ownerArtifact, apps };
  return { ...spec, ticket: sha(JSON.stringify(spec)) };
}

const admission = `import base64,json,subprocess,sys
s=json.loads(base64.urlsafe_b64decode(sys.argv[1]+'==='))
r=s['prepared']
def native(argv):
 p=subprocess.run(['omnitron','--json',*argv],capture_output=True,timeout=600)
 v=json.loads(p.stdout) if p.returncode==0 else {}
 if v.get('ok') is not True: raise SystemExit('Native controller admission failed')
 return v['data']
if native(['stack','check-release',r['project'],r['stack'],r['release'],'--prepared',r['digest']])!=r:
 raise SystemExit('Prepared source or recipient changed')
pin=native(['node','ssh-key',r['nodeId']])
if pin.get('nodeId')!=r['nodeId'] or any(pin.get(k)!=r['sshFingerprint'] for k in ('trusted','observed')):
 raise SystemExit('Registered receiver host key changed')
fleet=native(['node','list'])['nodes']
old=[n for n in fleet if n['id']==s['fromNode']]
new=[n for n in fleet if n['id']==r['nodeId']]
route=native(['stack','status',r['project'],r['stack']])['config']
nodes=route.get('nodes',[])
address=lambda n:(n['host'],n.get('daemonPort') or 9700)
if len(old)!=1 or len(new)!=1 or address(old[0])==address(new[0]) or route.get('type')!='remote' or len(nodes)!=1 or nodes[0].get('nodeId',s['fromNode'])!=s['fromNode'] or (nodes[0]['host'],nodes[0].get('port') or 9700)!=address(old[0]):
 raise SystemExit('The original registered placement must still be selected')
print(json.dumps({'prepared':r['digest'],'ticket':s['ticket'],'apps':len(s['apps'])}))`;

// Switch account before interpreting any receiver-managed code. Only public, projected
// deployment data is carried by the Pipeline. The installed artifact and home are fixed.
const start = `import base64,gzip,json,sys
b=json.loads(gzip.decompress(base64.b64decode(sys.argv[2])))
exec(compile(b['entry'],'passive-allocation','exec'),{'__name__':'__main__'})`;

export async function leaseScripts(project) {
  const { tsImport } = await import('tsx/esm/api');
  const { DEFAULT_LEASE_TIMING: timing, acquireScript, renewScript, releaseScript, guardScript } =
    await tsImport('../../apps/omnitron/src/services/node-deploy-lease.ts', import.meta.url);
  const token = 'f17a0000-0000-4000-a000-000000000000';
  const guarded = guardScript(timing, token, '/usr/bin/python3 -I "$PASSIVE_ENTRY" lower', 6 * 3600_000);
  const execution = /"id":"([0-9a-f]{8}-[0-9a-f-]{27})"/.exec(guarded)?.[1];
  if (!execution) throw Error('Unsupported native execution-guard record');
  return { acquire: acquireScript(timing, { token, holder: 'passive-allocation', stack: project, startedAt: 'PASSIVE-LEASE-DATE' }),
    renew: renewScript(timing, token), release: releaseScript(timing, token),
    guard: guarded.replaceAll(execution, 'f17a0000-0000-4000-a000-000000000001') };
}

export async function passiveAllocationDefinition(record, declarations, options) {
  const spec = allocationInput(record, declarations, options), wire = pack(spec);
  const [worker, entry, lease] = await Promise.all([
    fs.readFile(new URL('../passive-allocation/receiver.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../passive-allocation/entry.py', import.meta.url), 'utf8'),
    leaseScripts(spec.prepared.project + '/' + spec.prepared.stack),
  ]);
  const run = '/usr/bin/python3 -I -c ' + quote(start) + ' ' + wire + ' ' + gzipSync(JSON.stringify({ entry, worker, lease })).toString('base64');
  if (Buffer.byteLength(run) > 22 * 1024) throw Error('Allocation inventory exceeds the SSH management command budget');
  return { name: 'Prepare passive allocation ' + spec.ticket.slice(0, 16),
    description: 'Verify and register a frozen application allocation on an empty Linux recipient before changing placement.',
    steps: [
      { name: 'verify-original-placement', run: 'python3 -I -c ' + quote(admission) + ' ' + wire, retries: 0, timeout: 900000 },
      { name: 'prepare-passive-allocation', nodeId: spec.prepared.nodeId, dependsOn: ['verify-original-placement'], retries: 0,
        timeout: 21600000, run },
      { name: 'confirm-original-placement', dependsOn: ['prepare-passive-allocation'], retries: 0, timeout: 900000,
        run: 'python3 -I -c ' + quote(admission) + ' ' + wire },
    ] };
}

export function command(program) {
  program.command('passive-allocation <prepared> <declarations>').description('Export a Pipeline to prepare a disabled application allocation')
    .requiredOption('--expect-prepared <digest>', 'Reviewed prepare-release receipt digest')
    .requiredOption('--from-node <id>', 'Currently selected source registration')
    .requiredOption('--user <account>', 'Recipient daemon account')
    .requiredOption('--uid <number>', 'Recipient daemon numeric UID')
    .requiredOption('--backend <digest>', 'Serving sealed backend artifact on the recipient')
    .requiredOption('--owner-artifact <digest>', 'Sealed execution-owner artifact on the recipient')
    .allowExcessArguments(false).action(async (record, declarations, options) => {
      const graph = await passiveAllocationDefinition(JSON.parse(await fs.readFile(record, 'utf8')), await fs.readFile(declarations), options);
      process.stdout.write(JSON.stringify(graph, null, 2) + '\n');
    });
}
