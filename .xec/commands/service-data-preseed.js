import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { registeredPinsStep, validEndpoints } from './block-preseed.js';

const channel = new URL('../block-preseed/endpoint.py', import.meta.url);
const scope = new URL('../service-data-preseed/scope.py', import.meta.url);
const endpoint = new URL('../service-data-preseed/endpoint.py', import.meta.url);
const installer = new URL('../service-data-preseed/install.py', import.meta.url);
const bytesSha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packed = (value) => gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }).toString('base64');
const hash = (value) => /^[0-9a-f]{64}$/.test(value);
const reduce = (value) =>
  Array.isArray(value)
    ? value.map(reduce)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, reduce(value[key])])
        )
      : value;
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(reduce(value)))
    .digest('hex');
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const load = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));

function validate(spec) {
  if (!validEndpoints(spec)) throw Error('Invalid service-data endpoints');
  const check = spawnSync('python3', ['-I', fileURLToPath(scope)], { input: JSON.stringify(spec), encoding: 'utf8' });
  if (check.error || check.status !== 0) throw Error('Invalid service-data physical volume bindings');
}

export async function grantContract(spec, publicKey, expires, device, inode) {
  validate(spec);
  const key = publicKey.trim().split(/\s+/).slice(0, 2).join(' ');
  if (
    !/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/.test(key) ||
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() / 1000 ||
    expires > Date.now() / 1000 + spec.ttlMinutes * 60 ||
    ![device, inode].every((n) => typeof n === 'string' && /^[1-9][0-9]{0,24}$/.test(n))
  )
    throw Error('Invalid local operation key, expiry or stage identity');
  const state = '/var/lib/omnitron-service-data/' + spec.id,
    stage = spec.stageParent + '/service-data-' + spec.id;
  const iso = new Date(expires * 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/T/, '')
    .replace(/\.\d+Z$/, 'Z');
  const common = { schema: 1, spec: digest(spec), expires, key };
  return {
    state,
    stage,
    account: 'osd' + spec.id.replaceAll('-', '').slice(0, 20),
    source: common,
    receiver: { ...common, device, inode },
    receiverHelperSha256: createHash('sha256')
      .update(await receiverProgram())
      .digest('hex'),
    authorizedKey:
      'restrict,from="' +
      spec.sourceIp +
      '",expiry-time="' +
      iso +
      '",command="/usr/bin/python3 -I ' +
      state +
      '/receiver.py receive ' +
      spec.id +
      '" ' +
      key,
    exports: spec.volumes.map((r) => ({
      tag: r.tag,
      volume: r.volume,
      device: r.device,
      inode: r.inode,
      readOnlyMount: state + '/exports/' + r.tag,
    })),
  };
}

export async function receiverProgram() {
  const [common, rules, program] = await Promise.all([
    fs.readFile(channel),
    fs.readFile(scope),
    fs.readFile(endpoint, 'utf8'),
  ]);
  const embed = (source, namespace, name) =>
    'exec(compile(gzip.decompress(base64.b64decode("' +
    gzipSync(source).toString('base64') +
    '")),"' +
    name +
    '","exec"),' +
    namespace +
    ')\n';
  return (
    'import base64,gzip,json,pathlib,sys,types\nSELF=globals().get("SELF") or pathlib.Path(__file__).read_text()\n' +
    'ch=types.ModuleType("preseed_channel");sys.modules[ch.__name__]=ch\n' +
    embed(common, 'ch.__dict__', 'channel') +
    'scope=types.ModuleType("service_data_scope");sys.modules[scope.__name__]=scope\n' +
    embed(rules, 'scope.__dict__', 'scope') +
    'STOP,RECEIPT,GRANTS=(None,None,None) if len(sys.argv)<4 else json.loads(gzip.decompress(base64.b64decode(sys.argv[3])))\n' +
    program
  );
}

const fenceFile = new URL('../service-data-preseed/stop_receipt.py', import.meta.url);

