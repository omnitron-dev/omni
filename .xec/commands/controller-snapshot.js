import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { registeredPinsStep } from '../../apps/omnitron/data/operations/controller-inspection.js';
import { validEndpoints } from './block-preseed.js';
import { checkedRunner, installSteps } from './service-data-preseed.js';

const bytesSha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bounded = (v, l, h) => Number.isSafeInteger(v) && v >= l && v <= h;
const common = [
  'id',
  'sourceNode',
  'receiverNode',
  'sourceIp',
  'receiverIp',
  'sourceFingerprint',
  'receiverFingerprint',
  'receiverPort',
  'stageParent',
  'ttlMinutes',
  'rateKiB',
  'sourceUid',
  'ownerReceipt',
  'maxBytes',
  'sourceReserveBytes',
  'receiverReserveBytes',
];
const checkedKeys = (object, keys) => object && Object.keys(object).sort().join() === [...keys].sort().join();

// Specifications accept ASCII fields and safe integral limits. This is the endpoint's sorted compact JSON.
const canonical = (value) =>
  value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])])
      )
    : value;
export const snapshotSpecDigest = (spec) => bytesSha(JSON.stringify(canonical(spec)));

function validate(spec) {
  if (
    !validEndpoints(spec) ||
    !checkedKeys(spec, spec.restore ? [...common, 'restore'] : common) ||
    !/^\/(?:srv|var\/lib)\//.test(spec.stageParent) ||
    !/^\/(?:[a-zA-Z0-9_. -]+\/)+managed-owner\.json$/.test(spec.ownerReceipt) ||
    spec.ownerReceipt.split('/').some((part) => part === '.' || part === '..') ||
    !bounded(spec.sourceUid, 0, 2 ** 32 - 2) ||
    !bounded(spec.rateKiB, 1, 2 ** 20) ||
    !bounded(spec.maxBytes, 4096, 2 ** 40) ||
    ![spec.sourceReserveBytes, spec.receiverReserveBytes].every((v) => bounded(v, 1, 2 ** 48)) ||
    (spec.restore &&
      (!checkedKeys(spec.restore, ['id', 'sha256']) ||
        !uuid.test(spec.restore.id) ||
        spec.restore.id === spec.id ||
        !hash.test(spec.restore.sha256)))
  ) {
    throw Error(
      'Use the registered Linux endpoints, four-store controller limits and the native managed-owner receipt.'
    );
  }
}

async function program() {
  const modules = [
    ['omnitron_preseed_channel', '../block-preseed/endpoint.py'],
    ['controller_files', '../controller-snapshot/files.py'],
    ['controller_maintenance', '../controller-snapshot/maintenance.py'],
  ];
  const code = [
    'import base64,gzip,pathlib,sys,types',
    'SELF=globals().get("SELF") or pathlib.Path(__file__).read_text()',
  ];
  for (const [name, source] of modules) {
    const data = await fs.readFile(new URL(source, import.meta.url));
    code.push(
      'm=types.ModuleType(' + JSON.stringify(name) + ');sys.modules[m.__name__]=m',
      'exec(compile(gzip.decompress(base64.b64decode(' +
        JSON.stringify(gzipSync(data).toString('base64')) +
        ')),m.__name__,"exec"),m.__dict__)'
    );
  }
  code.push(await fs.readFile(new URL('../controller-snapshot/endpoint.py', import.meta.url), 'utf8'));
  return code.join('\n');
}

const actions = {
  offer: [['offer', 'source']],
  warm: [
    ['grant', 'receiver'],
    ['warm', 'source'],
  ],
  cold: [
    ['grant', 'receiver'],
    ['cold', 'source'],
    ['seal', 'receiver'],
    ['forget', 'source'],
  ],
  accept: [
    ['seal', 'receiver'],
    ['forget', 'source'],
  ],
  restore: [
    ['grant', 'receiver'],
    ['export', 'receiver'],
    ['restore', 'source'],
    ['revoke', 'receiver'],
    ['forget', 'source'],
  ],
  release: [['release', 'source']],
  revoke: [
    ['revoke', 'receiver'],
    ['forget', 'source'],
  ],
};

