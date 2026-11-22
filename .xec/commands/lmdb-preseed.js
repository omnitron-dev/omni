import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildHelper, sha } from '../lmdb-preseed/build.js';
import { preseedGraph, registeredPinsStep, validEndpoints } from './block-preseed.js';

const shared = new URL('../block-preseed/endpoint.py', import.meta.url);
const stream = new URL('../lmdb-preseed/stream.py', import.meta.url);
const installer = new URL('../lmdb-preseed/install.py', import.meta.url);
const format = 'monero-lmdb-compact-v1';
const hash = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const b64 = x => Buffer.from(x).toString('base64');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const range = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
const fields = ['id', 'sourceNode', 'receiverNode', 'sourceFingerprint', 'receiverFingerprint', 'sourceIp', 'receiverIp',
  'receiverPort', 'stageParent', 'rateKiB', 'ttlMinutes', 'lmdb', 'payload', 'nettype', 'machine', 'minimumHeight', 'maxBytes', 'helperSha256'];

function validate(spec) {
  if (!validEndpoints(spec) || Object.keys(spec).sort().join() !== [...fields].sort().join() || spec.payload !== format ||
      spec.nettype !== 'mainnet' || !['x86_64', 'aarch64'].includes(spec.machine) || !hash(spec.helperSha256) ||
      typeof spec.lmdb !== 'string' || !/^\/[A-Za-z0-9_. /-]{1,1023}$/.test(spec.lmdb) ||
      path.posix.resolve(spec.lmdb) !== spec.lmdb || path.posix.basename(spec.lmdb) !== 'lmdb' ||
      !range(spec.rateKiB, 1, 24576) || !range(spec.minimumHeight, 2, Number.MAX_SAFE_INTEGER) ||
      !range(spec.maxBytes, 4096, 16 * 1024 ** 4))
    throw Error('Invalid private mainnet LMDB specification or transfer bound.');
}

function validateOffer(spec, offer) {
  const fields = ['id', 'spec', 'protocol', 'publicKey', 'issued', 'expires', 'format', 'manifest', 'anchor', 'pollSeconds', 'sourceFreeFloorBytes'];
  const anchorFields = ['nettype', 'height', 'genesis', 'tip', 'checkpointHeight', 'checkpointHash'];
  if (!offer || Object.keys(offer).sort().join() !== fields.sort().join() || offer.id !== spec.id || offer.protocol !== 1 ||
      !hash(offer.spec) || !hash(offer.manifest) || offer.format !== format || !range(offer.issued, 1, Number.MAX_SAFE_INTEGER) ||
      offer.expires !== offer.issued + 60 * spec.ttlMinutes || offer.sourceFreeFloorBytes !== 8 * 1024 ** 3 || offer.pollSeconds !== 5 ||
      typeof offer.publicKey !== 'string' || !/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(offer.publicKey) ||
      !offer.anchor || Object.keys(offer.anchor).sort().join() !== anchorFields.sort().join() ||
      offer.anchor.nettype !== 'mainnet' || !range(offer.anchor.height, spec.minimumHeight, Number.MAX_SAFE_INTEGER) ||
      offer.anchor.checkpointHeight !== 1 || ![offer.anchor.genesis, offer.anchor.tip, offer.anchor.checkpointHash].every(hash))
    throw Error('Use the public offer from this private compact snapshot operation.');
}

// Each old CLI remote step is self-contained. The same restricted channel module runs on both
// endpoints, including when sshd starts the root-owned forced command outside a Python package.
const compressed = source => b64(gzipSync(source, { level: 9 }));
function embedChannel(source) {
  return 'import base64,gzip,sys,types\nch=types.ModuleType("omnitron_preseed_channel")\n' +
    'sys.modules[ch.__name__]=ch\nch.__dict__["SELF"]=globals().get("SELF")\n' +
    'exec(compile(gzip.decompress(base64.b64decode("' + compressed(source) + '")),"preseed-channel","exec"),ch.__dict__)\n';
}

