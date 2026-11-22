import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

const sha = /^[0-9a-f]{64}$/;
const name = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
const profiles = [
  ['bitcoin', 'bitcoind.service', 'bitcoin', '/etc/bitcoin/bitcoin.conf'],
  ['monero-daemon', 'monerod.service', 'monero', '/etc/monero/monerod.conf'],
  ['monero-wallet-rpc', 'monero-wallet-rpc.service', 'monero-wallet', '/etc/monero/monero-wallet-rpc.conf'],
];
const chainDirs = ['/var/lib/bitcoind', '/var/lib/monero/.bitmonero', null];

function fields(value, names) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === names.split(' ').sort().join(',');
}

export function checkedHostReview(input, expected) {
  const r = input?.ok === true ? input.data : input;
  if (!fields(r, 'protocol project stack release commit manifestSha256 nodeId sshFingerprint referencesSha256 bindings digest') ||
      r.protocol !== 1 || ![r.project, r.stack, r.release, r.nodeId].every(x => typeof x === 'string' && name.test(x)) ||
      !/^[a-f0-9]{40}$/.test(r.commit) || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(r.sshFingerprint) ||
      ![r.referencesSha256, r.manifestSha256, r.digest, expected].every(x => typeof x === 'string' && sha.test(x)) ||
      !Array.isArray(r.bindings) || r.bindings.length !== profiles.length)
    throw Error('Select an exact public host binding review and its independently reviewed digest');
  const bindings = r.bindings.map((b, i) => {
    if (!fields(b, 'name unit user config chainDataDir unitSha256 templateSha256') || b.chainDataDir !== chainDirs[i] ||
        JSON.stringify([b.name, b.unit, b.user, b.config]) !== JSON.stringify(profiles[i]) ||
        ![b.unitSha256, b.templateSha256].every(x => typeof x === 'string' && sha.test(x)))
      throw Error('Unrecognized public binding schema');
    return [b.name, b.unit, b.user, b.config, b.chainDataDir, b.unitSha256, b.templateSha256];
  });
  const digest = createHash('sha256').update(JSON.stringify([1, r.project, r.stack, r.release, r.commit, r.manifestSha256,
    r.nodeId, r.sshFingerprint, r.referencesSha256, bindings])).digest('hex');
  if (expected !== digest || r.digest !== digest) throw Error('Public binding review digest changed');
  return r;
}

const pinCheck = `import json,subprocess,sys
node,pin=sys.argv[1:]
p=subprocess.run(['omnitron','--json','node','ssh-key',node],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30)
r=json.loads(p.stdout) if p.returncode==0 else {}
h=r.get('data',{})
if r.get('ok') is not True or h.get('nodeId')!=node or h.get('trusted')!=pin or h.get('observed')!=pin:raise SystemExit('Registered host identity differs')
print('Registered host identity confirmed')`;
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";

export async function hostBindingsInspection(input, expected, stage, expires, now = Date.now()) {
  const review = checkedHostReview(input, expected);
  return inspectionDefinition(review, 'registered-release', stage, expires, now);
}

