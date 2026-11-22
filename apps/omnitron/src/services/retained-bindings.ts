import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CompactEncrypt, compactDecrypt } from 'jose';
import { stableJson } from '../shared/canonical-json.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { SecretsService } from './secrets.service.js';
import { assertBinding, bindingFingerprint, bindingRoles, fields, isId, isSha, publicKey, readSubject,
  safeBinding, sha256, ticketDigest, validTicket, type BindingIdentity, type BindingOrigin, type BindingRole, type BindingTicket,
} from '../infrastructure/retained-binding-ticket.js';
import { consumerOptions, matchOriginal, ownerDirectory, ownerFile, prepareConsumer, retainedConsumerManifest } from '../infrastructure/retained-binding-consumer.js';

const domain = 'omnitron/retained-infrastructure-bindings/1';
const wire = (purpose: string, doc: unknown) => Buffer.from(stableJson([domain, purpose, doc]));
const privateKey = (encoded: string) => createPrivateKey({ format: 'der', type: 'pkcs8', key: Buffer.from(encoded, 'base64url') });
type KeyPair = { signer: string; opener: string };
function ownerKeys(home: string): KeyPair {
  const dir = ownerDirectory(path.join(home, 'retained-bindings'), true);
  const file = path.join(dir, 'identity.json');
  const read = () => JSON.parse(ownerFile(file, 4096, true).toString()) as KeyPair;
  try { return read(); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const tmp = path.join(dir, randomUUID());
  const pair = {
    signer: generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
    opener: generateKeyPairSync('x25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  };
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(pair)); fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(tmp, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  } finally { unlinkSync(tmp); }
  const dfd = openSync(dir, 'r');
  try { fsyncSync(dfd); } finally { closeSync(dfd); }
  return read();
}
function identity(keys: KeyPair): BindingIdentity {
  const derive = (key: string) => createPublicKey(privateKey(key)).export({ format: 'der', type: 'spki' }).toString('base64url');
  return { signing: derive(keys.signer), encryption: derive(keys.opener) };
}
type Signature<T> = { document: T; signature: string };
function certified<T>(keys: KeyPair, purpose: string, document: T): Signature<T> {
  return { document, signature: sign(null, wire(purpose, document), privateKey(keys.signer)).toString('base64url') };
}
function authentic<T>(key: string, purpose: string, signed: Signature<T>) {
  assertBinding(fields(signed, ['document', 'signature']) && typeof signed.signature === 'string' &&
    /^[a-zA-Z0-9_-]{86}$/.test(signed.signature) && verify(null, wire(purpose, signed.document), publicKey(key, 'ed25519'),
      Buffer.from(signed.signature, 'base64url')));
}
type Status = 'matched' | 'different' | 'unavailable';
type Compare = { scope: string; ticket: string; rows: Record<BindingRole, Status> };
export type ComparisonProof = Signature<Compare>;
export type BindingCapsule = Signature<{ ticket: string; ciphertext: string }>;
export type BindingAdmission = Signature<{ id: string; ticket: string; origin: BindingOrigin; expiresAt: number; purpose: BindingTicket['purpose'] }>;
type Materialization = Awaited<ReturnType<Awaited<ReturnType<typeof prepareConsumer>>>>;
interface Approval {
  ticket: BindingTicket;
  declaration: string;
  origin: BindingOrigin;
  options: string | null;
  state: 'approved' | 'issued' | 'finished' | 'revoked';
  result?: BindingCapsule | ComparisonProof | Materialization;
}
export interface ApproveRetained {
  ticket: BindingTicket; expect: string; declaration: string; options: string | null; comparison: ComparisonProof | null;
}
export interface ApplyRetained { id: string; expect: string; capsule: BindingCapsule | null; sourceApproval: BindingAdmission | null }
const scope = (t: BindingTicket) => sha256(stableJson([domain, t.project, t.stack, t.release, t.manifestSha256,
  t.declarationSha256, t.master, t.source, t.engineSocket]));
const slot = (id: string) => 'retained-bindings:approval:' + id;
export class RetainedBindings {
  constructor(private home: string, private store: Pick<DaemonStateStore, 'kvUpdateSync' | 'kvGetSync'>,
    private vault: Pick<SecretsService, 'withRetainedBindings'>, private admit: () => Promise<void>,
    private compare = matchOriginal, private consumer = prepareConsumer) {}

  identity() { return identity(ownerKeys(this.home)); }

  approve(input: ApproveRetained): BindingAdmission {
    assertBinding(fields(input, ['ticket', 'expect', 'declaration', 'options', 'comparison']));
    const { ticket: t, declaration, options, comparison } = input;
    validTicket(t, Date.now());
    assertBinding(ticketDigest(t) === input.expect);
    const local = ownerKeys(this.home);
    const ident = stableJson(identity(local));
    const origin = ident === stableJson(t.source.identity) ? 'source' : 'master';
    assertBinding(ident === stableJson(t[origin].identity));
    readSubject(t, declaration);
    if (t.purpose === 'compare') assertBinding(comparison === null && options === null);
    else {
      assertBinding(t.consumer?.helperSha256 === retainedConsumerManifest && comparison &&
        fields(comparison.document, ['scope', 'ticket', 'rows']) && comparison.document.scope === scope(t) &&
        isSha(comparison.document.ticket) && fields(comparison.document.rows, [...bindingRoles]) &&
        bindingRoles.every(r => comparison.document.rows[r] === 'matched') && sha256(stableJson(comparison)) === t.consumer.comparison);
      authentic(t.source.identity.signing, 'comparison', comparison);
      if (origin === 'source') {
        assertBinding(typeof options === 'string');
        consumerOptions(t, options, this.home);
      } else assertBinding(options === null);
    }
    const row: Approval = { ticket: t, declaration, options, origin, state: 'approved' };
    this.store.kvUpdateSync<Approval>(slot(t.id), old => {
      if (!old) return row;
      assertBinding(old.state === 'approved' && stableJson(old) === stableJson(row));
      return old;
    });
    return certified(local, 'approval', { id: t.id, ticket: input.expect, origin, purpose: t.purpose, expiresAt: t.expiresAt });
  }

  revoke(id: string, expect: string) {
    assertBinding(isId(id) && isSha(expect));
    this.store.kvUpdateSync<Approval>(slot(id), old => {
      assertBinding(old && ticketDigest(old.ticket) === expect && ['approved', 'revoked'].includes(old.state));
      return { ...old, state: 'revoked' };
    });
    return { id, revoked: true };
  }

  async apply(input: ApplyRetained) {
    assertBinding(fields(input, ['id', 'expect', 'capsule', 'sourceApproval']) && isId(input.id) && isSha(input.expect));
    const key = slot(input.id);
    const grant = this.store.kvGetSync<Approval>(key, { strict: true });
    assertBinding(grant && grant.state !== 'revoked' && ticketDigest(grant.ticket) === input.expect);
    const t = grant.ticket;
    validTicket(t, Date.now());
    const local = ownerKeys(this.home);
    assertBinding(stableJson(identity(local)) === stableJson(t[grant.origin].identity));
    const subject = readSubject(t, grant.declaration);
    const digest = input.expect;
    const capsule = input.capsule;
    if (grant.origin === 'master') {
      const approval = input.sourceApproval;
      assertBinding(capsule === null && approval && stableJson(approval.document) === stableJson({
        id: t.id, ticket: digest, origin: 'source', purpose: t.purpose, expiresAt: t.expiresAt,
      }));
      authentic(t.source.identity.signing, 'approval', approval);
    }
    else {
      assertBinding(input.sourceApproval === null && capsule && fields(capsule.document, ['ticket', 'ciphertext']) && capsule.document.ticket === digest &&
        typeof capsule.document.ciphertext === 'string' && capsule.document.ciphertext.length < 32768);
      authentic(t.master.identity.signing, 'capsule', capsule);
    }
    if (grant.state === 'finished' && grant.result) return grant.result;
    await this.admit();
    const live = () => assertBinding(t.expiresAt > Date.now() && this.store.kvGetSync<Approval>(key, { strict: true })?.state === 'issued');
    this.store.kvUpdateSync<Approval>(key, old => {
      assertBinding(old?.state === 'approved' && ticketDigest(old.ticket) === digest && t.expiresAt > Date.now());
      return { ...old, state: 'issued' };
    });
    let result: NonNullable<Approval['result']>;
    if (grant.origin === 'master') {
      result = await this.vault.withRetainedBindings('master', t.project, t.stack, async rows => {
        live();
        const value = rows.nominatim;
        if (t.purpose !== 'compare') assertBinding(safeBinding(value));
        const doc = t.purpose === 'compare' ? { fingerprint: value ? bindingFingerprint(subject, 'nominatim', value) : null } : { binding: value };
        const plain = Buffer.from(stableJson(doc));
        try {
          const ciphertext = await new CompactEncrypt(plain).setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM' })
            .encrypt(publicKey(t.source.identity.encryption, 'x25519'));
          live();
          return certified(local, 'capsule', { ticket: digest, ciphertext });
        } finally { plain.fill(0); }
      });
    } else {
      const { plaintext } = await compactDecrypt(capsule!.document.ciphertext, privateKey(local.opener), {
        keyManagementAlgorithms: ['ECDH-ES'], contentEncryptionAlgorithms: ['A256GCM'],
      });
      let doc;
      try { doc = JSON.parse(Buffer.from(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength).toString()); }
      finally { plaintext.fill(0); }
      const consume = t.purpose === 'compare' ? null : await this.consumer(this.home, t, grant.declaration, grant.options!);
      if (consume) assertBinding(fields(doc, ['binding']) && safeBinding(doc.binding));
      else assertBinding(fields(doc, ['fingerprint']) && (doc.fingerprint === null ||
        (typeof doc.fingerprint === 'string' && /^[a-f0-9]{16}$/.test(doc.fingerprint))));
      await this.admit(); live();
      result = await this.vault.withRetainedBindings('source', t.project, t.stack, async localRows => {
        live();
        if (consume) {
          assertBinding(safeBinding(localRows.postgres) && safeBinding(localRows.minio));
          return consume({ postgres: localRows.postgres, minio: localRows.minio, nominatim: doc.binding });
        }
        const rows = {} as Record<BindingRole, Status>;
        for (const role of bindingRoles) {
          const value = localRows[role];
          const fingerprint = role === 'nominatim' ? doc.fingerprint : value && bindingFingerprint(subject, role, value);
          rows[role] = !fingerprint ? 'unavailable' : await this.compare(t, subject, role, fingerprint) ? 'matched' : 'different';
        }
        live();
        return certified(local, 'comparison', { scope: scope(t), ticket: digest, rows });
      });
    }
    this.store.kvUpdateSync<Approval>(key, old => {
      assertBinding(old?.state === 'issued');
      // A closed-consumer packet carries encrypted material. The master issues it once and retains only the decision.
      return grant.origin === 'master' && t.purpose !== 'compare' ? { ...old, state: 'finished' } : { ...old, state: 'finished', result };
    });
    return result;
  }
}
