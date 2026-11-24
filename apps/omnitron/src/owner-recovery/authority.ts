import { createHash, createPrivateKey, createPublicKey, createHmac, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { Errors } from '@omnitron-dev/titan/errors';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import {
  parseRecoveryIntent, parseRecoveryReceipt, recoveryIntentDigest, RECOVERY_LIFETIME_MS, RECOVERY_METHOD, signRecoveryEnvelope, verifyRecoveryEnvelope,
  type RecoveryEnvelope, type RecoveryGrant, type RecoveryReceipt,
} from '@omnitron-dev/titan-auth/owner-recovery';
import { readOwnedServiceBytes } from '../commands/service-record.js';
import { sealSqliteFiles } from '../shared/private-files.js';
import { ownerAssertionOptions, verifyOwnerAssertion, verifyOwnerCredential, type OwnerCredential } from './webauthn.js';

const TTL = RECOVERY_LIFETIME_MS;
const MAX_SKEW = 10_000;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface RecoveryCommission {
  installationId: string;
  installationLabel: string;
  ownerId: string;
  ownerGeneration: number;
  credential: OwnerCredential;
  controllerOrigin: string;
  controllerPublicKey: string;
  enrollmentTokenHash: string;
  recipientId: string;
  recipientPublicKey: string;
  applicationOrigin: string;
  applicationLabel: string;
  accountLabel: string;
  pairingGeneration: number;
  subjectId: string;
}

export interface RecoveryAuthorityConfig {
  commissioningPublicKey: string;
  signingPrivateKey: string;
  databasePath: string;
  continuityPath: string;
  commission: RecoveryEnvelope<RecoveryCommission>;
}

type State = 'pending' | 'approved' | 'claimed' | 'applied' | 'fenced' | 'cancelled' | 'expired';
interface Attempt {
  operation: string;
  intent: string;
  digest: string;
  state: State;
  review: string;
  challenge: string;
  continuation: string | null;
  expires: number;
}

interface Enrollment {
  signature: string;
  root: string;
  installation: string;
  owner_generation: number;
  pairing_generation: number;
  nonce: string | null;
  expires: number;
  active: number;
  counter: number;
  failures: number;
  window: number;
}

interface RequestScope {
  installationId: string;
  recipientId: string;
  operationId: string;
  issuedAt: number;
}

type Begin = RequestScope & { browserBinding: string; credentialRevision: number };
type Operation = RequestScope & { digest: string };
type Claim = Operation & { continuation: string };
type Acknowledge = Operation & { receipt: RecoveryEnvelope<RecoveryReceipt> };
type RecipientAction = 'begin' | 'claim' | 'status' | 'cancel' | 'acknowledge';
type Review = { operationId: string; reviewToken: string };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(): string { return randomBytes(32).toString('base64url'); }

function denied(): never { throw Errors.forbidden('Owner recovery request was not admitted'); }

function secretMatches(value: unknown, expected: string | null): boolean {
  return typeof value === 'string' && TOKEN.test(value) && expected !== null && HASH.test(expected) &&
    timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(expected, 'hex'));
}

function fields(value: object, expected: string[]): void {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) denied();
}

function exactOrigin(value: string): boolean {
  const origin = new URL(value);
  return origin.origin === value && !origin.hostname.endsWith('.') && (origin.protocol === 'https:' ||
    (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)));
}

export function validateRecoveryCommission(c: RecoveryCommission): void {
  fields(c, ['installationId','installationLabel','ownerId','ownerGeneration','credential','controllerOrigin','controllerPublicKey','enrollmentTokenHash',
    'recipientId','recipientPublicKey','applicationOrigin','applicationLabel','accountLabel','pairingGeneration','subjectId']);
  for (const label of [c.installationId,c.installationLabel,c.ownerId,c.recipientId,c.applicationLabel,c.accountLabel,c.subjectId]) {
    if (typeof label !== 'string' || !label || label.length > 150 || label !== label.trim() || /[\p{Cc}\p{Cf}]/u.test(label)) denied();
  }
  for (const generation of [c.ownerGeneration, c.pairingGeneration]) if (!Number.isSafeInteger(generation) || generation < 1) denied();
  if (!exactOrigin(c.controllerOrigin) || !exactOrigin(c.applicationOrigin) || new URL(c.controllerOrigin).hostname === new URL(c.applicationOrigin).hostname || !HASH.test(c.enrollmentTokenHash)) denied();
  fields(c.credential, ['id','publicKey','userHandle']);
  verifyOwnerCredential(c.credential);
  for (const pem of [c.controllerPublicKey, c.recipientPublicKey]) {
    if (typeof pem !== 'string' || !/^-----BEGIN PUBLIC KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem) ||
        createPublicKey(pem).asymmetricKeyType !== 'ed25519') denied();
  }
  if (createPublicKey(c.controllerPublicKey).equals(createPublicKey(c.recipientPublicKey))) denied();
}