const checkedSource = `import hashlib,os,pathlib,re,stat,sys
d=sys.argv.pop(1)
if not re.fullmatch('[0-9a-f]{64}',d) or sys.platform!='linux' or os.geteuid()!=0: sys.exit('Invalid helper request')
root=pathlib.Path('/var/lib/omnitron-service-data-tools')
for p in (root,*root.parents):
 st=p.lstat()
 if not stat.S_ISDIR(st.st_mode) or st.st_uid or st.st_mode&0o022: sys.exit('Unsafe helper directory')
with os.fdopen(os.open(root/d,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),'rb') as f:
 st=os.fstat(f.fileno())
 if not stat.S_ISREG(st.st_mode) or st.st_uid or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)!=0o500 or not 0<st.st_size<=160*1024: sys.exit('Unsafe helper')
 b=f.read(160*1024+1)
if hashlib.sha256(b).hexdigest()!=d: sys.exit('Installed helper differs from review')`;
const checkedRunner =
  checkedSource + "\ns=b.decode();exec(compile(s,'service-data','exec'),{'__name__':'__main__','SELF':s})";

async function checkedRedisRunner() {
  const files = await Promise.all(
    ['redis_aof.py', 'cold_compat.py'].map((file) =>
      fs.readFile(new URL('../service-data-adopt/' + file, import.meta.url), 'utf8')
    )
  );
  return (
    checkedSource +
    "\nimport base64,gzip,json,types\nr,t=json.loads(gzip.decompress(base64.b64decode('" +
    packed(files) +
    "')))\nredis=types.ModuleType('redis_aof');sys.modules['redis_aof']=redis\nexec(compile(r,'redis-aof','exec'),redis.__dict__)\ns=b.decode();m={'__name__':'checked_seed','SELF':s};exec(compile(s,'service-data','exec'),m)\ncompat={};exec(compile(t,'checked-redis-compat','exec'),compat);compat['run'](m)"
  );
}

async function checkedWarmRunner(seconds) {
  const profile = await fs.readFile(new URL('../service-data-preseed/warm_transfer.py', import.meta.url), 'utf8');
  return (
    checkedSource +
    "\nimport base64,gzip,json\ns=b.decode();m={'__name__':'checked_seed','SELF':s};exec(compile(s,'service-data','exec'),m)\n" +
    "p=json.loads(gzip.decompress(base64.b64decode('" +
    packed(profile) +
    "')));a={};exec(compile(p,'registered-warm-budget','exec'),a);a['run'](m," +
    seconds +
    ')'
  );
}

function installSteps(source, program, spec, side) {
  const digest = bytesSha(program);
  const bundled = gzipSync(program, { level: 9 });
  const total = Math.ceil(bundled.length / 6144);
  const prefix = '/usr/bin/python3 -I -c ' + quote(source) + ' ';
  return Array.from({ length: total }, (_, index) => {
    const piece = bundled.subarray(index * 6144, (index + 1) * 6144);
    const args = [
      spec[side + 'Fingerprint'],
      digest,
      String(index),
      String(total),
      bytesSha(piece),
      piece.toString('base64'),
    ];
    return { name: 'helper-part-' + (index + 1), run: prefix + args.map(quote).join(' ') };
  });
}