/** Older controllers can inspect a separately reviewed public unit bundle. It carries no config admission. */
export async function stagedUnitInspection(bytes, options, now = Date.now()) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || typeof options.expectArtifact !== 'string' || !sha.test(options.expectArtifact) ||
      createHash('sha256').update(bytes).digest('hex') !== options.expectArtifact ||
      typeof options.nodeId !== 'string' || !name.test(options.nodeId) || options.nodeId === 'local' ||
      typeof options.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(options.fingerprint))
    throw Error('Select the checked public unit artifact and a registered pinned node');
  const artifact = JSON.parse(bytes.toString('utf8'));
  if (!fields(artifact, 'revision units') || !/^[a-f0-9]{40}$/.test(artifact.revision) ||
      !Array.isArray(artifact.units) || artifact.units.length !== profiles.length)
    throw Error('Unrecognized public unit artifact');
  const bindings = profiles.map(([service, unit, user, config]) => {
    const item = artifact.units.find(row => row?.name === unit);
    if (!fields(item, 'name user sha256 text') || item.user !== user || !sha.test(item.sha256) ||
        typeof item.text !== 'string' || Buffer.byteLength(item.text) > 128 * 1024 ||
        createHash('sha256').update(item.text).digest('hex') !== item.sha256) throw Error('Public unit artifact changed');
    return { name: service, unit, user, config, unitSha256: item.sha256 };
  });
  const review = { commit: artifact.revision, bindings, nodeId: options.nodeId, sshFingerprint: options.fingerprint,
    digest: createHash('sha256').update(JSON.stringify(['staged-public-units', options.expectArtifact, options.nodeId, options.fingerprint])).digest('hex') };
  return inspectionDefinition(review, 'staged-public-units', options.stage, options.expires, now);
}

async function inspectionDefinition(review, basis, stage, expires, now) {
  const validUntil = Date.parse(expires);
  if (!Number.isFinite(validUntil) || !/Z$/.test(expires) || validUntil <= now || validUntil > now + 3600000)
    throw Error('Select an explicit UTC observation expiry within the next hour');
  if (typeof stage !== 'string' || !/^\/srv\/[a-zA-Z0-9_-]+\/host-units-[a-f0-9]{8,40}$/.test(stage) ||
      !review.commit.startsWith(stage.split('host-units-').at(-1))) throw Error('Select the public unit stage for the reviewed source commit');
  const source = await fs.readFile(new URL('../host-bindings/observe.py', import.meta.url), 'utf8');
  const body = Buffer.from(JSON.stringify({ review, basis, stage, validUntil: Math.floor(validUntil / 1000) })).toString('base64');
  return { name: 'Inspect passive host bindings ' + review.digest.slice(0, 16),
    description: 'Check the public staged units, service identities and unoccupied target paths.',
    steps: [
      { name: 'registered-pin', run: `python3 -I -c ${quote(pinCheck)} ${quote(review.nodeId)} ${quote(review.sshFingerprint)}`, retries: 0, timeout: 60000 },
      { name: 'inspect-host-bindings', nodeId: review.nodeId, dependsOn: ['registered-pin'], retries: 0, timeout: 60000,
        run: `python3 -I -c ${quote(source)} ${body}` },
    ] };
}

export function command(program) {
  const bindings = program.command('host-bindings').description('Export passive host binding inspections');
  bindings.command('inspect-staged <bundle>').requiredOption('--expect-artifact <sha>', 'Independent SHA-256 of the complete public bundle')
    .requiredOption('--node-id <id>', 'Registered recipient').requiredOption('--fingerprint <pin>', 'Expected SSH Ed25519 fingerprint')
    .requiredOption('--stage <path>', 'Previously prepared public units under /srv').requiredOption('--expires <utc>', 'Observation deadline in UTC')
    .allowExcessArguments(false).description('Inspect a separately reviewed public unit bundle on a legacy controller')
    .action(async (file, options) => {
      const graph = await stagedUnitInspection(await fs.readFile(file), options);
      process.stdout.write(JSON.stringify(graph, null, 2) + '\n');
    });
  bindings.command('inspect <review>').requiredOption('--expect-review <sha>', 'Independently checked public review SHA-256')
    .requiredOption('--stage <path>', 'Previously prepared public units under /srv')
    .requiredOption('--expires <utc>', 'Observation deadline in UTC').allowExcessArguments(false)
    .description('Export the read-only host binding inspection for a registered Linux node')
    .action(async (file, options) => {
      const review = JSON.parse(await fs.readFile(file, 'utf8'));
      const graph = await hostBindingsInspection(review, options.expectReview, options.stage, options.expires);
      process.stdout.write(JSON.stringify(graph, null, 2) + '\n');
    });
}
