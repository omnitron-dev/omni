import { createHash, createPublicKey } from 'node:crypto';
import { stableJson } from '../shared/canonical-json.js';
import { credentialKey } from './service-credentials.js';
import { legacyContainerSpecHash } from './container-runtime.js';
import type { ResolvedContainer } from './types.js';

export const bindingRoles = ['postgres', 'minio', 'nominatim'] as const;
export type BindingRole = (typeof bindingRoles)[number];
export type BindingOrigin = 'master' | 'source';
export type BindingPurpose = 'compare' | 'seal' | 'create-stopped';
export interface BindingIdentity { signing: string; encryption: string }
export interface BindingTicket {
  protocol: 1;
  id: string;
  project: string;
  stack: string;
  release: string;
  manifestSha256: string;
  declarationSha256: string;
  master: { nodeId: string; identity: BindingIdentity };
  source: { nodeId: string; identity: BindingIdentity };
  engineSocket: string;
  purpose: BindingPurpose;
  expiresAt: number;
  consumer: null | {
    helperSha256: string; runtimeSha256: string; runtimeManifestSha256: string; optionsSha256: string;
    comparison: string;
  };
}
type DeclaredSpec = Omit<ResolvedContainer, 'environment'> & { environment: Record<string, string | { binding: string }> };
type DeclaredRow = { originalId: string; imageId: string; spec: DeclaredSpec };
export interface BindingSubject { services: DeclaredRow[] }

export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const ticketDigest = (ticket: BindingTicket) => sha256(stableJson(ticket));
export const isSha = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export const isId = (s: unknown): s is string => typeof s === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
export const fields = (v: unknown, keys: string[]) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const assertBinding: (condition: unknown) => asserts condition = condition => {
  if (!condition) throw Error('Retained infrastructure authorization or subject differs');
};
export function publicKey(raw: string, type: 'x25519' | 'ed25519') {
  assertBinding(typeof raw === 'string' && /^[A-Za-z0-9_-]{59}$/.test(raw));
  const key = createPublicKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'spki' });
  assertBinding(key.asymmetricKeyType === type && key.export({ format: 'der', type: 'spki' }).toString('base64url') === raw);
  return key;
}
export function validTicket(t: BindingTicket, now: number) {
  assertBinding(fields(t, ['protocol', 'id', 'project', 'stack', 'release', 'manifestSha256', 'declarationSha256',
    'source', 'master', 'purpose', 'engineSocket', 'consumer', 'expiresAt']) && t.protocol === 1 && isId(t.id) &&
    [t.project, t.stack].every(s => typeof s === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(s)) &&
    typeof t.release === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(t.release) &&
    isSha(t.declarationSha256) && isSha(t.manifestSha256) && Number.isSafeInteger(t.expiresAt) &&
    t.expiresAt > now && t.expiresAt <= now + 60 * 60_000 && typeof t.engineSocket === 'string' &&
    /^\/run\/(?:[A-Za-z0-9_-]+\/)*docker\.sock$/.test(t.engineSocket));
  for (const origin of [t.source, t.master]) {
    assertBinding(fields(origin, ['nodeId', 'identity']) && isId(origin.nodeId) && fields(origin.identity, ['signing', 'encryption']));
    publicKey(origin.identity.signing, 'ed25519');
    publicKey(origin.identity.encryption, 'x25519');
  }
  assertBinding(t.master.nodeId !== t.source.nodeId && t.master.identity.signing !== t.source.identity.signing &&
    t.master.identity.encryption !== t.source.identity.encryption);
  if (t.purpose === 'compare') assertBinding(t.consumer === null);
  else assertBinding(['seal', 'create-stopped'].includes(t.purpose) && fields(t.consumer, [
    'helperSha256', 'runtimeSha256', 'runtimeManifestSha256', 'optionsSha256', 'comparison',
  ]) && Object.values(t.consumer!).every(isSha));
}

export function bindingReference(role: BindingRole, project: string, stack: string): string {
  if (role === 'nominatim') return project + '.' + stack + '.nominatim_password';
  return credentialKey(project, stack, role, role === 'postgres' ? 'password' : 'secretKey');
}
const envField = { postgres: 'POSTGRES_PASSWORD', minio: 'MINIO_ROOT_PASSWORD', nominatim: 'NOMINATIM_PASSWORD' };
export const safeBinding = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  !value.includes('\0') && Buffer.byteLength(value) <= 16384;

/** A fixed field at each of the three origins; neither a candidate value nor a key selector is an RPC input. */
export function readSubject(ticket: BindingTicket, bytes: string): BindingSubject {
  assertBinding(typeof bytes === 'string' && Buffer.byteLength(bytes) <= 262144 && sha256(bytes) === ticket.declarationSha256);
  const d = JSON.parse(bytes);
  assertBinding(d?.protocol === 1 && d.project === ticket.project && d.stack === ticket.stack &&
    d.release === ticket.release && d.manifestSha256 === ticket.manifestSha256 && Array.isArray(d.services) &&
    d.services.length >= 3 && d.services.length <= 32);
  const seen = new Set<string>(), ids = new Set<string>();
  for (const { originalId, imageId, spec } of d.services as DeclaredRow[]) {
    const role = spec?.labels?.['omnitron.service'];
    assertBinding(role && /^[a-z][a-z0-9-]{0,62}$/.test(role) && !seen.has(role) && isSha(originalId) &&
      !ids.has(originalId) && /^sha256:[a-f0-9]{64}$/.test(imageId) &&
      spec.name === [ticket.project, ticket.stack, role].join('-') && spec.labels['omnitron.managed'] === 'true' &&
      spec.labels['omnitron.project'] === ticket.project && spec.labels['omnitron.stack'] === ticket.stack &&
      spec.environment && typeof spec.environment === 'object' && !Array.isArray(spec.environment));
    seen.add(role); ids.add(originalId);
    const expected = bindingRoles.find(r => r === role);
    const refs = Object.entries(spec.environment).filter(([, v]) => typeof v !== 'string');
    if (!expected) { assertBinding(!refs.length); continue; }
    const val = spec.environment[envField[expected]];
    assertBinding(refs.length === 1 && fields(val, ['binding']) && typeof val === 'object' &&
      val.binding === bindingReference(expected, ticket.project, ticket.stack));
  }
  assertBinding(bindingRoles.every(r => seen.has(r)));
  return d;
}
export function roleRow(subject: BindingSubject, role: BindingRole) {
  return subject.services.find(r => r.spec.labels['omnitron.service'] === role)!;
}
export function bindingFingerprint(subject: BindingSubject, role: BindingRole, value: string): string {
  assertBinding(safeBinding(value));
  const { spec } = roleRow(subject, role);
  return legacyContainerSpecHash({ ...spec, environment: { ...spec.environment, [envField[role]]: value } as Record<string, string> });
}
