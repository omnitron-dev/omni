import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registeredPinsStep } from '../commands/block-preseed.js';

const sha = (input) => createHash('sha256').update(input).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const role = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(value);
const named = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(value);
const absolute = (value) =>
  typeof value === 'string' &&
  value !== '/' &&
  value.startsWith('/') &&
  /^[A-Za-z0-9/_.-]{2,500}$/.test(value) &&
  path.posix.normalize(value) === value &&
  !value.endsWith('/');
const fields = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).toSorted().join(',') === keys.split(' ').toSorted().join(',');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const wire = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const fail = (message) => {
  throw Error(message);
};

function reference(record) {
  return (
    fields(record, 'run pipeline review revision step sourceHash outputSha256') &&
    uuid(record.run) &&
    uuid(record.pipeline) &&
    named(record.step) &&
    [record.review, record.revision, record.sourceHash, record.outputSha256].every(hash)
  );
}

export function checkedActivation(bytes, expected, now = Date.now()) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 32 * 1024 || sha(bytes) !== expected)
    fail('Select the independently reviewed activation request');
  const s = JSON.parse(bytes);
  if (
    !fields(
      s,
      'protocol project stack sourceNode sourceFingerprint receiverNode receiverFingerprint owner nodeStop order role expires created declarationSha256 passive custody handback'
    ) ||
    s.protocol !== 1 ||
    ![s.project, s.stack, s.role].every(role) ||
    ![s.sourceNode, s.receiverNode].every(named) ||
    s.sourceNode === s.receiverNode ||
    [s.sourceNode, s.receiverNode].includes('local') ||
    ![s.sourceFingerprint, s.receiverFingerprint].every((pin) => /^SHA256:[A-Za-z0-9+/]{43}$/.test(pin)) ||
    s.sourceFingerprint === s.receiverFingerprint ||
    !uuid(s.nodeStop) ||
    !hash(s.declarationSha256) ||
    !Number.isSafeInteger(s.expires) ||
    s.expires <= Math.floor(now / 1000) ||
    s.expires > Math.floor(now / 1000) + 900 ||
    !Array.isArray(s.order) ||
    !s.order.length ||
    s.order.length > 32 ||
    !s.order.every(role) ||
    new Set(s.order).size !== s.order.length ||
    !s.order.includes(s.role) ||
    !fields(s.created, s.order.join(' ')) ||
    !Object.values(s.created).every(hash) ||
    new Set(Object.values(s.created)).size !== s.order.length
  )
    fail('Activation requires one exact role, a complete passive inventory and a current operator window');
  const o = s.owner;
  if (
    !fields(
      o,
      'uid home runtime nodeSha256 socket helper helperManifest directory declarationFile declarationFileSha256 seal'
    ) ||
    !Number.isSafeInteger(o.uid) ||
    o.uid < 0 ||
    ![o.home, o.helper, o.directory, o.declarationFile, o.socket].every(absolute) ||
    ![o.runtime, o.nodeSha256, o.helperManifest, o.declarationFileSha256, o.seal].every(hash) ||
    !(
      (o.socket === '/run/docker.sock' && o.uid === 0) ||
      (o.uid > 0 && o.socket === '/run/user/' + o.uid + '/docker.sock')
    )
  )
    fail('Select the original owner, local Docker socket, public helper and private source seal');
  const h = s.handback;
  if (
    !reference(s.passive) ||
    !reference(s.custody) ||
    !fields(h, 'mode record params') ||
    !reference(h.record) ||
    new Set([s.passive.run, s.custody.run, h.record.run]).size !== 3 ||
    !['unchanged', 'restored'].includes(h.mode)
  )
    fail('Select separate registered creation, custody and return receipts');
  const a = h.params,
    unchanged = h.mode === 'unchanged';
  if (
    !fields(a, 'expires baseline stopId placementReview returnDataReview' + (unchanged ? ' release prepared' : '')) ||
    !Number.isSafeInteger(a.expires) ||
    !uuid(a.stopId) ||
    ![a.baseline, a.placementReview, a.returnDataReview].every(hash) ||
    (unchanged && (!named(a.release) || !hash(a.prepared))) ||
    h.record.step !== (unchanged ? 'recheck-original-allocation' : 'commit-native-return')
  )
    fail('Select the original public parameters from the admitted return');
  return s;
}

// The remote launcher verifies the original Node executable in its owner's immutable directory before running any JS.
const launch = `import hashlib,os,pathlib,stat,sys
node=pathlib.Path(sys.argv[1]);uid=int(sys.argv[2]);st=node.lstat()
if os.geteuid()!=uid or node.resolve()!=node or not stat.S_ISREG(st.st_mode) or st.st_uid!=uid or st.st_mode&0o022:sys.exit('Original source runtime ownership differs')
h=hashlib.sha256()
with node.open('rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
if h.hexdigest()!=sys.argv[3]:sys.exit('Original source Node digest differs')
os.execve(node,[str(node),'--no-warnings','--input-type=module','-',sys.argv[4]],{'PATH':'/usr/bin:/bin','LANG':'C'})`;

export async function activationDefinition(bytes, expected, now) {
  const s = checkedActivation(bytes, expected, now);
  const [controller, worker] = await Promise.all(
    ['activation-controller.py', 'activation-source.mjs'].map((f) => fs.readFile(new URL(f, import.meta.url), 'utf8'))
  );
  const { passive, custody, handback, sourceFingerprint, receiverFingerprint, ...source } = s;
  source.passiveReview = passive.review;
  const check = 'python3 -I -c ' + quote(controller) + ' ' + quote(wire(s));
  const node = s.owner.home + '/runtime/releases/' + s.owner.runtime + '/node';
  const run =
    '/usr/bin/python3 -I -c ' +
    quote(launch) +
    ' ' +
    [node, String(s.owner.uid), s.owner.nodeSha256, wire(source)].map(quote).join(' ') +
    " <<'OMNITRON_RETAINED_START'\n" +
    worker +
    '\nOMNITRON_RETAINED_START';
  const pins = { sourceNode: s.sourceNode, receiverNode: s.receiverNode, sourceFingerprint, receiverFingerprint };
  const steps = [
    registeredPinsStep(pins),
    { name: 'verify-return-authority', dependsOn: ['registered-pins'], retries: 0, timeout: 120000, run: check },
    {
      name: 'start-retained-container',
      nodeId: s.sourceNode,
      dependsOn: ['verify-return-authority'],
      retries: 0,
      timeout: 300000,
      run,
    },
    {
      name: 'confirm-return-authority',
      dependsOn: ['start-retained-container'],
      retries: 0,
      timeout: 120000,
      run: check,
    },
  ];
  if (steps.some((step) => Buffer.byteLength(step.run) > 22 * 1024))
    fail('Activation exceeds the registered SSH management budget');
  return {
    name: 'Start retained ' + s.project + '/' + s.stack + '/' + s.role,
    description:
      'Start the exact passive object after registered source-return authority and an independent custody review.',
    steps,
  };
}
