/** Executed as an independent Node module beside a verified legacy runtime. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const digest = /^[a-f0-9]{64}$/;
const name = /^[a-z][a-z0-9-]{0,62}$/;
const field = /^[A-Z_][A-Z0-9_]{0,127}$/;
const exact = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const fail = message => { throw Error(message); };

export function checkedDeclaration(declaration) {
  const { project, stack, release, manifestSha256, services } = declaration ?? {};
  if (declaration?.protocol !== 1 || ![project, stack].every(k => typeof k === 'string' && name.test(k)) ||
      typeof release !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(release) ||
      !digest.test(manifestSha256 ?? '') || !Array.isArray(services) || !services.length || services.length > 32)
    fail('Select a complete, immutable released infrastructure declaration');
  const ids = new Set(), names = new Set();
  for (const { originalId, imageId, spec } of services) {
    const role = spec?.labels?.['omnitron.service'];
    if (typeof role !== 'string' || !name.test(role) || names.has(role) || !digest.test(originalId ?? '') || ids.has(originalId) ||
        !/^sha256:[a-f0-9]{64}$/.test(imageId ?? '') || spec.name !== [project, stack, role].join('-') ||
        spec.labels['omnitron.managed'] !== 'true' || spec.labels['omnitron.project'] !== project ||
        spec.labels['omnitron.stack'] !== stack || typeof spec.image !== 'string' || !spec.image ||
        typeof spec.environment !== 'object' || spec.environment === null || Array.isArray(spec.environment))
      fail('A released container has invalid or ambiguous ownership');
    names.add(role);
    ids.add(originalId);
    for (const [key, value] of Object.entries(spec.environment)) {
      if (!field.test(key) || !(typeof value === 'string' || isBinding(value))) fail('Invalid released environment binding');
    }
  }
  return declaration;
}

function isBinding(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    exact(Object.keys(value), ['binding']) && typeof value.binding === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value.binding);
}

/** The only values accepted from a provider are the references the released declaration requests. */
export function requiredBindings(declaration) {
  return [...new Set(checkedDeclaration(declaration).services.flatMap(({ spec }) =>
    Object.values(spec.environment).filter(isBinding).map(value => value.binding)))].sort();
}

export function materialized(spec, bindings) {
  const environment = {};
  for (const [key, value] of Object.entries(spec.environment)) {
    if (typeof value === 'string') { environment[key] = value; continue; }
    if (!Object.hasOwn(bindings, value.binding)) return null;
    const secret = bindings[value.binding];
    if (typeof secret !== 'string' || !secret || secret.includes('\0') || Buffer.byteLength(secret) > 65536)
      fail('Registered environment binding is unavailable');
    environment[key] = secret;
  }
  return { ...spec, environment };
}

/** All filters are ordinary Docker CLI arguments. No formatter or full container inspection is needed. */
export function dockerInventory(docker, scope, role, label, all = false) {
  const args = ['ps', ...(all ? ['--all'] : []), '--quiet', '--no-trunc', '--filter', 'label=omnitron.managed=true',
    '--filter', 'label=omnitron.project=' + scope.project, '--filter', 'label=omnitron.stack=' + scope.stack];
  if (role) args.push('--filter', 'label=omnitron.service=' + role, '--filter', 'name=^/' + [scope.project, scope.stack, role].join('-') + '$');
  if (label) args.push('--filter', 'label=' + label);
  const raw = docker(args).trim();
  const ids = raw ? raw.split(/\r?\n/) : [];
  if (ids.some(id => !digest.test(id)) || new Set(ids).size !== ids.length) fail('Native Docker inventory is ambiguous');
  return ids;
}

export function localDocker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  if (result.status !== 0 || result.error) fail('Docker could not verify the retained infrastructure');
  return result.stdout;
}

/** A failed or unbound row never admits the whole set. Private material and its fingerprints stay inside the selected owner. */
export function compareOriginal(declaration, { docker, fingerprint, bindings = {}, recordMatch }) {
  checkedDeclaration(declaration);
  const requested = new Set(requiredBindings(declaration));
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) ||
      Object.keys(bindings).some(key => !requested.has(key))) fail('Private provider returned a binding outside the release');
  const ids = declaration.services.map(row => row.originalId);
  const scope = { project: declaration.project, stack: declaration.stack };
  const whole = () => exact(dockerInventory(docker, scope, undefined, undefined, true), ids);
  if (!whole()) fail('Original running stack membership differs from the release');
  const services = Object.create(null);
  for (const { originalId, imageId, spec } of declaration.services) {
    const role = spec.labels['omnitron.service'];
    if (docker(['image', 'ls', '--quiet', '--no-trunc', '--', spec.image]).trim() !== imageId)
      fail('A retained image tag no longer resolves to the reviewed immutable image');
    const present = label => exact(dockerInventory(docker, scope, role, label), [originalId]);
    if (!present('omnitron.spec-hash') || dockerInventory(docker, scope, role, 'omnitron.spec-hash-schema').length)
      fail('The original object does not have a legacy creation receipt');
    const resolved = materialized(spec, bindings);
    if (!resolved) { services[role] = 'binding-required'; continue; }
    const hash = fingerprint(resolved);
    if (!/^[a-f0-9]{16}$/.test(hash)) fail('The selected runtime did not return a legacy fingerprint');
    services[role] = present('omnitron.spec-hash=' + hash) ? 'matched' : 'different';
    if (services[role] === 'matched') recordMatch?.(role, hash);
  }
  if (!whole()) fail('Original running stack membership changed during the review');
  return {
    protocol: 1, ...scope, release: declaration.release, manifestSha256: declaration.manifestSha256,
    declarationSha256: createHash('sha256').update(JSON.stringify(declaration)).digest('hex'),
    services, eligible: Object.values(services).every(outcome => outcome === 'matched'),
  };
}