export function readRecoveryAuthorityConfig(filename: string): RecoveryAuthorityConfig {
  if (!path.isAbsolute(filename)) throw Error('Owner recovery requires an absolute authority file path');
  const uid = process.getuid?.();
  if (uid === undefined) throw Error('Cannot establish authority file ownership');
  return JSON.parse(readOwnedServiceBytes(filename, uid, 65536, true).toString('utf8')) as RecoveryAuthorityConfig;
}

// Closing a second descriptor of an open SQLite file drops process-wide POSIX locks.
function privateDatabasePath(filename: string): void {
  if (!path.isAbsolute(filename) || realpathSync(filename) !== filename) throw Error('Invalid recovery authority database path');
  const file = lstatSync(filename);
  const directory = lstatSync(path.dirname(filename));
  if (!file.isFile() || file.nlink !== 1 || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0 ||
      !directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) {
    throw Error('Recovery authority requires private files and directories owned by the daemon');
  }
}

export class OwnerRecoveryAuthority {
  private readonly db: Database;
  private readonly commission: RecoveryCommission;
  private readonly signingKey: KeyObject;
  private readonly recipientKey: KeyObject;
  private readonly reviewKey: Buffer;
  private readonly signature: string;

  constructor(config: RecoveryAuthorityConfig, private readonly now = Date.now) {
    const c = this.commission = verifyRecoveryEnvelope('commission', config.commission, config.commissioningPublicKey);
    validateRecoveryCommission(c);
    this.signature = config.commission.signature;
    this.signingKey = createPrivateKey(config.signingPrivateKey);
    if (!createPublicKey(this.signingKey).equals(createPublicKey(c.controllerPublicKey))) throw Error('Recovery signer differs from the commissioned key');
    this.recipientKey = createPublicKey(c.recipientPublicKey);
    const commissioning = createPublicKey(config.commissioningPublicKey);
    if (commissioning.equals(this.recipientKey) || commissioning.equals(createPublicKey(c.controllerPublicKey))) {
      throw Error('The offline commissioning key must be independent of both service keys');
    }
    const keyBytes = this.signingKey.export({ format: 'der', type: 'pkcs8' });
    try { this.reviewKey = Buffer.from(hkdfSync('sha256', keyBytes, c.installationId, 'omnitron/owner-review-token/v1', 32)); }
    finally { keyBytes.fill(0); }
    // The installer provisions an empty private SQLite file on the separate continuity volume.
    // Opening a missing file would silently reset the code ledger after storage loss.
    privateDatabasePath(config.databasePath);
    privateDatabasePath(config.continuityPath);
    if (path.dirname(config.databasePath) === path.dirname(config.continuityPath)) throw Error('Recovery continuity requires a separate backup boundary');
    this.db = openSqliteDatabase(config.databasePath, { fileMustExist: true });
    try {
      this.db.prepare('ATTACH DATABASE ? AS continuity').run(config.continuityPath);
      // Attached databases commit atomically through SQLite's super-journal in rollback mode.
      for (const database of ['main', 'continuity']) {
        if (this.db.pragma(database + '.journal_mode = DELETE', { simple: true }) !== 'delete') throw Error('Recovery database requires rollback journaling');
        this.db.pragma(database + '.synchronous = FULL');
      }
      this.db.pragma('busy_timeout = 5000');
      sealSqliteFiles(config.databasePath);
      sealSqliteFiles(config.continuityPath);
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS recovery_head (id INTEGER PRIMARY KEY CHECK (id=1), head TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS continuity.recovery_head (id INTEGER PRIMARY KEY CHECK (id=1), head TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS enrollment (id INTEGER PRIMARY KEY CHECK (id=1), signature TEXT NOT NULL,
          root TEXT NOT NULL, installation TEXT NOT NULL, owner_generation INTEGER NOT NULL, pairing_generation INTEGER NOT NULL, nonce TEXT,
          expires INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0, counter INTEGER NOT NULL DEFAULT 0,
          failures INTEGER NOT NULL DEFAULT 0, window INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS codes (salt TEXT PRIMARY KEY, verifier TEXT NOT NULL, spent INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS attempts (operation TEXT PRIMARY KEY, intent TEXT NOT NULL, digest TEXT NOT NULL,
            state TEXT NOT NULL, review TEXT NOT NULL, challenge TEXT NOT NULL, continuation TEXT, expires INTEGER NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS active_claim ON attempts ((1)) WHERE state IN ('approved','claimed');
          CREATE INDEX IF NOT EXISTS attempt_expiry ON attempts(state,expires);
          CREATE TABLE IF NOT EXISTS application_receipts (
            operation TEXT PRIMARY KEY, payload TEXT NOT NULL, signature TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS failed_assertions (operation TEXT PRIMARY KEY, failures INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS decisions (sequence INTEGER PRIMARY KEY, operation TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL);
          CREATE TRIGGER IF NOT EXISTS record_begin AFTER INSERT ON attempts BEGIN
            INSERT INTO decisions(operation,state,at) VALUES(NEW.operation,NEW.state,unixepoch()); END;
          CREATE TRIGGER IF NOT EXISTS record_transition AFTER UPDATE OF state ON attempts WHEN OLD.state <> NEW.state BEGIN
            INSERT INTO decisions(operation,state,at) VALUES(NEW.operation,NEW.state,unixepoch()); END;`);
        const head = this.head();
        if (!head) {
          if (this.db.prepare('SELECT 1 FROM enrollment').get()) throw Error('Missing recovery continuity evidence');
          const first = randomToken();
          this.db.prepare('INSERT INTO main.recovery_head VALUES(1,?)').run(first);
          this.db.prepare('INSERT INTO continuity.recovery_head VALUES(1,?)').run(first);
        }
        const root = commissioning.export({ type: 'spki', format: 'der' }).toString('base64url');
        this.db.prepare('INSERT OR IGNORE INTO enrollment(id,signature,root,installation,owner_generation,pairing_generation) VALUES(1,?,?,?,?,?)')
          .run(this.signature, root, c.installationId, c.ownerGeneration, c.pairingGeneration);
        const saved = this.enrollment();
        if (saved.root !== root || saved.installation !== c.installationId) throw Error('Recovery commissioning anchor changed');
        if (saved.signature !== this.signature) {
          if (saved.owner_generation >= c.ownerGeneration || saved.pairing_generation >= c.pairingGeneration) throw Error('Recovery generation must advance');
          if (this.db.prepare("SELECT 1 FROM attempts WHERE state='claimed'").get()) throw Error('Reconcile or fence outstanding recovery claims before rotation');
          this.db.prepare("UPDATE attempts SET state='cancelled', continuation=NULL WHERE state IN ('approved','pending')").run();
          this.db.prepare('DELETE FROM codes').run();
          this.db.prepare('UPDATE enrollment SET signature=?,owner_generation=?,pairing_generation=?,nonce=NULL,expires=0,active=0,counter=0,failures=0,window=0 WHERE id=1')
            .run(this.signature, c.ownerGeneration, c.pairingGeneration);
          this.advanceHead();
        }
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }

  close(): void { this.db.close(); this.reviewKey.fill(0); }

  private head(): string | undefined {
    const main = this.db.prepare('SELECT head FROM main.recovery_head WHERE id=1').pluck().get();
    const continuity = this.db.prepare('SELECT head FROM continuity.recovery_head WHERE id=1').pluck().get();
    if (main !== continuity || (main !== undefined && typeof main !== 'string')) throw Error('Recovery continuity diverged; fence and recommission the installation');
    return main as string | undefined;
  }

  private advanceHead(): void {
    const head = randomToken();
    this.db.prepare('UPDATE main.recovery_head SET head=? WHERE id=1').run(head);
    this.db.prepare('UPDATE continuity.recovery_head SET head=? WHERE id=1').run(head);
  }

  private transaction<T>(action: () => T): T {
    return this.db.transaction(() => {
      if (!this.head()) throw Error('Missing recovery continuity evidence');
      if (this.enrollment().signature !== this.signature) throw Error('Recovery authority generation changed');
      const result = action();
      this.advanceHead();
      return result;
    }).immediate();
  }

  private enrollment(): Enrollment {
    return this.db.prepare('SELECT * FROM enrollment WHERE id=1').get() as Enrollment;
  }

  private pairing(nonce: string, expiresAt: number) {
    const { installationId, ownerId, ownerGeneration, recipientId, pairingGeneration, subjectId, applicationOrigin } = this.commission;
    return { installationId, ownerId, ownerGeneration, recipientId, pairingGeneration, subjectId, applicationOrigin, nonce, issuedAt: expiresAt - TTL, expiresAt };
  }

  enrollmentChallenge(input: { enrollmentToken: string }) {
    if (!secretMatches(input?.enrollmentToken, this.commission.enrollmentTokenHash)) denied();
    return this.transaction(() => {
      const current = this.enrollment();
      if (current.active) denied();
      const now = this.now();
      const reuse = current.nonce && now < current.expires;
      const nonce = reuse ? current.nonce! : randomToken();
      const expiry = reuse ? current.expires : now + TTL;
      this.db.prepare('UPDATE enrollment SET nonce=?, expires=? WHERE id=1').run(nonce, expiry);
      const { applicationOrigin, applicationLabel, installationLabel, accountLabel } = this.commission;
      return { applicationOrigin, applicationLabel, installationLabel, accountLabel, pairingChallenge: signRecoveryEnvelope('pair-challenge', this.pairing(nonce, expiry), this.signingKey),
        publicKey: ownerAssertionOptions(this.commission.credential, this.commission.controllerOrigin, nonce, expiry - now) };
    });
  }

  enroll(input: { enrollmentToken: string; pairingProof: RecoveryEnvelope<ReturnType<OwnerRecoveryAuthority['pairing']>>; assertion: unknown }) {
    if (!secretMatches(input?.enrollmentToken, this.commission.enrollmentTokenHash)) denied();
    return this.transaction(() => {
      const enrollment = this.enrollment();
      if (enrollment.active || !enrollment.nonce || this.now() >= enrollment.expires) denied();
      const paired = this.verifyRecipient('pair', input.pairingProof);
      const expected = this.pairing(enrollment.nonce, enrollment.expires);
      fields(paired, Object.keys(expected));
      if (Object.entries(expected).some(([key,value]) => paired[key as keyof typeof expected] !== value)) denied();
      const counter = this.assertionCounter(input.assertion, enrollment.nonce, 0);
      if (counter < 0) denied();
      const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(16).toString('base64url'));
      const insert = this.db.prepare('INSERT INTO codes(salt,verifier) VALUES (?,?)');
      for (const code of recoveryCodes) {
        const salt = randomToken();
        insert.run(salt, hash(salt + ':' + code));
      }
      this.db.prepare('UPDATE enrollment SET active=1, nonce=NULL, counter=? WHERE id=1').run(counter);
      return { recoveryCodes };
    });
  }

  private verifyRecipient<T>(domain: RecipientAction | 'pair' | 'receipt', envelope: RecoveryEnvelope<T>): T {
    try { return verifyRecoveryEnvelope(domain, envelope, this.recipientKey); }
    catch { return denied(); }
  }

  private assertionCounter(assertion: unknown, challenge: string, counter: number): number {
    try { return verifyOwnerAssertion(assertion, this.commission.credential, this.commission.controllerOrigin, challenge, counter); }
    catch { return -1; }
  }

  private recipient<T extends RequestScope>(domain: RecipientAction, envelope: RecoveryEnvelope<T>, extra: string[]): T {
    const request = this.verifyRecipient(domain, envelope);
    fields(request, ['installationId','recipientId','operationId','issuedAt', ...extra]);
    const now = this.now();
    if (!Number.isSafeInteger(request.issuedAt) || request.issuedAt > now + MAX_SKEW || request.issuedAt <= now - TTL ||
        request.installationId !== this.commission.installationId || request.recipientId !== this.commission.recipientId ||
        !OPERATION_ID.test(request.operationId) || !this.enrollment().active) denied();
    return request;
  }

  begin(envelope: RecoveryEnvelope<Begin>) {
    const request = this.recipient('begin', envelope, ['browserBinding','credentialRevision']);
    const c = this.commission;
    const issuedAt = this.now();
    const intent = parseRecoveryIntent({ version: 1, installationId: c.installationId, ownerId: c.ownerId, ownerGeneration: c.ownerGeneration,
      recipientId: c.recipientId, pairingGeneration: c.pairingGeneration, subjectId: c.subjectId, credentialRevision: request.credentialRevision,
      method: RECOVERY_METHOD, operationId: request.operationId, browserBinding: request.browserBinding,
      issuedAt, expiresAt: issuedAt + TTL });
    const digest = recoveryIntentDigest(intent);
    const tokenFor = (intentHash: string) => createHmac('sha256', this.reviewKey).update(intentHash).digest('base64url');
    const reviewToken = tokenFor(digest);
    const challenge = createHash('sha256').update('omnitron/owner-review/v1:').update(digest).update(randomBytes(32)).digest('base64url');
    return this.transaction(() => {
      this.expire();
      const existing = this.get(request.operationId);
      if (existing) {
        const prior = this.grant(existing).intent;
        if (existing.state !== 'pending' || prior.ownerGeneration !== c.ownerGeneration || prior.pairingGeneration !== c.pairingGeneration ||
            prior.browserBinding !== intent.browserBinding || prior.credentialRevision !== intent.credentialRevision) denied();
        return { intent: prior, digest: existing.digest, reviewToken: tokenFor(existing.digest), controllerOrigin: c.controllerOrigin };
      }
      const active = this.db.prepare("SELECT count(*) AS n FROM attempts WHERE state='pending'").get() as { n: number };
      if (active.n >= 64) denied();
      this.db.prepare("INSERT INTO attempts VALUES(?,?,?,'pending',?,?,NULL,?)")
        .run(request.operationId, JSON.stringify(intent), digest, hash(reviewToken), challenge, intent.expiresAt);
      return { intent, digest, reviewToken, controllerOrigin: c.controllerOrigin };
    });
  }

  private expire(): void {
    this.db.prepare("UPDATE attempts SET state='expired', continuation=NULL WHERE state IN ('pending','approved') AND expires<=?").run(this.now());

  }

  private get(id: string): Attempt | undefined {
    return this.db.prepare('SELECT * FROM attempts WHERE operation=?').get(id) as Attempt | undefined;
  }

  private review(input: Review): Attempt {
    if (!input || !OPERATION_ID.test(input.operationId)) denied();
    const attempt = this.get(input.operationId);
    if (!attempt || attempt.state !== 'pending' || this.now() >= attempt.expires || !secretMatches(input.reviewToken, attempt.review)) denied();
    return attempt;
  }

  getChallenge(input: Review) {
    return this.db.transaction(() => {
      if (!this.head() || this.enrollment().signature !== this.signature) denied();
      const attempt = this.review(input);
      const c = this.commission;
      return { applicationOrigin: c.applicationOrigin, applicationLabel: c.applicationLabel, accountLabel: c.accountLabel, installationLabel: c.installationLabel,
        publicKey: ownerAssertionOptions(c.credential, c.controllerOrigin, attempt.challenge, attempt.expires - this.now()) };
    }).deferred();
  }

  approve(input: Review & { recoveryCode: string; assertion: unknown }) {
    const result = this.transaction(() => {
      this.expire();
      const attempt = this.review(input);
      const now = this.now();
      const enrollment = this.enrollment();
      const window = enrollment.window + TTL > now ? enrollment.window : now;
      const failures = window === enrollment.window ? enrollment.failures : 0;
      if (failures >= 8) denied();
      const operationFailures = this.db.prepare('SELECT failures FROM failed_assertions WHERE operation=?').pluck().get(attempt.operation) as number | undefined;
      if ((operationFailures ?? 0) >= 8) denied();
      const counter = this.assertionCounter(input.assertion, attempt.challenge, enrollment.counter);
      if (counter < 0) {
        // A caller without the enrolled authenticator can exhaust only its own operation.
        this.db.prepare('INSERT INTO failed_assertions VALUES(?,1) ON CONFLICT(operation) DO UPDATE SET failures=failures+1').run(attempt.operation);
        return null;
      }
      const codes = this.db.prepare('SELECT salt,verifier FROM codes WHERE spent=0').all() as {salt: string; verifier: string}[];
      const code = typeof input.recoveryCode === 'string' && /^[\w-]{22}$/.test(input.recoveryCode)
        ? codes.find(row => timingSafeEqual(Buffer.from(row.verifier,'hex'), Buffer.from(hash(row.salt + ':' + input.recoveryCode),'hex'))) : undefined;
      if (!code) {
        this.db.prepare('UPDATE enrollment SET counter=?, failures=?, window=? WHERE id=1').run(counter, failures + 1, window);
        return null; // commit the failed attempt before reporting denial
      }
      if (this.db.prepare("SELECT 1 FROM attempts WHERE state IN ('approved','claimed')").get()) denied();
      const continuation = randomToken();
      this.db.prepare("UPDATE attempts SET state='approved', continuation=? WHERE operation=?").run(hash(continuation), attempt.operation);
      this.db.prepare('UPDATE enrollment SET failures=0, window=0, counter=? WHERE id=1').run(counter);
      this.db.prepare('UPDATE codes SET spent=1 WHERE salt=?').run(code.salt);
      return { continuation, applicationOrigin: this.commission.applicationOrigin };
    });
    return result ?? denied();
  }

  private scoped(request: Operation): Attempt {
    this.expire();
    const attempt = this.get(request.operationId);
    if (!attempt || request.digest !== attempt.digest) denied();
    const intent = this.grant(attempt).intent;
    const c = this.commission;
    if (intent.ownerGeneration !== c.ownerGeneration || intent.pairingGeneration !== c.pairingGeneration ||
        intent.recipientId !== c.recipientId || intent.subjectId !== c.subjectId) denied();
    return attempt;
  }

  private grant(attempt: Attempt): RecoveryGrant {
    return { intent: parseRecoveryIntent(JSON.parse(attempt.intent)), digest: attempt.digest };
  }

  claim(envelope: RecoveryEnvelope<Claim>) {
    const request = this.recipient('claim', envelope, ['digest','continuation']);
    return this.transaction(() => {
      const attempt = this.scoped(request);
      if (attempt.state !== 'approved' || !secretMatches(request.continuation, attempt.continuation)) denied();
      this.db.prepare("UPDATE attempts SET state='claimed', continuation=NULL WHERE operation=?").run(attempt.operation);
      return signRecoveryEnvelope('grant', this.grant(attempt), this.signingKey);
    });
  }

  status(envelope: RecoveryEnvelope<Operation>) { return this.observe('status', envelope); }
  cancel(envelope: RecoveryEnvelope<Operation>) { return this.observe('cancel', envelope); }

  private observe(domain: 'status' | 'cancel', envelope: RecoveryEnvelope<Operation>) {
    const request = this.recipient(domain, envelope, ['digest']);
    return this.transaction(() => {
      const attempt = this.scoped(request);
      if (domain === 'cancel' && (attempt.state === 'pending' || attempt.state === 'approved')) {
        this.db.prepare("UPDATE attempts SET state='cancelled', continuation=NULL WHERE operation=?").run(attempt.operation);
        return { state: 'cancelled' as const };
      }
      if (attempt.state === 'claimed') return { state: attempt.state,
        authorization: signRecoveryEnvelope(domain === 'cancel' ? 'fence' : 'receipt-query', this.grant(attempt), this.signingKey) };
      return { state: attempt.state };
    });
  }

  acknowledge(envelope: RecoveryEnvelope<Acknowledge>) {
    const request = this.recipient('acknowledge', envelope, ['digest','receipt']);
    const receipt = this.verifyRecipient('receipt', request.receipt);
    return this.transaction(() => {
      const attempt = this.scoped(request);
      parseRecoveryReceipt(receipt, this.grant(attempt).intent);
      if (attempt.state !== 'claimed' && attempt.state !== receipt.outcome) denied();
      const persisted = this.db.prepare('SELECT signature FROM application_receipts WHERE operation=?').pluck().get(attempt.operation);
      if (persisted !== undefined && persisted !== request.receipt.signature) denied();
      this.db.prepare('INSERT OR IGNORE INTO application_receipts(operation,payload,signature) VALUES(?,?,?)')
        .run(attempt.operation, JSON.stringify(receipt), request.receipt.signature);
      this.db.prepare('UPDATE attempts SET state=? WHERE operation=?').run(receipt.outcome, attempt.operation);
      return { state: receipt.outcome };
    });
  }
}