export async function serviceDataDefinition(
  phase,
  spec,
  { grants, stop, receipt, installedDigest, warmIdleSeconds } = {}
) {
  const phases = [
    'bootstrap-source',
    'bootstrap-receiver',
    'source-grant',
    'receiver-grant',
    'seed',
    'cold',
    'seal',
    'status',
    'revoke',
  ];
  validate(spec);
  if (!phases.includes(phase)) throw Error('Invalid service-data operation');
  const transferring = ['seed', 'cold'].includes(phase),
    final = ['cold', 'seal'].includes(phase);
  if (installedDigest !== undefined && ((!final && phase !== 'seed') || !hash(installedDigest)))
    throw Error('Retained service helpers require a transfer review and an exact installed SHA');
  if (
    warmIdleSeconds !== undefined &&
    (phase !== 'seed' || !Number.isSafeInteger(warmIdleSeconds) || warmIdleSeconds < 90 || warmIdleSeconds > 1800)
  )
    throw Error('Only a warm seed accepts a reviewed rsync idle timeout between 90 and 1800 seconds');
  if (Boolean(grants) !== transferring || Boolean(stop) !== final || Boolean(receipt) !== (phase === 'seal'))
    throw Error('Seed/cold require both grants, cold/seal the stop operation and seal the source cold receipt');
  if (stop && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(stop)) throw Error('Invalid stack stop operation');
  if (grants) {
    const source = grants.source,
      receiver = grants.receiver,
      sha = digest(spec);
    if (
      !source ||
      !receiver ||
      source.side !== 'source' ||
      receiver.side !== 'receiver' ||
      source.spec !== sha ||
      receiver.spec !== sha ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(source.keySha256) ||
      source.keySha256 !== receiver.keySha256 ||
      receiver.stage !== spec.stageParent + '/service-data-' + spec.id ||
      ![source.expires, receiver.expires].every(Number.isSafeInteger)
    )
      throw Error('Both endpoints must independently admit the same operation');
  }
  if (
    receipt &&
    (receipt.id !== spec.id ||
      receipt.spec !== digest(spec) ||
      receipt.stop !== stop ||
      !receipt.trees ||
      receipt.sha256 !== digest(receipt.trees) ||
      Object.keys(receipt.trees).sort().join() !==
        spec.volumes
          .map((r) => r.tag)
          .sort()
          .join() ||
      !Object.values(receipt.trees).every(
        (tree) => hash(tree.sha256) && [tree.files, tree.bytes].every((v) => Number.isSafeInteger(v) && v >= 0)
      ))
  )
    throw Error('Invalid cold receipt for this exact stack stop and volume set');
  const program = await receiverProgram();
  const toolDigest = installedDigest ?? bytesSha(program);
  const transferRunner =
    phase === 'cold'
      ? await checkedRedisRunner()
      : warmIdleSeconds === undefined
        ? checkedRunner
        : await checkedWarmRunner(warmIdleSeconds);
  const pins = registeredPinsStep(
    Object.fromEntries(
      ['sourceNode', 'receiverNode', 'sourceFingerprint', 'receiverFingerprint'].map((k) => [k, spec[k]])
    )
  );
  const env = packed([stop ?? null, receipt ?? null, grants ?? null]);
  const steps = [pins];
  const fence = final ? await fs.readFile(fenceFile, 'utf8') : '';
  if (phase.startsWith('bootstrap-') || phase.endsWith('-grant')) {
    const side = phase.startsWith('bootstrap-') ? phase.slice(10) : phase.split('-')[0];
    for (const part of installSteps(await fs.readFile(installer, 'utf8'), program, spec, side)) {
      steps.push({ ...part, nodeId: spec[side + 'Node'], dependsOn: [steps.at(-1).name], retries: 0, timeout: 120000 });
    }
  }
  const add = (name, side, action = name) => {
    const previous = steps[steps.length - 1].name;
    if (side === 'controller') {
      steps.push({
        name,
        dependsOn: [previous],
        retries: 0,
        timeout: 90000,
        run:
          'python3 -I -c ' +
          quote(fence) +
          ' ' +
          encode([{ project: spec.project, stack: spec.stack, sourceNode: spec.sourceNode, sourceIp: spec.sourceIp }, stop]),
      });
    } else {
      steps.push({
        name,
        nodeId: spec[side + 'Node'],
        dependsOn: [previous],
        retries: 0,
        timeout: 86400000,
        run:
          '/usr/bin/python3 -I -c ' +
          quote(action === 'cold' || action === 'seed' ? transferRunner : checkedRunner) +
          ' ' +
          [toolDigest, action, packed(spec), env].map(quote).join(' '),
      });
    }
  };
  if (final) add('confirm-stop', 'controller');
  if (phase === 'source-grant' || phase === 'receiver-grant') add(phase, phase.split('-')[0]);
  if (phase === 'bootstrap-source' || phase === 'bootstrap-receiver') add(phase, phase.split('-')[1]);
  if (transferring) {
    add('check-receiver', 'receiver', 'receiver-grant');
    add(phase, 'source');
  }
  if (phase === 'seal') {
    add('receiver-observe', 'receiver');
    add('source-check', 'source');
    add('seal', 'receiver');
  }
  if (phase === 'status') add('status', 'receiver');
  if (final) add('recheck-stop', 'controller');
  if (phase === 'revoke') {
    add('revoke-receiver', 'receiver');
    add('revoke-source', 'source');
  }
  // Leave 2 KiB within the 24 KiB management budget for the installed adapter's shell and environment.
  if (steps.some((step) => Buffer.byteLength(step.run) > 22 * 1024))
    throw Error('Private service Pipeline step exceeds the bounded SSH management command size');
  return {
    name: 'service-data-' + spec.id + '-' + phase,
    description: 'Reviewed staging of registered service volumes.',
    triggers: [{ type: 'manual', config: {} }],
    steps,
  };
}

