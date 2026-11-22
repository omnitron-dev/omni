import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkedDeclaration, compareOriginal, dockerInventory, materialized } from './legacy.mjs';
import { nativeControls, nativeMounts, physicalWitness, verifyPhysical } from './physical.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (a, b) => JSON.stringify(a.toSorted()) === JSON.stringify(b.toSorted());
const fail = message => { throw Error(message); };
const id = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function sealOriginal(declaration, { docker, fingerprint, bindings, volumeRoot }) {
  const fingerprints = {};
  const checked = compareOriginal(declaration, { docker, fingerprint, bindings, recordMatch: (role, digest) => { fingerprints[role] = digest; } });
  if (!checked.eligible) fail('All original creation receipts and private bindings must match before sealing');
  const physical = physicalWitness(declaration, docker, volumeRoot);
  const controls = Object.fromEntries(declaration.services.map(row => {
    nativeMounts(docker, row, row.originalId, physical);
    return [row.spec.labels['omnitron.service'], nativeControls(docker, row, row.originalId, row.spec.network, row.spec.restart)];
  }));
  if (!compareOriginal(declaration, { docker, fingerprint, bindings }).eligible) fail('Original membership changed during sealing');
  return { protocol: 1, nonce: randomUUID(), declaration: checked.declarationSha256, volumeRoot, physical, controls, fingerprints };
}

export function stoppedAllocation(record, declaration, operation) {
  const { plan, receipt } = record ?? {};
  return uuid.test(operation) && record?.phase === 'stopped' && !record.suspended && plan?.protocol === 1 &&
    plan.project === declaration.project && plan.stack === declaration.stack && plan.applications === true && !plan.keepInfrastructure &&
    receipt?.protocol === 1 && receipt.project === plan.project && receipt.stack === plan.stack && receipt.outcome === 'stopped' &&
    plan.execution?.project === declaration.project && Array.isArray(plan.execution.apps) && plan.execution.apps.length > 0 &&
    receipt.applications?.operationId === operation && receipt.applications.project === plan.execution.project &&
    receipt.applications.stack === plan.execution.stack && Array.isArray(receipt.applications.stopped) &&
    exact(plan.execution.apps.map(app => app.name), receipt.applications.stopped) &&
    Number.isSafeInteger(receipt.applications.revision) && receipt.applications.revision >= 0 && !receipt.keepInfrastructure &&
    receipt.operationId === operation && plan.operationId === operation &&
    Array.isArray(plan.containers) && exact(plan.containers.map(o => o.id + '/' + o.name),
      declaration.services.map(s => s.originalId + '/' + s.spec.name)) &&
    Array.isArray(receipt.removedContainers) && exact(receipt.removedContainers, declaration.services.map(s => s.originalId));
}

export async function readStoppedAllocation(dbPath, declaration, operation) {
  if (!path.isAbsolute(dbPath) || fs.realpathSync(dbPath) !== dbPath) fail('Select the original node state database');
  const state = fs.lstatSync(dbPath);
  if (!state.isFile() || state.uid !== process.getuid() || state.mode & 0o022) fail('The original node state database has unsafe ownership');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON');
    const row = db.prepare("SELECT json_extract(value, ?) AS scoped FROM state_kv WHERE key='lifecycle:node-stack-stops:v1'")
      .get('$."' + declaration.project + '/' + declaration.stack + '"');
    if (!stoppedAllocation(row?.scoped && JSON.parse(row.scoped), declaration, operation))
      fail('No matching completed native stop exists for the original allocation');
  } finally { db.close(); }
}

function output(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, timeout: 90000, maxBuffer: 131072 });
  if (result.status !== 0 || result.error) fail('Docker did not confirm passive restoration');
  return result.stdout.trim();
}

function prepareArgs(row, spec, nonce, digest, controls) {
  const secretNames = Object.entries(row.spec.environment).filter(([, v]) => typeof v !== 'string').map(([k]) => k);
  if (!['always', 'unless-stopped', 'no', 'on-failure'].includes(spec.restart)) fail('Unknown released restart policy');
  const privateLines = [], args = ['container', 'create', '--pull=never', '--name', spec.name, '--restart=' + spec.restart];
  if (spec.network) args.push('--network', spec.network);
  for (const [key, value] of Object.entries(spec.environment)) {
    if (!secretNames.includes(key)) { args.push('--env', key + '=' + value); continue; }
    if (/[\r\n\0]/.test(value)) fail('A private binding cannot be represented by a Docker environment file');
    privateLines.push(key + '=' + value);
  }
  if (privateLines.length) args.push('--env-file', '/dev/stdin');
  for (const v of spec.volumes) {
    if ([v.source, v.target].some(s => typeof s !== 'string' || /[,\r\n\0]/.test(s))) fail('Unrepresentable native mount');
    const kind = path.isAbsolute(v.source) ? 'bind' : 'volume';
    args.push('--mount', ['type=' + kind, 'source=' + v.source, 'target=' + v.target,
      ...(v.readonly ? ['readonly'] : []), ...(kind === 'volume' ? ['volume-nocopy'] : [])].join(','));
  }
  for (const p of spec.ports) {
    if (!Number.isInteger(p.host) || !Number.isInteger(p.container) || p.host < 1 || p.host > 65535 ||
        p.container < 1 || p.container > 65535 || (p.bindHost ?? '127.0.0.1') !== '127.0.0.1')
      fail('Only declared loopback TCP publishing is supported by passive restoration');
    args.push('--publish', '127.0.0.1:' + p.host + ':' + p.container);
  }
  for (const [k,v] of Object.entries({...spec.labels, 'omnitron.spec-hash': digest, 'omnitron.creation': nonce}))
    args.push('--label', k + '=' + v);
  if (controls.shm) args.push('--shm-size', String(controls.shm));
  if (controls.memory) args.push('--memory', String(controls.memory));
  if (controls.reservation) args.push('--memory-reservation', String(controls.reservation));
  if (controls.nano) args.push('--cpus', (controls.nano / 1e9).toFixed(9));
  if (controls.period) args.push('--cpu-period', String(controls.period));
  if (controls.quota) args.push('--cpu-quota', String(controls.quota));
  if (controls.noNewPrivileges) args.push('--security-opt', 'no-new-privileges');
  if (spec.resources && Object.keys(spec.resources).length) fail('This legacy restoration needs an independent native resource profile');
  const h = spec.healthCheck;
  if (h) {
    if (!Array.isArray(h.test) || !h.test.length) fail('Invalid legacy health check');
    const command = h.test.length === 2 && h.test[0] === 'CMD-SHELL' ? h.test[1] : h.test.filter(x => x !== 'CMD-SHELL' && x !== 'CMD').join(' ');
    args.push('--health-cmd', command);
    for (const [key, flag] of [['interval','--health-interval'],['timeout','--health-timeout'],['retries','--health-retries'],['startPeriod','--health-start-period']])
      if (h[key]) args.push(flag, String(h[key]));
  }
  for (const entry of spec.extraHosts ?? []) args.push('--add-host', entry);
  if (spec.entrypoint) args.push('--entrypoint', spec.entrypoint[0]);
  args.push(spec.image, ...(spec.entrypoint?.slice(1) ?? []), ...(spec.command ?? []));
  return { args, input: privateLines.length ? privateLines.join('\n') + '\n' : undefined };
}

