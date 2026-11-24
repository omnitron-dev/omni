import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseRecoveryIntent, parseRecoveryReceipt, recoveryIntentDigest, RECOVERY_METHOD,
  signRecoveryEnvelope, verifyRecoveryEnvelope, type RecoveryIntent, type RecoveryReceipt,
} from './owner-recovery.js';

const intent: RecoveryIntent = {
  version: 1, installationId: 'host-1', ownerId: 'owner-1', ownerGeneration: 1,
  recipientId: 'notes', pairingGeneration: 1, subjectId: 'user-9', credentialRevision: 3,
  method: RECOVERY_METHOD, operationId: 'f76c9b8b-af94-4427-8cff-a573a4673093',
  browserBinding: 'a'.repeat(64), issuedAt: 1_700_000_000_000, expiresAt: 1_700_000_300_000,
};

describe('owner recovery v1 wire identity', () => {
  it('gives differently ordered transports the same digest and binds each field', () => {
    const sorted = JSON.stringify(intent, Object.keys(intent).sort());
    const expected = createHash('sha256').update('omnitron.owner-recovery/v1/intent\0' + sorted).digest('hex');
    expect(recoveryIntentDigest(intent)).toBe(expected);
    expect(recoveryIntentDigest(parseRecoveryIntent(JSON.parse(sorted)))).toBe(expected);
    for (const patch of [
      { subjectId: 'user-19' }, { ownerId: 'another' }, { recipientId: 'notes-2' },
      { installationId: 'other' }, { ownerGeneration: 2 }, { pairingGeneration: 2 },
      { credentialRevision: 5 }, { browserBinding: 'b'.repeat(64) }, { issuedAt: intent.issuedAt + 1 },
    ]) expect(recoveryIntentDigest({ ...intent, ...patch })).not.toBe(expected);
    for (const patch of [
      { version: 2 }, { method: 'another' }, { extra: 1 }, { expiresAt: intent.expiresAt + 1 },
      { browserBinding: 'short' }, { operationId: 'not-an-operation' }, { credentialRevision: -1 },
    ]) expect(() => parseRecoveryIntent({ ...intent, ...patch })).toThrow();
  });

  it('separates actions, validates the expected signer and accepts canonicalized fields', () => {
    const signer = generateKeyPairSync('ed25519');
    const other = generateKeyPairSync('ed25519');
    const envelope = signRecoveryEnvelope('pair', { id: 'notes', revision: 1 }, signer.privateKey);
    const reordered = { signature: envelope.signature, payload: { revision: 1, id: 'notes' } };
    expect(verifyRecoveryEnvelope('pair', reordered, signer.publicKey)).toEqual(envelope.payload);
    expect(() => verifyRecoveryEnvelope('pair-challenge', reordered, signer.publicKey)).toThrow();
    expect(() => verifyRecoveryEnvelope('pair', reordered, other.publicKey)).toThrow();
    expect(() => verifyRecoveryEnvelope('pair', { ...reordered, payload: { id: 'notes', revision: 2 } }, signer.publicKey)).toThrow();
    expect(() => verifyRecoveryEnvelope('pair', { ...reordered, secret: 'extra' }, signer.publicKey)).toThrow();
    expect(() => signRecoveryEnvelope('pair', { value: NaN }, signer.privateKey)).toThrow();
    expect(() => signRecoveryEnvelope('pair', { value: undefined }, signer.privateKey)).toThrow();
  });

  it('requires the original subject, intent and revision for each terminal decision', () => {
    const receipt: RecoveryReceipt = {
      installationId: intent.installationId, recipientId: intent.recipientId, pairingGeneration: 1,
      subjectId: intent.subjectId, operationId: intent.operationId, digest: recoveryIntentDigest(intent),
      outcome: 'applied', credentialRevision: 4,
    };
    expect(parseRecoveryReceipt(receipt, intent)).toEqual(receipt);
    const fenced = { ...receipt, outcome: 'fenced', credentialRevision: 3 };
    expect(parseRecoveryReceipt(fenced, intent)).toEqual(fenced);
    for (const patch of [{ outcome: 'expired' }, { outcome: 'fenced' }, { credentialRevision: 3 }, { subjectId: 'other' }]) {
      expect(() => parseRecoveryReceipt({ ...receipt, ...patch }, intent)).toThrow();
    }
  });
});
