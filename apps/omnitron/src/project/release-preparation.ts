import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { LoadedRelease } from '../release/load.js';
import { listReleaseLogs, readReleaseLog, readReleaseManifestRecord } from '../release/store.js';
import type { FileLocation } from '../shared/dto/files.js';
import type { RemoteReleasePreparationAttempt, RuntimeStackScope } from '../shared/dto/project.js';
import { stackExecutionKey } from '../shared/dto/stack-execution.js';

type Store = Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync' | 'kvUpdateSync' | 'kvKeys'>;
const controller = randomUUID();
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
type AttemptRecord = {
  registration: string;
  recipient: string;
  controller: string;
  view: RemoteReleasePreparationAttempt;
  files?: FileLocation;
  source?: { storeRoot: string; directory: string };
};
const prefix = (scope: RuntimeStackScope) => 'release:prepare-attempt:' + stackExecutionKey(scope) + ':';
const currentView = (record: AttemptRecord): RemoteReleasePreparationAttempt =>
  record.view.state === 'checking' && record.controller !== controller
    ? { ...record.view, state: 'interrupted', reason: 'Previous controller recorded no final outcome' } : record.view;

export function beginPreparation(store: Store, identity: Pick<RemoteReleasePreparationAttempt,
  'project' | 'stack' | 'release' | 'nodeId' | 'manifestSha256'>, registration: string, recipient: string) {
  const attemptId = randomUUID(), key = prefix(identity) + attemptId;
  store.kvUpdateSync<AttemptRecord>(key, previous => {
    if (previous) throw Error('Release preparation attempt already exists');
    return { registration, recipient, controller, view: { ...identity, attemptId, startedAt: new Date().toISOString(), state: 'checking' } };
  });
  const pending = (record: AttemptRecord | null) => {
    if (!record || record.view.state !== 'checking' || record.controller !== controller) throw Error('Release preparation is no longer pending');
    return record;
  };
  const update = (change: (record: AttemptRecord) => AttemptRecord) =>
    store.kvUpdateSync<AttemptRecord>(key, record => change(pending(record)));
  return {
    attemptId,
    producer(release: LoadedRelease, storeRoot: string) {
      const directory = directoryIdentity(storeRoot, release.id);
      const { builtAt, gates } = release.manifest;
      const producer = { ...(builtAt && { builtAt }), gates: gates.map(({ name, status, durationMs }) =>
        ({ name, status, ...(durationMs !== undefined && { durationMs }) })), logs: listReleaseLogs(release.id, storeRoot).map(file => file.name) };
      update(record => ({ ...record, source: { storeRoot, directory }, view: { ...record.view, producer } }));
    },
    publication(id: string, files: FileLocation) {
      update(record => ({ ...record, files, view: { ...record.view, fileTransferId: id } }));
    },
    refused(reason: string) {
      update(record => ({ ...record, view: { ...record.view, finishedAt: new Date().toISOString(), state: 'refused', reason } }));
    },
    /** Called inside the FULL SQLite transaction which retains the grant. Both records commit together. */
    preparedInTransaction(digest: string) {
      const record = pending(store.kvGetSync<AttemptRecord>(key, { strict: true }));
      store.kvSetSync<AttemptRecord>(key, { ...record, view: { ...record.view, finishedAt: new Date().toISOString(), state: 'prepared', preparedDigest: digest } });
    },
  };
}

type Current = (registration: string, nodeId: string, recipient: string) => boolean;
function readAttempt(store: Store, scope: RuntimeStackScope, key: string, current: Current) {
  const record = store.kvGetSync<AttemptRecord>(key, { strict: true });
  if (record && uuid.test(record.view.attemptId) && key === prefix(scope) + record.view.attemptId &&
      record.view.project === scope.project && record.view.stack === scope.stack &&
      current(record.registration, record.view.nodeId, record.recipient)) return record;
  return undefined;
}

export async function listPreparations(store: Store, scope: RuntimeStackScope, resolveCurrent: () => Current) {
  const rows: RemoteReleasePreparationAttempt[] = [], start = prefix(scope);
  const keys = await store.kvKeys(start), current = resolveCurrent();
  for (const key of keys) {
    if (!key.startsWith(start)) continue;
    const record = readAttempt(store, scope, key, current);
    if (record) rows.push(currentView(record));
  }
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.attemptId.localeCompare(a.attemptId));
}

function directoryIdentity(storeRoot: string, release: string): string {
  const dir = path.join(storeRoot, release);
  if (fs.realpathSync(dir) !== dir) throw Error('Preparation source directory changed');
  const stat = fs.lstatSync(dir, { bigint: true });
  if (!stat.isDirectory()) throw Error('Preparation source is unavailable');
  return stat.dev + ':' + stat.ino;
}

export function preparationLog(store: Store, scope: RuntimeStackScope, attemptId: string, name: string, lines: number | undefined, current: Current,
  page?: { beforeByte?: number; version?: string }) {
  const record = typeof attemptId === 'string' && uuid.test(attemptId) ? readAttempt(store, scope, prefix(scope) + attemptId, current) : undefined;
  if (!record?.source || !record.view.producer?.logs.includes(name)) throw Error('Unknown release preparation log in this registration');
  const { storeRoot, directory } = record.source, { release, manifestSha256 } = record.view;
  const check = () => {
    if (directoryIdentity(storeRoot, release) !== directory || readReleaseManifestRecord(release, storeRoot).sha256 !== manifestSha256)
      throw Error('The recorded preparation source changed');
  };
  check();
  const log = readReleaseLog(release, name, lines, storeRoot, page);
  check();
  return log;
}