function pythonCommand(source) {
  const loader = 'import base64,gzip;s=gzip.decompress(base64.b64decode("' + compressed(source) + '")).decode();' +
    'exec(compile(s,"private-preseed","exec"),{"__name__":"__main__","SELF":s})';
  return (...args) => '/usr/bin/python3 -I -c ' + quote(loader) + ' ' + args.map(quote).join(' ');
}

function helperSteps(binary, run, spec, phase) {
  const checked = [spec.machine, spec[(phase === 'offer' ? 'source' : 'receiver') + 'Fingerprint'], spec.helperSha256];
  const packed = gzipSync(binary, { level: 9 }), steps = [], digests = [];
  for (let offset = 0; offset < packed.length; offset += 6144) {
    const piece = packed.subarray(offset, offset + 6144), digest = sha(piece);
    digests.push(digest);
    steps.push({ name: 'helper-part-' + digests.length, run: run(...checked, 'part', digest, b64(piece)) });
  }
  steps.push({ name: 'checked-helper', run: run(...checked, 'finish', digests.join(',')) });
  return steps;
}

export async function lmdbDefinition(phase, spec, offer, binary) {
  validate(spec);
  if (!['offer', 'copy', 'accept', 'revoke'].includes(phase) || Boolean(offer) !== ['copy', 'accept'].includes(phase) || Boolean(binary) !== (phase !== 'revoke'))
    throw Error('Use the reviewed helper for offer/copy/accept and the original public offer for copy/accept.');
  if (offer) validateOffer(spec, offer);
  const channel = embedChannel(await fs.readFile(shared));
  let tool;
  if (binary) {
    const machine = spec.machine === 'x86_64' ? 62 : 183;
    if (binary.length < 64 || binary.length > 1024 * 1024 || !binary.subarray(0, 6).equals(Buffer.from([127, 69, 76, 70, 2, 1])) ||
        binary.readUInt16LE(18) !== machine || sha(binary) !== spec.helperSha256) throw Error('The reviewed Linux ELF helper differs from the specification.');
    tool = helperSteps(binary, pythonCommand(await fs.readFile(installer)), spec, phase);
  }
  const program = pythonCommand(channel + await fs.readFile(stream, 'utf8'));
  const graph = preseedGraph(phase, spec, offer ?? null, program, 'private-lmdb-preseed',
    'Private online Monero compact LMDB snapshot with independent offline chain acceptance.', tool);
  if (graph.steps.some(step => Buffer.byteLength(step.run) > 24 * 1024))
    throw Error('Snapshot step exceeds the bounded management command size.');
  return graph;
}

export async function preparedDataDefinition(spec, offer, seal, reserveBytes, status = false) {
  validate(spec);
  validateOffer(spec, offer);
  if (typeof status !== 'boolean' || !range(reserveBytes, 0, 16 * 1024 ** 4) || seal?.sealed !== true || seal.format !== format ||
      seal.manifest !== offer.manifest || !hash(seal.offer) || !hash(seal.sha256) ||
      seal.stage !== path.posix.join(spec.stageParent, 'block-preseed-' + spec.id) ||
      !range(seal.bytes, 1, spec.maxBytes) || !range(seal.database?.height, offer.anchor.height, Number.MAX_SAFE_INTEGER))
    throw Error('Use the successful seal from the receiver, the original offer and an explicit free-space reserve.');
  const source = embedChannel(await fs.readFile(shared)) +
    await fs.readFile(new URL('../lmdb-preseed/materialize.py', import.meta.url), 'utf8');
  const args = [spec, offer, seal, reserveBytes, status].map(value => b64(JSON.stringify(value)));
  const run = pythonCommand(source)(...args);
  if (Buffer.byteLength(run) > 24 * 1024) throw Error('Data preparation exceeds the management command size.');
  const phase = status ? 'inspect-preparation' : 'prepare-data';
  return {
    name: 'private-lmdb-preseed-' + spec.id + '-' + phase,
    description: status ? 'Inspect the existing Monero preparation and its durable receiver receipt.' :
      'Prepare an independent Monero data directory from the sealed receiver snapshot.',
    triggers: [{ type: 'manual', config: {} }],
    steps: [registeredPinsStep(spec), {
      name: phase, nodeId: spec.receiverNode, dependsOn: ['registered-pins'], retries: 0, timeout: status ? 60000 : 86400000, run,
    }],
  };
}

