import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { CompactEncrypt, compactDecrypt } from 'jose';
import { stableJson } from '../shared/canonical-json.js';
import {
  type FlowReviewOffer,
  type FlowReviewInvitation,
  isPortableFlow,
  isFlowReviewOffer,
  isFlowReviewInvitation,
  isReviewWorkspace,
} from '../shared/dto/flow-peer-review.js';
import type { FlowWorkspace } from '../shared/dto/flow-runtime.js';
import { validateFlow, type FlowDefinition, type FlowRegistry } from '../shared/dto/flows.js';

const domain = 'omnitron/peer-flow-review/v1';
export const digest = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
export const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
export function fields(value: unknown, names: string[]): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    names.every((k) => Object.hasOwn(value, k))
  );
}
export function projectScope(value: FlowWorkspace) {
  if (!isReviewWorkspace(value)) throw Error('Select the registered project and stack for this transfer');
}
function publicKey(value: unknown, type: 'ed25519' | 'x25519') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{59}$/.test(value)) throw Error('Invalid flow review public key');
  const key = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== type || key.export({ format: 'der', type: 'spki' }).toString('base64url') !== value)
    throw Error('Invalid flow review public key');
  return key;
}
export function offerDocument(offer: FlowReviewOffer) {
  if (!isFlowReviewOffer(offer)) throw Error('Invalid public flow offer');
  publicKey(offer.senderKey, 'ed25519');
}
export function invitationDocument(invite: FlowReviewInvitation) {
  if (!isFlowReviewInvitation(invite)) throw Error('Invalid public flow invitation');
  offerDocument(invite.offer);
  publicKey(invite.destinationKey, 'ed25519');
  publicKey(invite.encryptionKey, 'x25519');
}
export function portable(value: unknown, registry: FlowRegistry): asserts value is FlowDefinition {
  if (!isPortableFlow(value) || Buffer.byteLength(stableJson(value)) > 65536)
    throw Error('Peer review accepts manual input and local notification graphs up to 64 KiB');
  validateFlow(value, registry);
}
const privateKey = (raw: string) =>
  createPrivateKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'pkcs8' });
export function keys(type: 'ed25519' | 'x25519') {
  const pair = type === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('x25519');
  return {
    public: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    private: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
}
const signed = (parts: unknown[]) => Buffer.from(stableJson([domain, ...parts]));
export function signature(secret: string, ...parts: unknown[]) {
  return sign(null, signed(parts), privateKey(secret)).toString('base64url');
}
export function checkSignature(key: string, proof: string, ...parts: unknown[]) {
  if (
    typeof proof !== 'string' ||
    !/^[a-zA-Z0-9_-]{86}$/.test(proof) ||
    !verify(null, signed(parts), publicKey(key, 'ed25519'), Buffer.from(proof, 'base64url'))
  )
    throw Error('The peer did not prove the reviewed flow transfer');
}
export async function encryptGraph(invitation: FlowReviewInvitation, graph: FlowDefinition) {
  return new CompactEncrypt(Buffer.from(stableJson(graph)))
    .setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM' })
    .encrypt(publicKey(invitation.encryptionKey, 'x25519'));
}
export async function decryptGraph(secret: string, body: string): Promise<unknown> {
  if (typeof body !== 'string' || body.length > 100000) throw Error('Invalid encrypted flow');
  const { plaintext } = await compactDecrypt(body, privateKey(secret), {
    keyManagementAlgorithms: ['ECDH-ES'],
    contentEncryptionAlgorithms: ['A256GCM'],
  });
  if (plaintext.length > 65536) throw Error('Invalid encrypted flow');
  return JSON.parse(Buffer.from(plaintext).toString('utf8'));
}
