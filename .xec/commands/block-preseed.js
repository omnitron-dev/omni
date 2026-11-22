import fs from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const helper = new URL('../block-preseed/endpoint.py', import.meta.url);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const pin = /^SHA256:[A-Za-z0-9+/]{43}$/;
const node = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const fields = ['id', 'sourceNode', 'sourceFingerprint', 'sourceIp', 'blocks', 'firstActive', 'receiverNode',
  'receiverFingerprint', 'receiverIp', 'receiverPort', 'stageParent', 'rateKiB', 'ttlMinutes'];
const bounded = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const unicast = value => typeof value === 'string' && isIPv4(value) && value !== '0.0.0.0' &&
  value !== '255.255.255.255' && !value.startsWith('127.') && !(Number(value.split('.')[0]) >= 224 && Number(value.split('.')[0]) <= 239);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
const directory = value => typeof value === 'string' && /^\/[A-Za-z0-9_. /-]{1,1023}$/.test(value) &&
  value === path.posix.resolve(value) && value !== '/';

export function validEndpoints(spec) {
  return spec && uuid.test(spec.id) && !(
      ![spec.sourceNode, spec.receiverNode].every(id => typeof id === 'string' && node.test(id) && id !== 'local') ||
      spec.sourceNode === spec.receiverNode || ![spec.sourceFingerprint, spec.receiverFingerprint].every(x => typeof x === 'string' && pin.test(x)) ||
      spec.sourceFingerprint === spec.receiverFingerprint || ![spec.sourceIp, spec.receiverIp].every(unicast) ||
      spec.sourceIp === spec.receiverIp || !directory(spec.stageParent) || !bounded(spec.receiverPort, 1, 65535) ||
      !bounded(spec.ttlMinutes, 1, 1440));
}

export function validateSpec(spec) {
  if (!validEndpoints(spec) || Object.keys(spec).sort().join() !== [...fields].sort().join() || !directory(spec.blocks) ||
      path.posix.basename(spec.blocks) !== 'blocks' || !bounded(spec.firstActive, 1, 99999) || !bounded(spec.rateKiB, 1, 1048576))
    throw Error('Invalid block preseed specification. Supply distinct registered nodes, pinned IPv4 endpoints, absolute directories and bounded integers.');
}

function publicOffer(value, spec) {
  const keys = ['protocol', 'id', 'spec', 'publicKey', 'manifest', 'files', 'bytes', 'issued', 'expires'];
  if (!value || Object.keys(value).sort().join() !== keys.sort().join() || value.protocol !== 1 || value.id !== spec.id ||
      ![value.spec, value.manifest].every(x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) ||
      !/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(value.publicKey) ||
      !bounded(value.files, 2, 200000) || !bounded(value.bytes, 1, Number.MAX_SAFE_INTEGER) ||
      !Number.isSafeInteger(value.issued) || value.expires !== value.issued + spec.ttlMinutes * 60)
    throw Error('A public offer from the source step of this operation is required.');
  return value;
}

// Old daemons resolve shell targets through the existing node registry. Repeat the explicit pin check
// inside each reviewed graph, before any privileged endpoint step can run.
const inspectPins = `import base64,json,subprocess,sys
s=json.loads(base64.b64decode(sys.argv[1]))
for side in ('source','receiver'):
    node=s[side+'Node']; expected=s[side+'Fingerprint']
    p=subprocess.run(['omnitron','--json','node','ssh-key',node],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
    if p.returncode: raise SystemExit('registered SSH host inspection failed')
    r=json.loads(p.stdout); h=r.get('data',{})
    if r.get('ok') is not True or h.get('nodeId')!=node or h.get('observed')!=expected or h.get('trusted')!=expected:
        raise SystemExit('registered SSH fingerprint differs from review')
print('Both registered SSH identities match the review.')`;

