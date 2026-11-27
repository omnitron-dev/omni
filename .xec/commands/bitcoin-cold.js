import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { registeredPinsStep } from '../../apps/omnitron/data/operations/controller-inspection.js';
import { preseedGraph, validEndpoints } from './block-preseed.js';
import { checkedRunner, installSteps } from './service-data-preseed.js';

const local = (name) => new URL('../bitcoin-cold/' + name, import.meta.url);
const load = (name) => fs.readFile(name, 'utf8');
const fields =
  'id sourceNode receiverNode sourceFingerprint receiverFingerprint sourceIp receiverIp receiverPort stageParent ttlMinutes'.split(
    ' '
  );
const pathOk = (p) =>
  typeof p === 'string' && /^\/[A-Za-z0-9_./ -]{1,1023}$/.test(p) && path.posix.resolve(p) === p && p !== '/';
const quote = (x) => "'" + x.replaceAll("'", "'\\''") + "'";
const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64');
const readJson = async (p) => JSON.parse(await load(p));

function python(source) {
  const payload = gzipSync(source, { level: 9 }).toString('base64');
  const loader =
    'import base64,gzip;s=gzip.decompress(base64.b64decode("' +
    payload +
    '")).decode();exec(compile(s,"bitcoin-cold","exec"),{"__name__":"__main__","SELF":s})';
  return (...args) => '/usr/bin/python3 -I -c ' + quote(loader) + ' ' + args.map(quote).join(' ');
}

async function endpoint() {
  const [channel, scope, program] = await Promise.all([
    load(new URL('../block-preseed/endpoint.py', import.meta.url)),
    load(local('scope.py')),
    load(local('endpoint.py')),
  ]);
  return (
    'import sys,types\n' +
    moduleSource('omnitron_preseed_channel', channel, 'ch') +
    moduleSource('bitcoin_cold_scope', scope, 'scope') +
    program
  );
}

function moduleSource(name, contents, binding) {
  return (
    binding +
    '=types.ModuleType("' +
    name +
    '");sys.modules[' +
    binding +
    '.__name__]=' +
    binding +
    ';' +
    binding +
    '.__dict__["SELF"]=globals().get("SELF")\n' +
    'exec(compile(' +
    JSON.stringify(contents) +
    ',"' +
    name +
    '","exec"),' +
    binding +
    '.__dict__)\n'
  );
}

