import fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { provesDifferentHostBoot } from '@omnitron-dev/common/process-identity';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { openMachineStageGuards, readLegacyStageRecords, readStageFile, readStageMachineIdentity } from './legacy-stage-fence.js';
import { validStageSelection } from '../shared/stage-selection.js';
import { withStageSelection } from './stage-selection.js';
import { serviceReadFlags } from './service-record.js';
import type { StageRecoveryRequest, StageRecoveryReceipt, StageSelection } from '../shared/dto/nodes.js';
import { readNativeFence } from '../services/legacy-stage-fence.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const digest = /^[0-9a-f]{64}$/;


type Row = { id: string; scope: string; evidence: string; selection: string; prepared: string; lease: Buffer; execution: Buffer;
  decision: string | null; phase: 'prepared' | 'decided' | 'lease-retired' | 'finished' };
interface HostFacts {
  guard: { directory: string; check(terminal?: boolean): void }; uid: number;
  identity: ReturnType<typeof readStageMachineIdentity>; select: typeof withStageSelection;
}

const syncDir = (dir: string) => {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

function openJournal(directory: string, uid: number, create: boolean) {
  const journal = join(directory, 'stage-fence-recovery');
  if (create) {
    try { fs.mkdirSync(journal, { mode: 0o700 }); syncDir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const st = fs.lstatSync(journal, { throwIfNoEntry: false });
  if (!st) throw Error('The protected pre-reboot preparation is absent');
  if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o077) || st.dev !== fs.statSync(directory).dev)
    throw Error('Unsafe stage recovery journal directory');
  const file = join(journal, 'archive.db');
  if (create) {
    try { fs.closeSync(fs.openSync(file, 'wx', 0o600)); syncDir(journal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const entry = fs.lstatSync(file + suffix, { throwIfNoEntry: false });
    if ((!entry && !suffix) || (entry && (!entry.isFile() || entry.uid !== uid || entry.dev !== st.dev || entry.nlink !== 1 || entry.mode & 0o077)))
      throw Error('Unsafe or absent stage recovery journal');
  }
  const db = openSqliteDatabase(file, { fileMustExist: true });
  try {
    if (db.pragma('journal_mode', { simple: true }) !== 'delete') throw Error('Unexpected stage recovery journal mode');
    db.pragma('synchronous = EXTRA');
    if (create) db.exec(`CREATE TABLE IF NOT EXISTS selection_challenge (digest TEXT PRIMARY KEY, evidence TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incident (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, command TEXT NOT NULL UNIQUE, evidence TEXT NOT NULL, selection TEXT NOT NULL,
      prepared TEXT NOT NULL, lease BLOB NOT NULL, execution BLOB NOT NULL, decision TEXT,
      phase TEXT NOT NULL CHECK (phase IN ('prepared','decided','lease-retired','finished'))
    )`);
    return db;
  } catch (error) { db.close(); throw error; }
}

function readReport(row: Row, request: StageRecoveryRequest): StageRecoveryReceipt {
  const observation = readNativeFence(JSON.parse(row.evidence));
  const records = readLegacyStageRecords(row.lease, row.execution);
  const selection = JSON.parse(row.selection) as StageSelection;
  const decision = row.decision ? JSON.parse(row.decision) as NonNullable<StageRecoveryReceipt['decision']> : null;
  if (row.id !== request.recordId || row.scope !== request.scope || !isDeepStrictEqual(observation, request.observation) ||
      !isDeepStrictEqual({ ...observation, ...records }, observation) || !validStageSelection(selection) ||
      (row.phase === 'prepared') !== !decision || (decision && (decision.commandOutcome !== 'unknown' ||
      !provesDifferentHostBoot(observation.bootId, decision.bootId) || !Number.isFinite(Date.parse(decision.acceptedAt)))))
    throw Error('The protected archive is invalid or belongs to another observation');
  return { recordId: row.id, scope: row.scope, observation, selection, preparedAt: row.prepared, decision,
    state: row.phase === 'finished' ? 'interrupted' : 'prepared' };
}

export async function recoverStageUnderGuards(request: StageRecoveryRequest, { guard, uid, identity, select }: HostFacts): Promise<StageRecoveryReceipt> {
  if (!['prepare', 'finish'].includes(request.action) || !uuid.test(request.recordId) || !digest.test(request.scope))
    throw Error('Invalid stage recovery request');
  const observed = readNativeFence(request.observation);
  if (identity.machineIdSha256 !== observed.machineIdSha256 || !uuid.test(identity.bootId))
    throw Error('The registered host machine identity changed');
  const db = openJournal(guard.directory, uid, request.action === 'prepare');
  try {
    const get = () => db.prepare('SELECT * FROM incident WHERE id=?').get(request.recordId) as Row | undefined;
    const report = () => { const row = get(); if (!row) throw Error('The protected pre-reboot preparation is absent'); return readReport(row, request); };
    const previous = get();
    const prior = previous && readReport(previous, request);
    if (prior && (previous.phase === 'finished' || (request.action === 'prepare' && previous.phase === 'prepared'))) return prior;
    if (prior && request.action === 'prepare') throw Error('The decision to interrupt is recorded. Continue with finish.');
    const read = (name: 'deploy.lease' | 'deploy.execution.json') => {
      try { return readStageFile(guard.directory, name, uid); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    };
    const bytes = () => {
      const lease = read('deploy.lease'), execution = read('deploy.execution.json');
      if (!lease || !execution || !isDeepStrictEqual({ ...observed, ...readLegacyStageRecords(lease, execution) }, observed))
        throw Error('The current machine fence differs from the reviewed legacy passive stage');
      return { lease, execution };
    };
    const check = async (prepare: boolean, work: (selection: StageSelection) => void) => {
      const context = { scope: request.scope, recordId: request.recordId, observation: observed, bootId: identity.bootId, prepare };
      return select(request.scope, async (selection, confirm) => {
        if (!validStageSelection(selection) || (prior && !isDeepStrictEqual(prior.selection, selection)))
          throw Error('The enrolled service account or its runtime selection changed');
        guard.check();
        const evidence = JSON.stringify({ ...context, selection }), challenge = hash(evidence);
        db.prepare('INSERT INTO selection_challenge(digest,evidence) VALUES(?,?) ON CONFLICT(digest) DO NOTHING').run(challenge,evidence);
        const retained = db.prepare('SELECT evidence FROM selection_challenge WHERE digest=?').get(challenge) as { evidence: string } | undefined;
        if (retained?.evidence !== evidence) throw Error('The recovery challenge differs from its protected journal');
        await confirm(challenge);
        guard.check();
        work(selection);
        return report();
      });
    };
    if (request.action === 'prepare') {
      if (identity.bootId !== observed.bootId) throw Error('A protected preparation must be made during the recorded boot');
      guard.check();
      const pair = bytes();
      for (const name of ['deploy.lease', 'deploy.execution.json']) {
        const fd = fs.openSync(join(guard.directory, name), serviceReadFlags);
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      syncDir(guard.directory);
      return await check(true, selection => db.prepare(`INSERT INTO incident
        (id,scope,command,evidence,selection,prepared,lease,execution,phase) VALUES (?,?,?,?,?,?,?,?,'prepared')`)
        .run(request.recordId, request.scope, observed.commandId, JSON.stringify(observed), JSON.stringify(selection), new Date().toISOString(), pair.lease, pair.execution));
    }
    if (!prior || !previous) throw Error('The protected pre-reboot preparation is absent');
    if (!provesDifferentHostBoot(observed.bootId, identity.bootId)) throw Error('Recovery requires a different Linux boot on the same host');
    // Only a durable decision with the exact archived inputs can advance either file. No historic Fleet result is rewritten.
    const advance = (from: Row['phase'], to: Row['phase']) => {
      if (db.prepare('UPDATE incident SET phase=? WHERE id=? AND phase=?').run(to, request.recordId, from).changes !== 1)
        throw Error('The stage recovery journal changed unexpectedly');
    };
    const materialize = () => {
      let phase = get()!.phase;
      if (phase === 'decided') {
        guard.check();
        const lease = read('deploy.lease'), execution = read('deploy.execution.json');
        if (!execution?.equals(previous.execution) || (lease && !lease.equals(previous.lease))) throw Error('Fence changed before lease retirement');
        if (lease) fs.unlinkSync(join(guard.directory, 'deploy.lease'));
        syncDir(guard.directory);
        advance('decided', 'lease-retired');
        phase = 'lease-retired';
      }
      if (phase === 'lease-retired') {
        guard.check(true);
        const execution = read('deploy.execution.json'), lease = read('deploy.lease');
        if (lease?.equals(previous.lease)) throw Error('The retired lease is present again');
        if (execution?.equals(previous.execution)) {
          guard.check();
          if (lease) throw Error('A foreign lease appeared while the old command was fenced');
          fs.unlinkSync(join(guard.directory, 'deploy.execution.json'));
        }
        // A different command may already own the machine after a crash just after the final unlink.
        syncDir(guard.directory);
        advance('lease-retired', 'finished');
      }
    };
    if (previous.phase !== 'prepared') {
      if (previous.phase === 'lease-retired' && !read('deploy.execution.json')?.equals(previous.execution)) {
        // The final withdrawal already happened. Only the root journal needs its final receipt.
        materialize(); return report();
      }
      return await check(false, materialize);
    }
    guard.check();
    bytes();
    return await check(false, () => {
      const decision = { bootId: identity.bootId, acceptedAt: new Date().toISOString(), commandOutcome: 'unknown' };
      if (db.prepare("UPDATE incident SET phase='decided',decision=? WHERE id=? AND phase='prepared'")
        .run(JSON.stringify(decision), request.recordId).changes !== 1) throw Error('The prepared stage incident changed');
      materialize();
    });
  } finally { db.close(); }
}

export async function recoverLocalStageFence(request: StageRecoveryRequest) {
  const guard = openMachineStageGuards(true);
  try {
    return await recoverStageUnderGuards(request, { guard, uid: 0, identity: readStageMachineIdentity(), select: withStageSelection });
  } finally { guard.close(); }
}