export function command(program) {
  const cmd = program
    .command('service-data-preseed')
    .description('Stage and cold-verify independently granted private service volumes');
  const print = (bytes) =>
    new Promise((resolve, reject) => process.stdout.write(bytes, (error) => (error ? reject(error) : resolve())));
  cmd
    .command('receiver-helper')
    .description('Print the exact unprivileged SSH forced command for a local receiver grant')
    .action(async () => print(await receiverProgram()));
  cmd
    .command('grant-contract <spec>')
    .description('Print public inputs for independently provisioning each endpoint')
    .requiredOption('--public-key <file>', 'Public key of the one-use source identity')
    .requiredOption('--expires <epoch>', 'Absolute expiry in epoch seconds')
    .requiredOption('--stage-device <dev>', 'Receiving private stage device number')
    .requiredOption('--stage-inode <inode>', 'Receiving private stage inode number')
    .action(async (file, options) =>
      print(
        JSON.stringify(
          await grantContract(
            await load(file),
            await fs.readFile(options.publicKey, 'utf8'),
            Number(options.expires),
            options.stageDevice,
            options.stageInode
          ),
          null,
          2
        ) + '\n'
      )
    );
  for (const phase of [
    'bootstrap-source',
    'bootstrap-receiver',
    'source-grant',
    'receiver-grant',
    'seed',
    'cold',
    'seal',
    'status',
    'revoke',
  ]) {
    const sub = cmd.command(phase + ' <spec>').description('Export the ' + phase + ' Omnitron pipeline');
    if (phase === 'seed') {
      sub.option(
        '--idle-timeout <seconds>',
        'Bound this warm rsync inactivity to 90–1800 seconds and the remaining grant',
        Number
      );
      sub.option('--source-bootstrap <file>', 'Completed source bootstrap for the retained helper');
      sub.option('--receiver-bootstrap <file>', 'Completed receiver bootstrap for the retained helper');
    }
    if (['seed', 'cold'].includes(phase)) sub.requiredOption('--grants <file>', 'Both verified endpoint receipts');
    if (['cold', 'seal'].includes(phase)) sub.requiredOption('--stop <id>', 'Exact current full stack stop operation');
    if (phase === 'seal') sub.requiredOption('--receipt <file>', 'Exact source cold receipt');
    sub.action(async (file, options) => {
      if (Boolean(options.sourceBootstrap) !== Boolean(options.receiverBootstrap))
        throw Error('Both endpoint bootstrap receipts are required for a retained seed');
      const spec = await load(file);
      const inputs = {
        grants: options.grants && (await load(options.grants)),
        stop: options.stop,
        receipt: options.receipt && (await load(options.receipt)),
        warmIdleSeconds: options.idleTimeout,
      };
      let graph;
      if (options.sourceBootstrap) {
        const { retainedServiceDefinition } = await import('./service-data-cold.js');
        graph = await retainedServiceDefinition(phase, spec, {
          ...inputs,
          sourceBootstrap: await load(options.sourceBootstrap),
          receiverBootstrap: await load(options.receiverBootstrap),
        });
      } else {
        graph = await serviceDataDefinition(phase, spec, inputs);
      }
      await print(JSON.stringify(graph, null, 2) + '\n');
    });
  }
}

export { checkedRunner, installSteps };