/** Inspect only stopped replacements created by this operation. No command, environment or unrelated labels enter the verifier. */
const stoppedIdentity = '{{.Id}}|{{.Name}}|{{.Image}}|{{.Config.Image}}|{{.State.Status}}|{{.HostConfig.RestartPolicy.Name}}|{{index .Config.Labels "omnitron.creation"}}|{{index .Config.Labels "omnitron.spec-hash"}}';

export async function stageStopped(declaration, seal, { docker = output, fingerprint, bindings, confirmedStop, reserve, supplement }) {
  checkedDeclaration(declaration);
  const encoded = hash(JSON.stringify(declaration));
  if (seal.protocol !== 1 || seal.declaration !== encoded || !uuid.test(seal.nonce)) fail('Select the matching source-local seal');
  if (typeof confirmedStop !== 'function') fail('A current native full stop is required');
  const scope = { project: declaration.project, stack: declaration.stack };
  const accepted = new Set(), result = {};
  function knownRows() {
    const all = dockerInventory(docker, scope, undefined, undefined, true);
    const mine = dockerInventory(docker, scope, undefined, 'omnitron.creation=' + seal.nonce, true);
    if (!exact(all, mine) || dockerInventory(docker, scope).length) fail('The original source has an unexpected or running allocation');
  }
  const work = declaration.services.map(row => {
    const spec = materialized(row.spec, bindings), role = row.spec.labels['omnitron.service'];
    if (!spec || fingerprint(spec) !== seal.fingerprints[role]) fail('The original private binding or released declaration changed');
    const overlay = supplement?.role === role ? supplement : undefined;
    const desired = overlay ? { ...spec, entrypoint: [overlay.entrypoint], command: [] } : spec;
    const receipt = fingerprint(desired);
    return { row, desired, role, receipt, overlay, create: prepareArgs(row, desired, seal.nonce, receipt, seal.controls[role]) };
  });
  if (supplement && (!work.some(x => x.overlay) || !/^\/usr\/local\/libexec\/[a-zA-Z0-9_-]+$/.test(supplement.entrypoint) ||
      !id.test(supplement.sha256) || typeof supplement.install !== 'function')) fail('Invalid reviewed public startup supplement');
  await confirmedStop();
  verifyPhysical(seal.physical, declaration, docker, seal.volumeRoot);
  knownRows();
  reserve?.();
  for (const { row, desired, role, receipt, overlay, create } of work) {
    await confirmedStop(); knownRows();
    const discover = () => dockerInventory(docker, scope, role, 'omnitron.creation=' + seal.nonce, true);
    let found = discover();
    if (!found.length) {
      let issued;
      try { issued = docker(create.args, create.input).trim(); } catch { /* An allocated object can outlive a lost response. */ }
      found = discover();
      if (issued && (!id.test(issued) || found.length !== 1 || found[0] !== issued)) fail('Docker returned a different passive allocation');
    }
    if (found.length !== 1 || accepted.has(found[0])) fail('Passive creation is unconfirmed; retain the seal and retry after settling Docker');
    const object = found[0];
    const expected = [object,'/' + desired.name,row.imageId,desired.image,'created',desired.restart,seal.nonce,receipt].join('|');
    if (docker(['container','inspect','--format',stoppedIdentity,'--',object]).trim() !== expected)
      fail('A stopped replacement differs from its confirmed identity, image or policy');
    nativeMounts(docker, row, object, seal.physical);
    if (JSON.stringify(nativeControls(docker, row, object, desired.network, desired.restart)) !== JSON.stringify(seal.controls[role]))
      fail('The enforced resource or security settings differ on the passive replacement');
    verifyPhysical(seal.physical, declaration, docker, seal.volumeRoot);
    if (overlay) overlay.install(object);
    accepted.add(object); result[role] = object;
  }
  knownRows();
  if (!exact(dockerInventory(docker, scope, undefined, undefined, true), [...accepted])) fail('Passive inventory is not the complete reviewed set');
  return { protocol: 1, ...scope, declarationSha256: encoded, created: result, running: 0 };
}