function checkOffer(s, o) {
  if (
    o?.format !== 'bitcoin-core-public-cold-v1' ||
    o.protocol !== 1 ||
    o.id !== s.id ||
    ![o.spec, o.manifest].every((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) ||
    !/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(o.publicKey) ||
    ![o.files, o.bytes, o.reuseFiles, o.reuseBytes, o.issued, o.expires].every(Number.isSafeInteger) ||
    o.files < 2 ||
    o.files > 200000 ||
    o.reuseFiles < 0 ||
    o.reuseFiles > o.files ||
    o.bytes <= 0 ||
    o.reuseBytes < 0 ||
    o.reuseBytes > o.bytes ||
    o.expires !== o.issued + 60 * s.ttlMinutes ||
    Object.keys(o).sort().join() !==
      'bytes expires files format id issued manifest protocol publicKey reuseBytes reuseFiles spec'
        .split(' ')
        .sort()
        .join()
  )
    throw Error('Use the public offer from the reviewed cold source operation.');
}

export async function coldDefinition(phase, spec, { offer, release, installation } = {}) {
  const offered = ['copy', 'accept', 'adopt', 'qualify', 'publish', 'restore'].includes(phase);
  if (
    !validEndpoints(spec) ||
    !['probe', 'offer', 'copy', 'accept', 'revoke', 'adopt', 'qualify', 'publish', 'restore'].includes(phase) ||
    Boolean(offer) !== offered ||
    Boolean(release) !== (phase === 'qualify') ||
    Boolean(installation) !== ['publish', 'restore'].includes(phase)
  )
    throw Error('Invalid cold phase or review inputs.');
  const pins = registeredPinsStep(
    Object.fromEntries(
      ['sourceNode', 'receiverNode', 'sourceFingerprint', 'receiverFingerprint'].map((k) => [k, spec[k]])
    )
  );
  const add = (name, role, run) => ({
    name,
    nodeId: spec[role + 'Node'],
    run,
    dependsOn: [pins.name],
    retries: 0,
    timeout: 86400000,
  });
  let steps;
  if (phase === 'probe') {
    const expected = [...fields, 'sourceCli', 'sourceConfig', 'sourceUnit', 'dataDir', 'blocks'];
    if (
      Object.keys(spec).sort().join() !== expected.sort().join() ||
      ![spec.dataDir, spec.blocks, spec.sourceConfig, spec.sourceCli].every(pathOk) ||
      path.posix.basename(spec.sourceCli) !== 'bitcoin-cli' ||
      path.posix.basename(spec.blocks) !== 'blocks' ||
      !/^[A-Za-z0-9][A-Za-z0-9@_.-]{0,100}\.service$/.test(spec.sourceUnit)
    )
      throw Error('Invalid live public source probe.');
    steps = [
      pins,
      {
        ...add('observe-public-chain', 'source', python(await load(local('probe.py')))(encode(spec))),
        timeout: 120000,
      },
    ];
  } else {
    const check = spawnSync('python3', ['-I', fileURLToPath(local('scope.py'))], {
      input: JSON.stringify(spec),
      encoding: 'utf8',
    });
    if (check.status !== 0) throw Error('Invalid cold source or target binding.');
    if (offered) checkOffer(spec, offer);
    if (phase === 'qualify') {
      const releaseKeys = Object.keys(release).sort().join();
      const archive =
        releaseKeys === 'archive,machine' && pathOk(release.archive) && ['x86_64', 'aarch64'].includes(release.machine);
      const installed = releaseKeys === 'binDir,machine' && pathOk(release.binDir) && release.machine === 'x86_64';
      if (!archive && !installed)
        throw Error('Use the reviewed 32.1 archive or individually pinned installed x86_64 binaries.');
      const program =
        'import sys,types\n' +
        moduleSource('bitcoin_cold_scope', await load(local('scope.py')), 'scope') +
        (await load(local('qualify.py')));
      steps = [pins, add('qualify', 'receiver', python(program)(encode(spec), encode(offer), encode(release)))];
    } else {
      const program = await endpoint();
      const sha = createHash('sha256').update(program).digest('hex');
      const run = (...args) =>
        '/usr/bin/python3 -I -c ' + quote(checkedRunner) + ' ' + [sha, ...args].map(quote).join(' ');
      if (installation) {
        const previous = installation.previous;
        const validPrevious =
          previous?.kind === 'absent'
            ? Object.keys(previous).length === 1
            : previous?.kind === 'empty' &&
              Object.keys(previous).sort().join() === 'device,inode,kind' &&
              [previous.device, previous.inode].every((x) => typeof x === 'string' && /^[1-9][0-9]{0,24}$/.test(x));
        if (
          Object.keys(installation).sort().join() !== 'dataDir,previous,unit' ||
          !pathOk(installation.dataDir) ||
          !/^[a-zA-Z0-9][a-zA-Z0-9@_.-]{0,100}\.service$/.test(installation.unit) ||
          !validPrevious
        )
          throw Error('Review the exact inactive unit, canonical target and absent or empty directory identity.');
      }
      const actions = installation
        ? [add(phase, 'receiver', run(phase, encode(spec), encode(offer), encode(installation)))]
        : phase === 'adopt'
          ? [add('adopt', 'receiver', run('adopt', encode(spec), encode(offer)))]
          : preseedGraph(phase, spec, offer ?? null, run, 'bitcoin-cold', '').steps.slice(1);
      if (phase === 'offer' || phase === 'copy') {
        actions[0].dependsOn = ['check-hot-seal'];
        actions.unshift(add('check-hot-seal', 'receiver', run('check-hot-seal', encode(spec), encode(null))));
      }
      const installer = await load(new URL('../service-data-preseed/install.py', import.meta.url));
      steps = [pins];
      for (const side of ['source', 'receiver']) {
        if (!actions.some((a) => a.nodeId === spec[side + 'Node'])) continue;
        for (const part of installSteps(installer, program, spec, side)) {
          steps.push({
            ...part,
            name: side + '-' + part.name,
            nodeId: spec[side + 'Node'],
            retries: 0,
            timeout: 120000,
            dependsOn: [steps.at(-1).name],
          });
        }
      }
      const installed = steps.at(-1).name;
      for (const action of actions)
        steps.push({ ...action, dependsOn: action.dependsOn.map((dep) => (dep === pins.name ? installed : dep)) });
    }
  }
  if (steps.some((step) => Buffer.byteLength(step.run) > 22 * 1024))
    throw Error('Cold management step exceeds the native SSH packet budget.');
  return {
    name: 'bitcoin-cold-' + spec.id + '-' + phase,
    description: 'Stage and qualify the reviewed public Bitcoin Core chain.',
    triggers: [{ type: 'manual', config: {} }],
    steps,
  };
}

export function command(program) {
  const op = program
    .command('bitcoin-cold')
    .description('Transfer and privately qualify public Bitcoin Core chain data after a clean stop');
  for (const phase of ['probe', 'offer', 'copy', 'accept', 'revoke', 'adopt', 'qualify', 'publish', 'restore']) {
    const cmd = op.command(phase + ' <spec>').description('Export the reviewed ' + phase + ' Pipeline');
    if (['copy', 'accept', 'adopt', 'qualify', 'publish', 'restore'].includes(phase))
      cmd.requiredOption('--offer <file>', 'Exact public cold source offer');
    if (['publish', 'restore'].includes(phase))
      cmd.requiredOption('--installation <file>', 'Exact inactive target unit, path and expected previous directory');
    if (phase === 'qualify')
      cmd.requiredOption('--release <file>', 'Receiver archive or installed binary directory and architecture');
    cmd.action(async (file, opts) => {
      const result = await coldDefinition(phase, await readJson(file), {
        offer: opts.offer && (await readJson(opts.offer)),
        release: opts.release && (await readJson(opts.release)),
        installation: opts.installation && (await readJson(opts.installation)),
      });
      await new Promise((resolve, reject) =>
        process.stdout.write(JSON.stringify(result, null, 2) + '\n', (e) => (e ? reject(e) : resolve()))
      );
    });
  }
}
