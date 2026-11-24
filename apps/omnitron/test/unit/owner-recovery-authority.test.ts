import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { chmodSync, copyFileSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { recoveryIntentDigest, signRecoveryEnvelope, verifyRecoveryEnvelope } from '@omnitron-dev/titan-auth/owner-recovery';
import { signOwnerRecoveryManifest } from '../../src/commands/sign-owner-recovery.js';
import { OwnerRecoveryAuthority, type RecoveryAuthorityConfig, type RecoveryCommission } from '../../src/owner-recovery/authority.js';

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fixture() {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'owner-recovery-')));
  cleanups.push(() => rmSync(directory,{ recursive: true, force: true }));
  for (const child of ['authority', 'continuity']) {
    mkdirSync(path.join(directory, child), { mode: 0o700 });
    writeFileSync(path.join(directory, child, 'ledger'), '', { mode: 0o600 });
  }
  const root = generateKeyPairSync('ed25519');
  const controller = generateKeyPairSync('ed25519');
  const recipient = generateKeyPairSync('ed25519');
  const authenticator = generateKeyPairSync('ec',{ namedCurve: 'P-256' });
  const pem = (key: typeof root.publicKey) => key.export({ format: 'pem', type: 'spki' }).toString();
  const sha = (input: string | Buffer) => createHash('sha256').update(input).digest();
  const enrollmentToken = randomBytes(32).toString('base64url');
  const commissioned: RecoveryCommission = {
    installationId: 'fixture-installation', installationLabel: 'Test installation', controllerOrigin: 'https://console.example',
    ownerId: 'fixture-owner', ownerGeneration: 1, controllerPublicKey: pem(controller.publicKey), enrollmentTokenHash: sha(enrollmentToken).toString('hex'),
    recipientId: 'fixture-app', recipientPublicKey: pem(recipient.publicKey), applicationLabel: 'Test application',
    accountLabel: 'Owner', pairingGeneration: 1, subjectId: 'owner-subject', applicationOrigin: 'https://app.example',
    credential: { id: randomBytes(32).toString('base64url'), publicKey: pem(authenticator.publicKey), userHandle: randomBytes(32).toString('base64url') },
  };
  const config: RecoveryAuthorityConfig = {
    databasePath: path.join(directory, 'authority', 'ledger'), continuityPath: path.join(directory, 'continuity', 'ledger'),
    commissioningPublicKey: pem(root.publicKey), signingPrivateKey: controller.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    commission: signRecoveryEnvelope('commission', commissioned, root.privateKey),
  };
  let now = Date.now();
  let authority = new OwnerRecoveryAuthority(config, () => now);
  cleanups.push(() => authority.close());
  let counter = 0;
  function assertion(challenge: string, origin = commissioned.controllerOrigin, flags = 5) {
    const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', origin, challenge, crossOrigin: false }));
    const auth = Buffer.alloc(37);
    sha(new URL(commissioned.controllerOrigin).hostname).copy(auth);
    auth.writeUInt8(flags, 32);
    auth.writeUInt32BE(++counter,33);
    return { id: commissioned.credential.id, rawId: commissioned.credential.id, type: 'public-key', response: {
      clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), userHandle: commissioned.credential.userHandle,
      signature: sign('sha256', Buffer.concat([auth, sha(client)]), authenticator.privateKey).toString('base64url'),
    } };
  }
  function enroll() {
    const challenge = authority.enrollmentChallenge({ enrollmentToken });
    const pair = verifyRecoveryEnvelope('pair-challenge', challenge.pairingChallenge, controller.publicKey);
    return authority.enroll({ enrollmentToken, pairingProof: signRecoveryEnvelope('pair', pair, recipient.privateKey), assertion: assertion(challenge.publicKey.challenge) }).recoveryCodes;
  }
  function begin() {
    const scope = { installationId: commissioned.installationId, recipientId: commissioned.recipientId, operationId: randomUUID(), issuedAt: now };
    const result = authority.begin(signRecoveryEnvelope('begin', { ...scope, credentialRevision: 1, browserBinding: sha(randomBytes(32)).toString('hex') }, recipient.privateKey));
    const review = { operationId: scope.operationId, reviewToken: result.reviewToken };
    const challenge = authority.getChallenge(review).publicKey.challenge;
    const bound = { ...scope, digest: result.digest };
    const status = () => authority.status(signRecoveryEnvelope('status', { ...bound, issuedAt: now }, recipient.privateKey));
    const cancel = () => authority.cancel(signRecoveryEnvelope('cancel', { ...bound, issuedAt: now }, recipient.privateKey));
    return { ...result, review, challenge, bound, status, cancel,
      approve: (code: string) => authority.approve({ ...review, recoveryCode: code, assertion: assertion(challenge) }),
      claim: (continuation: string) => authority.claim(signRecoveryEnvelope('claim', { ...bound, continuation }, recipient.privateKey)),
    };
  }
  function restart() {
    authority.close();
    authority = new OwnerRecoveryAuthority(config, () => now);
  }
  return { directory, config, enrollmentToken, root, controller, recipient, commissioned, assertion, enroll, begin, restart,
    authority: () => authority, advance: (ms: number) => { now += ms; } };
}