export async function blockPreseedDefinition(phase, spec, offer) {
  validateSpec(spec);
  if (!['offer', 'copy', 'accept', 'revoke'].includes(phase)) throw Error('Use offer, copy, accept or revoke.');
  const value = ['copy', 'accept'].includes(phase) ? publicOffer(offer, spec) : null;
  const source = await fs.readFile(helper, 'utf8');
  if (phase === 'accept') {
    const packed = gzipSync(source).toString('base64');
    const loader = 'import base64,gzip;s=gzip.decompress(base64.b64decode("' + packed + '")).decode();' +
      'exec(compile(s,"block-preseed","exec"),{"__name__":"__main__","SELF":s})';
    const run = (...args) => '/usr/bin/python3 -I -c ' + quote(loader) + ' ' + args.map(quote).join(' ');
    const graph = preseedGraph(phase, spec, value, run, 'block-preseed', 'Seal the completed reviewed public block transfer.');
    if (graph.steps.some(step => Buffer.byteLength(step.run) > 22 * 1024)) throw Error('Block acceptance exceeds the SSH management command budget.');
    return graph;
  }
  return preseedGraph(phase, spec, value, source, 'block-preseed', 'Direct transfer of reviewed closed public block and undo segments.');
}

export function registeredPinsStep(spec) {
  return { name: 'registered-pins', run: 'python3 -I -c ' + quote(inspectPins) + ' ' + encode(spec), timeout: 90000 };
}

export function preseedGraph(phase, spec, offer, program, name, description, tool) {
  const loader = 'import sys; s=sys.stdin.read(); exec(compile(s,"block-preseed","exec"),{"__name__":"__main__","SELF":s})';
  const endpoint = (name, role, dependsOn) => ({
    name, nodeId: spec[role + 'Node'], ...(dependsOn && { dependsOn }), retries: 0, timeout: 86400000,
    run: typeof program === 'function' ? program(name, encode(spec), encode(offer)) :
      'python3 -I -c ' + quote(loader) + ' ' + name + ' ' + encode(spec) + ' ' +
        encode(offer) + " <<'OMNITRON_PRESEED_PY'\n" + program + '\nOMNITRON_PRESEED_PY',
  });
  const steps = [registeredPinsStep(spec)];
  for (const part of tool || []) steps.push({ ...part, nodeId: spec[(phase === 'offer' ? 'source' : 'receiver') + 'Node'],
    retries: 0, timeout: 120000, dependsOn: [steps.at(-1).name] });
  const checked = [tool ? 'checked-helper' : 'registered-pins'];
  if (phase === 'offer') steps.push(endpoint('offer', 'source', checked));
  if (phase === 'copy') steps.push(endpoint('grant', 'receiver', checked), endpoint('send', 'source', ['grant']),
    endpoint('seal', 'receiver', ['send']), endpoint('forget', 'source', ['seal']));
  if (phase === 'accept') steps.push(endpoint('seal', 'receiver', checked), endpoint('forget', 'source', ['seal']));
  if (phase === 'revoke') steps.push(endpoint('revoke', 'receiver', ['registered-pins']), endpoint('forget', 'source', ['registered-pins']));
  return { name: name + '-' + spec.id + '-' + phase, description,
    triggers: [{ type: 'manual', config: {} }], steps };
}

export function command(program) {
  program.command('block-preseed <phase> <spec>').description('Export a reviewed node-to-node block preseed pipeline as JSON')
    .option('--offer <file>', 'Public JSON receipt printed by the source offer step')
    .allowExcessArguments(false).action(async (phase, file, options) => {
      if (Boolean(options.offer) !== ['copy', 'accept'].includes(phase)) throw Error('Copy and accept require --offer.');
      const read = async name => {
        const contents = await fs.readFile(name, 'utf8');
        try { return JSON.parse(contents); } catch { throw Error('Invalid preseed input JSON.'); }
      };
      const definition = await blockPreseedDefinition(phase, await read(file), options.offer && await read(options.offer));
      await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(definition, null, 2) + '\n',
        error => error ? reject(error) : resolve()));
    });
}