function publicOffer(spec, offer) {
  if (
    !checkedKeys(offer, ['protocol', 'id', 'format', 'spec', 'manifest', 'issued', 'expires', 'publicKey']) ||
    offer.protocol !== 1 ||
    offer.id !== spec.id ||
    offer.format !== 'omnitron-controller-sqlite-v1' ||
    offer.spec !== snapshotSpecDigest(spec) ||
    !hash.test(offer.manifest) ||
    !Number.isSafeInteger(offer.issued) ||
    offer.expires !== offer.issued + spec.ttlMinutes * 60 ||
    !/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(offer.publicKey)
  ) {
    throw Error('Invalid public controller snapshot offer.');
  }
}

export function snapshotConsent(side, spec, expires, offer) {
  validate(spec);
  const now = Math.floor(Date.now() / 1000);
  if (
    !['source', 'receiver'].includes(side) ||
    !bounded(expires, now + 1, now + 60 * spec.ttlMinutes) ||
    (side === 'receiver') !== Boolean(offer)
  )
    throw Error('A local role, future lease and receiver-specific public key are required.');
  if (offer) {
    publicOffer(spec, offer);
    if (offer.expires <= now) throw Error('The source offer has expired.');
  }
  return { schema: 1, side, spec: snapshotSpecDigest(spec), expires, ...(offer && { key: offer.publicKey }) };
}

export async function controllerSnapshotDefinition(phase, spec, offer) {
  validate(spec);
  const active = ['warm', 'cold', 'accept', 'restore'].includes(phase);
  if (
    !Object.hasOwn(actions, phase) ||
    (spec.restore ? ['warm', 'cold', 'accept'] : ['restore', 'release']).includes(phase) ||
    active !== Boolean(offer)
  )
    throw Error('Use a separate restore specification and the original public offer for data actions.');
  if (offer) publicOffer(spec, offer);
  const text = await program(),
    sha = bytesSha(text);
  const installer = await fs.readFile(new URL('../service-data-preseed/install.py', import.meta.url), 'utf8');
  const steps = [registeredPinsStep(spec)];
  const installed = new Set();
  // Each action can be recovered independently, including acceptance after an acknowledgement loss.
  for (const [action, side] of actions[phase]) {
    if (!installed.has(side)) {
      for (const [i, part] of installSteps(installer, text, spec, side).entries()) {
        steps.push({
          name: side + '-helper-' + (i + 1),
          nodeId: spec[side + 'Node'],
          dependsOn: [steps.at(-1).name],
          retries: 0,
          timeout: 120000,
          run: part.run,
        });
      }
      installed.add(side);
    }
    steps.push({
      name: action,
      nodeId: spec[side + 'Node'],
      dependsOn: [steps.at(-1).name],
      retries: 0,
      timeout: 86400000,
      run:
        '/usr/bin/python3 -I -c ' +
        quote(checkedRunner) +
        ' ' +
        [sha, action, encode(spec), encode(offer ?? null)].map(quote).join(' '),
    });
  }
  if (steps.some((s) => Buffer.byteLength(s.run) > 22 * 1024))
    throw Error('Controller snapshot exceeds the bounded management transport.');
  return { name: 'controller-snapshot-' + spec.id + '-' + phase, triggers: [{ type: 'manual', config: {} }], steps };
}

export function command(program) {
  program
    .command('controller-snapshot <phase> <spec>')
    .description('Export a private controller SQLite capture or independently admitted recovery')
    .option('--offer <file>', 'Original public source offer for this operation')
    .option('--side <role>', 'Local role for consent: source or receiver')
    .option('--expires <epoch>', 'Local consent expiration, in Unix seconds')
    .allowExcessArguments(false)
    .action(async (phase, spec, options) => {
      const load = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
      const input = await load(spec);
      const offer = options.offer && (await load(options.offer));
      if (phase !== 'consent' && (options.side || options.expires))
        throw Error('Local consent options apply only to consent.');
      const result =
        phase === 'consent'
          ? snapshotConsent(options.side, input, Number(options.expires), offer)
          : await controllerSnapshotDefinition(phase, input, offer);
      await new Promise((resolve, reject) =>
        process.stdout.write(JSON.stringify(result, null, 2) + '\n', (e) => (e ? reject(e) : resolve()))
      );
    });
}