describe('installation owner recovery authority', () => {
  it('signs a reviewed public manifest offline, accepts only a private key file and preserves existing outputs', () => {
    const f = fixture();
    const manifest = path.join(f.directory,'owner.json'), key = path.join(f.directory,'key.pem'), output = path.join(f.directory,'authority.json');
    writeFileSync(manifest, JSON.stringify(f.commissioned));
    writeFileSync(key, f.root.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    chmodSync(key,0o644);
    expect(() => signOwnerRecoveryManifest(manifest, { keyFile: key, output })).toThrow();
    chmodSync(key,0o600);
    expect(signOwnerRecoveryManifest(manifest, { keyFile: key, output })).toBe(output);
    const published = readFileSync(output,'utf8');
    expect(verifyRecoveryEnvelope('commission', JSON.parse(published), f.root.publicKey)).toEqual(f.commissioned);
    expect(published).not.toContain('PRIVATE KEY');
    expect(() => signOwnerRecoveryManifest(manifest, { keyFile: key, output })).toThrow();
    expect(readFileSync(output,'utf8')).toBe(published);
  });

  it('requires the commissioning token, authenticated application pairing and user-verifying key before admission', () => {
    const f = fixture();
    expect(() => f.begin()).toThrow();
    expect(() => f.authority().enrollmentChallenge({ enrollmentToken: 'admin' })).toThrow();
    const challenge = f.authority().enrollmentChallenge({ enrollmentToken: f.enrollmentToken });
    const proof = signRecoveryEnvelope('pair', challenge.pairingChallenge.payload, f.recipient.privateKey);
    expect(() => f.authority().enroll({ enrollmentToken: f.enrollmentToken, pairingProof: proof, assertion: f.assertion(challenge.publicKey.challenge, 'https://other.example') })).toThrow();
    expect(() => f.authority().enroll({ enrollmentToken: f.enrollmentToken, pairingProof: proof, assertion: f.assertion(challenge.publicKey.challenge, undefined, 1) })).toThrow();
    expect(() => f.authority().enroll({ enrollmentToken: f.enrollmentToken, pairingProof: challenge.pairingChallenge, assertion: f.assertion(challenge.publicKey.challenge) })).toThrow();
    expect(new Set(f.enroll()).size).toBe(8);
    expect(() => f.enroll()).toThrow();
  });

  it('spends one code on approval, prevents a concurrent subject claim and preserves the unspent code after a conflict', () => {
    const f = fixture();
    const codes = f.enroll();
    const first = f.begin();
    const second = f.begin();
    const proof = first.approve(codes[0]!);
    expect(() => second.approve(codes[1]!)).toThrow();
    f.restart();
    expect(first.cancel().state).toBe('cancelled');
    expect(() => first.claim(proof.continuation)).toThrow();
    expect(() => second.approve(codes[0]!)).toThrow();
    expect(second.approve(codes[1]!).continuation).toHaveLength(43);
  });

  it('reconciles a committed receipt after a lost reply without authorizing another mutation', () => {
    const f = fixture();
    const codes = f.enroll();
    const op = f.begin();
    const approved = op.approve(codes[0]!);
    const grant = verifyRecoveryEnvelope('grant', op.claim(approved.continuation), f.controller.publicKey);
    expect(grant.digest).toBe(recoveryIntentDigest(grant.intent));
    f.restart();
    expect(() => op.claim(approved.continuation)).toThrow();
    const query = op.status().authorization!;
    expect(verifyRecoveryEnvelope('receipt-query', query, f.controller.publicKey)).toEqual(grant);
    expect(verifyRecoveryEnvelope('fence', op.cancel().authorization!, f.controller.publicKey)).toEqual(grant);
    const receipt = { operationId: op.bound.operationId, digest: op.digest, installationId: op.bound.installationId, recipientId: op.bound.recipientId,
      pairingGeneration: 1, subjectId: f.commissioned.subjectId, outcome: 'applied' as const, credentialRevision: 2 };
    const acknowledge = (subjectId: string) => f.authority().acknowledge(signRecoveryEnvelope('acknowledge', { ...op.bound,
      receipt: signRecoveryEnvelope('receipt', { ...receipt, subjectId }, f.recipient.privateKey) }, f.recipient.privateKey));
    expect(() => acknowledge('other')).toThrow();
    expect(acknowledge(receipt.subjectId).state).toBe('applied');
    expect(acknowledge(receipt.subjectId).state).toBe('applied');
    expect(op.cancel()).toEqual({ state: 'applied' });
    const audit = openSqliteDatabase(f.config.databasePath, { readonly: true });
    try {
      const rows = audit.prepare('SELECT payload,signature FROM application_receipts WHERE operation=?').all(op.bound.operationId) as { payload: string; signature: string }[];
      expect(rows).toHaveLength(1);
      expect(verifyRecoveryEnvelope('receipt', { payload: JSON.parse(rows[0]!.payload), signature: rows[0]!.signature }, f.recipient.publicKey)).toEqual(receipt);
    } finally { audit.close(); }
  });

  it('holds failed proof limits over restart and expires unclaimed approvals', () => {
    const f = fixture();
    const codes = f.enroll();
    const op = f.begin();
    for (let i = 0; i < 8; i++) expect(() => op.approve('invalid')).toThrow();
    f.restart();
    expect(() => op.approve(codes[0]!)).toThrow();
    f.advance(300_001);
    expect(op.status().state).toBe('expired');
    const next = f.begin();
    const proof = next.approve(codes[0]!);
    f.advance(300_001);
    expect(() => next.claim(proof.continuation)).toThrow();
    expect(next.status().state).toBe('expired');
  });

  it('requires forward generations, rejects a new trust root and fences an old writer on the same store', () => {
    const f = fixture();
    const codes = f.enroll();
    const op = f.begin();
    op.approve(codes[0]!);
    const next = { ...f.commissioned, ownerGeneration: 2, pairingGeneration: 2 };
    const replacement = { ...f.config, commission: signRecoveryEnvelope('commission', next, f.root.privateKey) };
    const wrongRoot = generateKeyPairSync('ed25519');
    expect(() => new OwnerRecoveryAuthority({ ...replacement,
      commissioningPublicKey: wrongRoot.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      commission: signRecoveryEnvelope('commission', next, wrongRoot.privateKey),
    })).toThrow(/anchor/);
    const current = new OwnerRecoveryAuthority(replacement);
    try {
      expect(() => op.status()).toThrow();
      expect(() => f.begin()).toThrow();
      expect(() => new OwnerRecoveryAuthority(f.config)).toThrow(/generation/);
      expect(current.enrollmentChallenge({ enrollmentToken: f.enrollmentToken }).pairingChallenge.payload.ownerGeneration).toBe(2);
    } finally { current.close(); }
  });

  it('retains unsettled claims across attempted rotation, and reconciles a no-effect receipt', () => {
    const f = fixture();
    const codes = f.enroll();
    const op = f.begin();
    op.claim(op.approve(codes[0]!).continuation);
    const newer = { ...f.config, commission: signRecoveryEnvelope('commission',
      { ...f.commissioned, ownerGeneration: 2, pairingGeneration: 2 }, f.root.privateKey) };
    expect(() => new OwnerRecoveryAuthority(newer)).toThrow(/outstanding/);
    const fence = verifyRecoveryEnvelope('fence', op.cancel().authorization!, f.controller.publicKey);
    const receipt = { operationId: op.bound.operationId, digest: fence.digest, installationId: op.bound.installationId, recipientId: op.bound.recipientId,
      pairingGeneration: 1, subjectId: f.commissioned.subjectId, outcome: 'fenced' as const, credentialRevision: 1 };
    f.authority().acknowledge(signRecoveryEnvelope('acknowledge',
      { ...op.bound, receipt: signRecoveryEnvelope('receipt', receipt, f.recipient.privateKey) }, f.recipient.privateKey));
    expect(op.status()).toEqual({ state: 'fenced' });
    const rotated = new OwnerRecoveryAuthority(newer);
    rotated.close();
  });

  it('recovers a lost enrollment reply only through new commissioning, fresh pairing and fresh owner verification', () => {
    const f = fixture();
    const oldCodes = f.enroll();
    f.restart();
    expect(() => f.enroll()).toThrow();
    const rotated = new OwnerRecoveryAuthority({ ...f.config, commission: signRecoveryEnvelope('commission',
      { ...f.commissioned, ownerGeneration: 2, pairingGeneration: 2 }, f.root.privateKey) });
    try {
      const challenge = rotated.enrollmentChallenge({ enrollmentToken: f.enrollmentToken });
      const proof = signRecoveryEnvelope('pair', challenge.pairingChallenge.payload, f.recipient.privateKey);
      expect(() => rotated.enroll({ enrollmentToken: f.enrollmentToken, pairingProof: proof, assertion: null })).toThrow();
      const enrolled = rotated.enroll({ enrollmentToken: f.enrollmentToken, pairingProof: proof, assertion: f.assertion(challenge.publicKey.challenge) });
      expect(enrolled.recoveryCodes).toHaveLength(8);
      expect(enrolled.recoveryCodes.every(code => !oldCodes.includes(code))).toBe(true);
      const scope = { installationId: f.commissioned.installationId, recipientId: f.commissioned.recipientId, operationId: randomUUID(),
        issuedAt: Date.now(), browserBinding: 'b'.repeat(64), credentialRevision: 1 };
      const op = rotated.begin(signRecoveryEnvelope('begin', scope, f.recipient.privateKey));
      const review = { operationId: scope.operationId, reviewToken: op.reviewToken };
      const current = rotated.getChallenge(review);
      expect(() => rotated.approve({ ...review, recoveryCode: oldCodes[0]!, assertion: f.assertion(current.publicKey.challenge) })).toThrow();
      expect(rotated.approve({ ...review, recoveryCode: enrolled.recoveryCodes[0]!, assertion: f.assertion(current.publicKey.challenge) }).continuation).toHaveLength(43);
    } finally { rotated.close(); }
  });

  it('limits bad assertions to their operation while protecting the owner code budget across operations', () => {
    const f = fixture();
    const codes = f.enroll();
    const bad = f.begin();
    for (let count = 0; count < 9; count++) {
      expect(() => f.authority().approve({ ...bad.review, assertion: null, recoveryCode: codes[0]! })).toThrow();
    }
    expect(() => bad.approve(codes[0]!)).toThrow();
    expect(f.begin().approve(codes[0]!).continuation).toHaveLength(43);
  });

  it('rejects an independently rolled back authority or continuity database', () => {
    const f = fixture();
    f.enroll();
    const oldState = path.join(f.directory, 'earlier-ledger');
    copyFileSync(f.config.databasePath, oldState);
    f.begin();
    f.authority().close();
    copyFileSync(oldState, f.config.databasePath);
    expect(() => new OwnerRecoveryAuthority(f.config)).toThrow(/continuity diverged/);
  });
});
