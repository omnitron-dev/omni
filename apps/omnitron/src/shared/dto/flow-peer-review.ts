import type { FlowRef, FlowSubmissionReceipt, FlowWorkspace } from './flow-runtime.js';

/** Administrators exchange these public documents before the encrypted graph travels over the management connection. */
export interface FlowReviewOffer {
  version: 1;
  transferId: string;
  workspace: FlowWorkspace;
  sourceRegistration: string;
  sourceRevision: string;
  digest: string;
  senderKey: string;
}
export interface FlowReviewInvitation {
  offer: FlowReviewOffer;
  destinationRegistration: string;
  expiresAt: number;
  destinationKey: string;
  encryptionKey: string;
}
export interface FlowReviewSelection extends FlowRef {
  revision: string;
  nodeId: string;
}
export interface FlowReviewProbe {
  transferId: string;
  ticket: string;
  nonce: string;
  signature: string;
}
export interface FlowReviewResponse {
  receipt: FlowSubmissionReceipt | null;
  proof: string;
}
/** Available only to a service identity on the management connection. */
export interface IFlowReviewPeer {
  probe(input: FlowReviewProbe): Promise<FlowReviewResponse>;
  receive(input: FlowReviewProbe & { ciphertext: string }): Promise<FlowReviewResponse>;
}
export interface IFlowReviewService {
  prepare(input: FlowReviewSelection & { transferId: string }): Promise<FlowReviewOffer>;
  invite(input: { workspace: FlowWorkspace; offer: FlowReviewOffer }): Promise<FlowReviewInvitation>;
  revoke(input: { workspace: FlowWorkspace; offer: FlowReviewOffer }): Promise<void>;
  incomingReceipt(input: { workspace: FlowWorkspace; offer: FlowReviewOffer }): Promise<FlowSubmissionReceipt | null>;
  deliver(
    input: FlowReviewSelection & { invitation: FlowReviewInvitation; mode: 'send' | 'receipt' }
  ): Promise<FlowSubmissionReceipt | null>;
}
export function isPortableFlow(definition: unknown) {
  return (
    object(definition) &&
    Array.isArray(definition['nodes']) &&
    definition['nodes'].length > 0 &&
    definition['nodes'].every(
      (node) => object(node) && (node['type'] === 'input.manual@1' || node['type'] === 'output.notify@1')
    )
  );
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const publicKey = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{59}$/.test(value);
export const isReviewId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const scopeName = (value: unknown) =>
  typeof value === 'string' &&
  !!value &&
  value.length <= 160 &&
  value.trim() === value &&
  Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
export function isReviewWorkspace(value: unknown): value is FlowWorkspace {
  return (
    object(value) &&
    scopeName(value['project']) &&
    (Object.keys(value).length === 1 || (Object.keys(value).length === 2 && scopeName(value['stack'])))
  );
}
export function isFlowReviewOffer(value: unknown): value is FlowReviewOffer {
  return (
    object(value) &&
    Object.keys(value).length === 7 &&
    value['version'] === 1 &&
    isReviewId(value['transferId']) &&
    isReviewWorkspace(value['workspace']) &&
    hash(value['sourceRegistration']) &&
    hash(value['sourceRevision']) &&
    hash(value['digest']) &&
    publicKey(value['senderKey'])
  );
}
export function isFlowReviewInvitation(value: unknown): value is FlowReviewInvitation {
  return (
    object(value) &&
    Object.keys(value).length === 5 &&
    isFlowReviewOffer(value['offer']) &&
    hash(value['destinationRegistration']) &&
    typeof value['expiresAt'] === 'number' &&
    Number.isSafeInteger(value['expiresAt']) &&
    value['expiresAt'] > 0 &&
    publicKey(value['destinationKey']) &&
    publicKey(value['encryptionKey'])
  );
}