export async function daemonCheckDefinition(spec, release) {
  validate(spec);
  if (!release || Object.keys(release).sort().join() !== 'binary,gid,sha256,uid,user' ||
      typeof release.binary !== 'string' || !/^\/opt\/omnitron\/binaries\/monero\/\d+(?:\.\d+){2,3}\/monerod$/.test(release.binary) ||
      !hash(release.sha256) || typeof release.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,30}$/.test(release.user) ||
      !range(release.uid, 1, 0xfffffffe) || !range(release.gid, 1, 0xfffffffe))
    throw Error('Use a pinned monerod release and the non-root service user with its numeric UID and GID.');
  const probe = await fs.readFile(new URL('../lmdb-preseed/offline_probe.py', import.meta.url), 'utf8');
  const source = embedChannel(await fs.readFile(shared)) + 'OFFLINE_PROBE = ' + JSON.stringify(probe) + '\n' +
    await fs.readFile(new URL('../lmdb-preseed/qualify.py', import.meta.url), 'utf8');
  const run = pythonCommand(source)(...[spec, release].map(value => b64(JSON.stringify(value))));
  if (Buffer.byteLength(run) > 24 * 1024) throw Error('Offline qualification exceeds the management command size.');
  return {
    name: 'private-lmdb-preseed-' + spec.id + '-check-daemon',
    description: 'Open the prepared database with the official daemon in a loopback-only Linux service.',
    triggers: [{ type: 'manual', config: {} }],
    steps: [registeredPinsStep(spec), {
      name: 'check-daemon', nodeId: spec.receiverNode, dependsOn: ['registered-pins'], retries: 0, timeout: 600000, run,
    }],
  };
}

async function readJson(name) {
  const raw = await fs.readFile(name, 'utf8');
  try { return JSON.parse(raw); } catch { throw Error('Invalid snapshot input JSON.'); }
}

async function print(value) {
  await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value, null, 2) + '\n',
    error => error ? reject(error) : resolve()));
}

export function command(program) {
  const op = program.command('lmdb-preseed').description('Stage a private compact Monero LMDB snapshot between registered Linux nodes');
  op.command('build-helper <upstream> <output>').requiredOption('--machine <arch>', 'Linux glibc architecture, x86_64 or aarch64')
    .action(async (upstream, output, options) => print(await buildHelper(upstream, output, options.machine)));
  op.command('check-daemon <spec>').description('Check the prepared chain with the pinned daemon offline')
    .requiredOption('--release <file>', 'Installed binary, SHA-256 and declared service identity')
    .action(async (file, options) => print(await daemonCheckDefinition(await readJson(file), await readJson(options.release))));
  op.command('prepare-data <spec>').description('Prepare an independent data directory beside the sealed snapshot')
    .option('--status', 'Inspect the current receiver operation without acquiring its lock')
    .requiredOption('--offer <file>', 'Original public source offer')
    .requiredOption('--seal <file>', 'Successful receiver seal JSON')
    .requiredOption('--reserve-bytes <bytes>', 'Free space to retain after a full copy')
    .action(async (file, options) => {
      if (!/^(0|[1-9]\d*)$/.test(options.reserveBytes)) throw Error('Use an integer free-space reserve in bytes.');
      await print(await preparedDataDefinition(await readJson(file), await readJson(options.offer),
        await readJson(options.seal), Number(options.reserveBytes), Boolean(options.status)));
    });
  for (const phase of ['offer', 'copy', 'accept', 'revoke']) {
    const sub = op.command(phase + ' <spec>').description('Export the ' + phase + ' pipeline');
    if (phase !== 'revoke') sub.requiredOption('--helper <file>', 'Exact locally qualified ELF payload');
    if (['copy', 'accept'].includes(phase)) sub.requiredOption('--offer <file>', 'Public source offer JSON');
    sub.action(async (file, options) => {
      await print(await lmdbDefinition(phase, await readJson(file), options.offer && await readJson(options.offer),
        options.helper && await fs.readFile(options.helper)));
    });
  }
}
