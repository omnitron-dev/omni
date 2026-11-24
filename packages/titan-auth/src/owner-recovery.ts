import {
  createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify,
} from 'node:crypto';

export const RECOVERY_METHOD = 'ApplicationOwnerRecovery@1.replaceOwnPassword' as const;
export const RECOVERY_LIFETIME_MS = 5 * 60_000;

export interface RecoveryIntent {
  version: 1;
  installationId: string;
  ownerId: string;
  ownerGeneration: number;
  recipientId: string;
  pairingGeneration: number;
  subjectId: string;
  credentialRevision: number;
  method: typeof RECOVERY_METHOD;
  operationId: string;
  browserBinding: string;
  issuedAt: number;
  expiresAt: number;
}
export interface RecoveryGrant {
  intent: RecoveryIntent;
  digest: string;
}
export interface RecoveryReceipt {
  operationId: string;
  digest: string;
  installationId: string;
  recipientId: string;
  pairingGeneration: number;
  subjectId: string;
  outcome: 'applied' | 'fenced';
  credentialRevision: number;
}
export interface RecoveryEnvelope<T> {
  payload: T;
  signature: string;
}
const domains = [
  'begin', 'claim', 'status', 'cancel', 'acknowledge', 'grant', 'receipt', 'fence',
  'receipt-query', 'commission', 'pair-challenge', 'pair',
] as const;
export type RecoveryDomain = (typeof domains)[number];
type SigningKey = KeyObject | string | Buffer;

function invalid(): never {
  throw new Error('Invalid owner recovery message');
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exact<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}

function boundedInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/.test(value);
}

const intentKeys = [
  'version', 'installationId', 'ownerId', 'ownerGeneration', 'recipientId', 'pairingGeneration',
  'subjectId', 'credentialRevision', 'method', 'operationId', 'browserBinding', 'issuedAt', 'expiresAt',
] as const;

export function parseRecoveryIntent(value: unknown): RecoveryIntent {
  if (!exact(value, intentKeys) || value.version !== 1 || value.method !== RECOVERY_METHOD ||
      ![value.installationId, value.ownerId, value.recipientId, value.subjectId].every(identifier) ||
      !boundedInteger(value.ownerGeneration, 1) || !boundedInteger(value.pairingGeneration, 1) ||
      !boundedInteger(value.credentialRevision, 0) || value.credentialRevision >= Number.MAX_SAFE_INTEGER ||
      !boundedInteger(value.issuedAt, 0) || !boundedInteger(value.expiresAt, 1) ||
      value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > RECOVERY_LIFETIME_MS ||
      typeof value.operationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId) ||
      typeof value.browserBinding !== 'string' || !/^[a-f0-9]{64}$/.test(value.browserBinding)) return invalid();
  return value as unknown as RecoveryIntent;
}

// RFC 8785 restricted to the JSON types in this protocol. Serializing sorted
// entries directly also keeps integer-like object keys in lexical order.
function encoded(domain: RecoveryDomain | 'intent', payload: unknown): Buffer {
  let remaining = 32_768;
  let nodes = 0;
  function stringValue(value: string): string {
    remaining -= Buffer.byteLength(value);
    if (remaining < 0 || /[\uD800-\uDFFF]/u.test(value)) return invalid();
    return JSON.stringify(value);
  }
  function encode(value: unknown, depth: number): string {
    if (depth > 10 || ++nodes > 512) return invalid();
    if (value === null) return 'null';
    if (typeof value === 'string') return stringValue(value);
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) return JSON.stringify(value);
    if (Array.isArray(value)) {
      if (value.length > 128 || Object.keys(value).length !== value.length) return invalid();
      const parts: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) return invalid();
        parts.push(encode(value[i], depth + 1));
      }
      return '[' + parts.join(',') + ']';
    }
    if (!record(value)) return invalid();
    const keys = Object.keys(value).sort();
    if (keys.length > 64) return invalid();
    return '{' + keys.map(key => stringValue(key) + ':' + encode(value[key], depth + 1)).join(',') + '}';
  }
  return Buffer.from('omnitron.owner-recovery/v1/' + domain + '\0' + encode(payload, 0));
}

export function recoveryIntentDigest(intent: RecoveryIntent): string {
  return createHash('sha256').update(encoded('intent', parseRecoveryIntent(intent))).digest('hex');
}

function edKey(key: SigningKey, purpose: 'private' | 'public'): KeyObject {
  const parsed = key instanceof KeyObject ? key : purpose === 'private' ? createPrivateKey(key) : createPublicKey(key);
  if (parsed.type !== purpose || parsed.asymmetricKeyType !== 'ed25519') return invalid();
  return parsed;
}

export function signRecoveryEnvelope<T>(domain: RecoveryDomain, payload: T, privateKey: SigningKey): RecoveryEnvelope<T> {
  if (!domains.includes(domain)) return invalid();
  return { payload, signature: sign(null, encoded(domain, payload), edKey(privateKey, 'private')).toString('base64url') };
}

export function verifyRecoveryEnvelope<T>(domain: RecoveryDomain, envelope: RecoveryEnvelope<T>, publicKey: SigningKey): T;
export function verifyRecoveryEnvelope<T = unknown>(domain: RecoveryDomain, envelope: unknown, publicKey: SigningKey): T;
export function verifyRecoveryEnvelope(domain: RecoveryDomain, envelope: unknown, publicKey: SigningKey): unknown {
  if (!domains.includes(domain) || !exact(envelope, ['payload', 'signature']) || typeof envelope.signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) return invalid();
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.toString('base64url') !== envelope.signature ||
      !verify(null, encoded(domain, envelope.payload), edKey(publicKey, 'public'), signature)) return invalid();
  return envelope.payload;
}

/** Match a recipient's durable decision to the exact authorization being reconciled. */
export function parseRecoveryReceipt(value: unknown, intent: RecoveryIntent): RecoveryReceipt {
  const digest = recoveryIntentDigest(intent);
  if (!exact(value, ['operationId', 'digest', 'installationId', 'recipientId', 'pairingGeneration', 'subjectId', 'outcome', 'credentialRevision']) ||
      value.digest !== digest || value.operationId !== intent.operationId || value.installationId !== intent.installationId ||
      value.recipientId !== intent.recipientId || value.pairingGeneration !== intent.pairingGeneration || value.subjectId !== intent.subjectId ||
      (value.outcome !== 'applied' && value.outcome !== 'fenced') ||
      value.credentialRevision !== intent.credentialRevision + Number(value.outcome === 'applied')) return invalid();
  return value as unknown as RecoveryReceipt;
}
