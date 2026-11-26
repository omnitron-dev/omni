/**
 * omnitron backup create [database] — Create database backup
 * omnitron backup list — List available backups
 * omnitron backup restore <id> — Restore from backup
 */

import { randomUUID } from 'node:crypto';
import { log } from '@xec-sh/kit';
import { assertOperationId } from '@xec-sh/core';
import {
  formatBackupSize,
  formatUtc,
  resolveBackupId,
  uniqueIdPrefixLength,
} from '../services/backup-pipeline.js';
import { createDaemonClient, isRequestTimeout } from '../daemon/daemon-client.js';
import { emitError, emitJson, isJsonMode } from './output.js';
import type { BackupArtifactRequest, BackupRecord, BackupStatus } from '../shared/dto/backups.js';
import { isLostRpcAcknowledgement, type IOmnitronBackupsService } from '../shared/dto/services.js';
import type { OperationArtifact, OperationReceipt } from '../shared/dto/execution-operations.js';

async function withBackups<T>(invoke: (service: IOmnitronBackupsService) => Promise<T>): Promise<T> {
  const client = createDaemonClient();
  try {
    if (!(await client.isReachable())) {
      throw new Error('omnitron daemon is not running (start it with `omnitron up`)');
    }
    return await invoke(await client.service<IOmnitronBackupsService>('OmnitronBackups'));
  } finally {
    await client.disconnect();
  }
}

/** The status the daemon reports beside the index rows, or why there is none. */
async function readBackupStatus(read: () => Promise<BackupStatus>): Promise<
  { status: BackupStatus; unavailable?: never } | { status?: never; unavailable: string }
> {
  try {
    const status = await read();
    return status ? { status } : { unavailable: 'the daemon returned no backup status' };
  } catch (err) {
    return { unavailable: err instanceof Error ? err.message : String(err) };
  }
}

/** A span as an operator reads it: `3 d 15 h`, `5 h 43 min`, `12 min`, `40 s`. */
function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * One recorded pass, in UTC, with the reason of everything that failed.
 * `EMPTY` is spelled out: a pass that found nothing did not succeed.
 */
function describePass(pass: any): string {
  if (!pass) return 'none recorded yet';
  const when = formatUtc(pass.startedAt);
  if (pass.outcome === 'excluded') return `${when}  EXCLUDED — ${pass.excludedDatabases.join(', ')}`;
  if (pass.outcome === 'empty') return `${when}  EMPTY — nothing was found to back up`;
  const took = Math.max(0, Math.round((Date.parse(pass.finishedAt) - Date.parse(pass.startedAt)) / 1000));
  const head = `${when}  ${String(pass.outcome).toUpperCase()} — ${pass.ok} of ${pass.total} in ${took} s`;
  const failures: any[] = pass.failures ?? [];
  return failures.length === 0 ? head : `${head}; failed: ${failures.map((f) => `${f.target} (${f.error})`).join('; ')}`;
}

/** After submission only read the original operation. Losing the reply does not cancel the dump. */
async function readSubmittedBackup(service: IOmnitronBackupsService, id: string, requestError: unknown): Promise<OperationArtifact> {
  // Netron rejects unauthenticated or unauthorized calls before invoking the service.
  const code = (requestError as { code?: unknown } | null)?.code;
  if (code === 401 || code === 403) throw requestError;
  const inspect = `omnitron backup operations ${id}`;
  const reason = (requestError as Error)?.message ?? String(requestError);
  const unconfirmed = (detail: string) => new Error(`Backup outcome unconfirmed for ${id}. ${detail}. Inspect with \`${inspect}\` before retrying.`);
  const read = async () => {
    let receipt: OperationReceipt | null;
    try { receipt = await service.getOperation({ id }); }
    catch (error) { throw unconfirmed(`Request reported ${reason}. Could not read its receipt (${(error as Error).message})`); }
    if (receipt && (receipt.id !== id || receipt.kind !== 'backup'))
      throw unconfirmed('The daemon returned a different operation');
    return receipt;
  };

  const lostReply = isRequestTimeout(requestError) || isLostRpcAcknowledgement(requestError);
  let receipt = await read();
  // Admission can reject the request before it creates any journal entry.
  if (!receipt && !lostReply) throw requestError;
  let deadline: number | undefined;
  while (receipt && ['prepared', 'running', 'cancelling'].includes(receipt.state)) {
    if (deadline === undefined) {
      log.info(`Backup ${id} is ${receipt.state}. Waiting for its receipt...`);
      try {
        const { databaseTimeoutMs } = await service.getBackupStatus();
        if (!Number.isSafeInteger(databaseTimeoutMs) || databaseTimeoutMs <= 0) throw new Error('Invalid database transfer deadline');
        deadline = performance.now() + databaseTimeoutMs;
      } catch (error) { throw unconfirmed(`Last state was ${receipt.state}. ${(error as Error).message}`); }
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw unconfirmed(`Last state was ${receipt.state}`);
    await new Promise(resolve => setTimeout(resolve, Math.min(2_000, remaining)));
    receipt = await read();
  }
  if (receipt?.state === 'failed' || receipt?.state === 'cancelled') {
    const detail = [receipt.code, !lostReply && reason].filter(Boolean).join('. ');
    throw new Error(`Backup ${id} ${receipt.state}. ${detail}`.trim());
  }
  if (receipt?.state === 'succeeded') {
    const artifact = receipt.artifact;
    if (artifact?.id !== id || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0)
      throw unconfirmed('The succeeded receipt has no matching archive and size');
    return artifact;
  }
  throw unconfirmed(receipt ? `Receipt state is ${receipt.state}${receipt.code ? ' (' + receipt.code + ')' : ''}` : 'No receipt was found');
}

export async function backupCreateCommand(database?: string): Promise<void> {
  try {
    // No target ⇒ back up every database of every running stack (the safe
    // default for data protection). A specific name backs up just that DB.
    if (!database) {
      log.info('Creating backups for all running-stack databases...');
      const results = await withBackups(service => service.createAllBackups());
      if (!results || results.length === 0) {
        log.warn('No databases found to back up — is a stack running?');
        process.exitCode = 1;
        return;
      }
      printPassResults(results, (r) => qualifiedName(r, r.database), 'database(s)');
      return;
    }

    const operationId = randomUUID();
    log.info(`Creating backup for '${database}' (operation ${operationId})...`);
    const backup = await withBackups(async service => {
      try {
        const record = await service.createBackup({ database, compress: true, operationId });
        if (record?.id !== operationId)
          throw Object.assign(new Error('The daemon acknowledged a different backup ID'), { code: 'INVALID_RESPONSE' });
        return record;
      } catch (error) {
        const artifact = await readSubmittedBackup(service, operationId, error);
        return { id: artifact.id, database, size: artifact.sizeBytes };
      }
    });
    log.success(`Backup created: ${'filename' in backup ? backup.filename : backup.id} (${formatBackupSize(backup.size)})`);
    log.info(`  ID: ${backup.id}`);
    log.info(`  Database: ${backup.database}`);
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

export async function backupArtifactCommand(kind: string, options: { project: string; stack: string; bucket?: string }): Promise<void> {
  let request: BackupArtifactRequest;
  if (kind === 'storage-objects' && options.bucket)
    request = { kind, project: options.project, stack: options.stack, bucket: options.bucket };
  else if (kind === 'tor-keys' && options.bucket === undefined)
    request = { kind, project: options.project, stack: options.stack };
  else throw new Error('Use storage-objects with --bucket, or tor-keys without --bucket');
  const backup: BackupRecord = await withBackups(service => service.createArtifactBackup(request));
  if (isJsonMode()) emitJson(backup);
  else {
    log.success(`${backup.project}/${backup.stack}/${kind}${backup.bucket ? '/' + backup.bucket : ''}: ${backup.id} (${formatBackupSize(backup.size)})`);
    if (backup.coverage === 'current-object-bodies') log.info('Contains current object bodies. Version history and HTTP metadata require a physical snapshot.');
  }
}

function printOperation(receipt: OperationReceipt): void {
  log.info(`${receipt.id} · ${receipt.kind} · ${receipt.state} · revision ${receipt.revision}`);
  for (const resource of receipt.resources.filter(value => value.kind === 'database'))
    log.info(`  ${resource.project}/${resource.stack}/${resource.name}`);
  if (receipt.execution) log.info(`  Docker ${receipt.execution.daemonId} · container ${receipt.execution.id ?? 'not acknowledged'}` +
    (receipt.observation ? ` · ${receipt.observation.state}` : ''));
  if (receipt.code) log.info(`  ${receipt.code}`);
  if (receipt.review) log.warn(`  Outcome remains unknown. New backups allowed; restores blocked. Reviewed by ${receipt.review.actor}: ${receipt.review.reason}`);
}

/** Full receipts, including unknown outcomes. Reading never retries an effect. */
export async function backupOperationsCommand(id?: string): Promise<void> {
  try {
    if (id !== undefined) assertOperationId(id);
    const result = await withBackups<OperationReceipt | OperationReceipt[] | null>(service => id === undefined
      ? service.listOperations() : service.getOperation({ id }));
    if (result === null) throw new Error('Backup operation not found');
    if (emitJson(result)) return;
    const receipts = Array.isArray(result) ? result : [result];
    if (!receipts.length) log.info('No unfinished backup or restore operations');
    else receipts.forEach(printOperation);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

/** The operator supplies the revision they inspected; never fetch a newer one
 * and silently expand cancellation authority after a conflict. */
export async function backupOperationActionCommand(action: 'cancel' | 'reconcile', id: string,
  options: { revision: string }): Promise<void> {
  try {
    assertOperationId(id);
    if (!/^[1-9]\d*$/.test(options.revision) || !Number.isSafeInteger(Number(options.revision)))
      throw new Error('--revision must be a positive safe integer from the inspected operation');
    const request = { id, revision: Number(options.revision) };
    const receipt = await withBackups(service => action === 'cancel'
      ? service.cancelOperation(request) : service.reconcileOperation(request));
    if (!['succeeded', 'failed', 'cancelled'].includes(receipt.state)) {
      emitError('Backup execution is still unconfirmed; no retry or release of its resource claim was authorized', {
        code: 'BACKUP_OUTCOME_UNCONFIRMED', outcome: 'unknown', operation: receipt,
      });
      if (!isJsonMode()) printOperation(receipt);
      process.exitCode = 1;
      return;
    }
    if (!emitJson(receipt)) printOperation(receipt);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

/** Explicit operator review is separate from executor reconciliation. */
export async function backupAcknowledgeCommand(id: string, options: { revision: string; reason: string; offline?: boolean }): Promise<void> {
  try {
    assertOperationId(id);
    if (!/^[1-9]\d*$/.test(options.revision) || !Number.isSafeInteger(Number(options.revision)))
      throw new Error('--revision must be a positive safe integer from the inspected operation');
    const revision = Number(options.revision);
    const receipt = options.offline
      ? await (await import('../daemon/backup-recovery.js')).acknowledgeStoppedBackup(id, revision, options.reason)
      : await withBackups(service => service.acknowledgeUnknownBackup({ id, revision, reason: options.reason }));
    if (receipt.id !== id.toLowerCase() || receipt.state !== 'unknown' || receipt.revision !== revision + 1 ||
        receipt.review?.decision !== 'allow-new-backup' || receipt.review.reviewedRevision !== revision ||
        receipt.review.reason !== options.reason || receipt.artifact || receipt.observation)
      throw new Error('Backup review was not confirmed; inspect its exact receipt before acting again');
    if (!emitJson(receipt)) printOperation(receipt);
  } catch (error) { emitError(error); process.exitCode = 1; }
}

export async function backupListCommand(): Promise<void> {
  try {
    const { backups, status, unavailable } = await withBackups(async service => {
      const records = await service.listBackups();
      const coverage = await readBackupStatus(() => service.getBackupStatus());
      return { backups: records, ...coverage };
    });

    if (isJsonMode()) {
      if (status) emitJson({ backups, status });
      else {
        emitError(`Backup status unavailable: ${unavailable}`, { code: 'BACKUP_STATUS_UNAVAILABLE', backups });
        process.exitCode = 1;
      }
      return;
    }

    if (backups.length === 0) {
      log.info('No backups available');
    } else {
      log.info(`Found ${backups.length} backup(s):\n`);
      // The id is the first column because it is what `backup restore` takes —
      // the list used to print everything except it. A prefix, as long as it
      // needs to be to stay unique and never shorter than `backup create`'s
      // eight characters, so the same token works from either.
      const idLength = uniqueIdPrefixLength(backups.map((b) => String(b.id)));
      const rows = backups.map((b) => [
        String(b.id).slice(0, idLength),
        // Whose database this is: two stacks can both have a `main`.
        stackLabel(b),
        (b.bucket ? `${b.database}/${b.bucket}` : b.database) + (b.coverage === 'current-object-bodies' ? ' (current bodies)' : ''),
        formatBackupSize(b.size),
        // UTC, as the filenames are — see `formatUtc`.
        formatUtc(b.createdAt),
        b.filename,
      ]);
      for (const line of renderTable(['ID', 'Stack', 'Target', 'Size', 'Created (UTC)', 'File'], rows)) log.info(line);
      if (backups.some((b) => stackLabel(b) === '—')) {
        log.info('(Stack — : taken before backups recorded their stack)');
      }
      log.info('\nRestore one with: omnitron backup restore <ID>');
    }

    // A pass that lost a database leaves a listing that looks complete — the
    // missing row is the only trace. Say so here, where people look.
    if (!status) {
      log.warn(`Which stacks are backed up, and how each schedule last ran: unknown — ${unavailable}`);
      process.exitCode = 1;
      return;
    }
    for (const s of status.schedules ?? []) {
      if (s.lastPass && s.lastPass.outcome !== 'ok') {
        log.warn(`Last '${s.target}' pass: ${describePass(s.lastPass)}`);
      }
    }
    reportCoverage(status.stacks);
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

/** `project/stack`, `control-plane`, or `—` for a row from before the stack was recorded. */
function stackLabel(b: any): string {
  if (b.project && b.stack) return `${b.project}/${b.stack}`;
  return b.scope === 'control-plane' ? 'control-plane' : '—';
}

/** A database named with its stack when the daemon said which one. */
function qualifiedName(r: any, name: string): string {
  return r.project && r.stack && !r.skipped ? `${r.project}/${r.stack}/${name}` : name;
}

/**
 * Which running stacks this daemon backs up — and, as a warning, which it
 * does not. «Found 380 backup(s)» and «all hourly» read as «everything is
 * covered» on the master, while the test stack's databases — on another
 * machine — were in none of them.
 */
function reportCoverage(stacks: any[] | undefined): void {
  const list = stacks ?? [];
  if (list.length === 0) return;
  log.info('\nRunning stacks:');
  for (const s of list) {
    const name = `${s.project}/${s.stack}`;
    if (s.notBackedUp) log.warn(`  ${name}: not backed up — ${s.notBackedUp}`);
    else if (s.excludedFromSchedules?.length) {
      const included = s.databases.filter((db: string) => !s.excludedFromSchedules.includes(db));
      if (included.length) log.info(`  ${name}: eligible for scheduled backup — ${included.join(', ')}`);
      log.info(`  ${name}: manual backup only — ${s.excludedFromSchedules.join(', ')}`);
    }
    else if (s.databases?.length) log.info(`  ${name}: backed up — ${s.databases.join(', ')}`);
    else log.info(`  ${name}: no databases`);
  }
}

/** The per-entry lines of an `all` or `full` pass, and its tally. */
function printPassResults(results: any[], nameOf: (r: any) => string, unit: string): void {
  const skipped = results.filter((r) => r.skipped);
  const attempted = results.filter((r) => !r.skipped);
  for (const r of attempted) {
    if (r.ok) {
      const coverage = r.coverage === 'current-object-bodies' ? ' (current object bodies)' : '';
      log.success(`  ✓ ${nameOf(r)}${coverage} — ${formatBackupSize(r.size ?? 0)} [${String(r.id ?? '').slice(0, 8)}]`);
    }
    else log.error(`  ✗ ${nameOf(r)}: ${r.error}`);
  }
  for (const r of skipped) log.warn(`  – ${nameOf(r)}: ${r.error}`);
  const ok = attempted.filter((r) => r.ok).length;
  log.info(`Done: ${ok}/${attempted.length} ${unit} backed up`);
  if (skipped.length > 0) log.warn(`Not backed up: ${skipped.map(nameOf).join(', ')}`);
  if (attempted.length === 0 || ok !== attempted.length) process.exitCode = 1;
}

/**
 * Columns as wide as what they hold. The fixed 25 characters are how the
 * filename was cut at `geo_2026-09-23T08-19-04-` — one character before the
 * part that identified the backup.
 */
function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

export async function backupFullCommand(): Promise<void> {
  try {
    log.info('Creating FULL backup (all DBs + control-plane DB + storage + tor keys + daemon-state)...');
    const results = await withBackups(service => service.createFullBackup());
    if (!results || results.length === 0) {
      log.warn('Nothing to back up — is a stack running?');
      process.exitCode = 1;
      return;
    }
    printPassResults(results, (r) => qualifiedName(r, r.target), 'target(s)');
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

export async function backupScheduleCommand(target: string, cron: string): Promise<void> {
  try {
    const result = await withBackups(service => service.setSchedule({ database: target, cron }));
    if (result?.success !== true) throw new Error('The daemon did not confirm the backup schedule');
    log.success(`Scheduled backup of '${target}': ${cron}`);
    log.info(`  (use 'all' to back up every running-stack database)`);
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

export async function backupSchedulesCommand(): Promise<void> {
  try {
    const { status, unavailable } = await readBackupStatus(() => withBackups(service => service.getBackupStatus()));
    if (!status) {
      emitError(`Backup status unavailable: ${unavailable}`);
      process.exitCode = 1;
      return;
    }

    if (isJsonMode()) { emitJson(status); return; }
    if (Number.isFinite(status.databaseTimeoutMs))
      log.info(`Database transfer deadline: ${status.databaseTimeoutMs < 1000 ? `${status.databaseTimeoutMs} ms` : formatAge(status.databaseTimeoutMs)}`);
    if (status.scheduledDatabaseExclusions?.length)
      log.info(`Scheduled database exclusions: ${status.scheduledDatabaseExclusions.join(', ')}`);
    if (status.admission) log.warn(`Backup admission ${status.admission.status}: ${status.admission.reason}`);
    const schedules: any[] = status.schedules ?? [];
    if (schedules.length === 0) {
      log.info('No backup schedules configured');
      reportCoverage(status.stacks);
      return;
    }
    // "all hourly" said what was configured, and nothing about whether it
    // ran: the master's hourly `all` lost `main` at 06:04Z with no line
    // saying so. Each schedule now carries its last pass and its outcome.
    log.info('Backup schedules:');
    for (const s of schedules) {
      const how = s.schedule ?? `UNREADABLE — ${s.error ?? 'not armed'}`;
      log.info(`  ${String(s.target).padEnd(10)} ${String(s.spec).padEnd(12)} ${how}${s.armed ? '' : '  (not armed)'}`);
      let line = `      last pass  ${describePass(s.lastPass)}`;
      // Before any pass was recorded, the index still knows when this target
      // last produced a backup — which is what its next run is measured from.
      if (!s.lastPass && s.lastBackupAt) {
        line += ` — newest backup ${formatUtc(s.lastBackupAt)}, ${formatAge(Date.now() - Date.parse(s.lastBackupAt))} ago`;
      }
      if (s.lastPass?.excludedDatabases?.length && s.lastPass.outcome !== 'excluded')
        line += ` — excluded by policy: ${s.lastPass.excludedDatabases.join(', ')}`;
      if (s.lastPass && s.lastPass.outcome !== 'ok' && s.lastPass.outcome !== 'excluded') log.warn(line);
      else log.info(line);
      if (s.nextRunAt) {
        log.info(`      next run   ${formatUtc(s.nextRunAt)} (in ${formatAge(Date.parse(s.nextRunAt) - Date.now())})`);
      }
    }
    reportCoverage(status.stacks);
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

export async function backupUnscheduleCommand(target: string): Promise<void> {
  try {
    const result = await withBackups(service => service.removeSchedule({ database: target }));
    if (result?.success !== true) throw new Error('The daemon did not confirm removal of the backup schedule');
    log.success(`Removed backup schedule for '${target}'`);
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}

export async function backupRestoreCommand(id: string): Promise<void> {
  try {
    // Resolved here as well as in the daemon, so the operator sees WHICH
    // backup a prefix named before anything is overwritten — and the daemon
    // is then handed the full id, which every daemon version accepts.
    const backups = await withBackups(service => service.listBackups());
    const target = resolveBackupId(
      backups,
      id,
      (b) => `${b.id} (${qualifiedName(b, b.database)}, ${formatUtc(b.createdAt)})`,
    );
    log.info(
      `Restoring ${target.id} — ${qualifiedName(target, target.database)}, taken ${formatUtc(target.createdAt)} (${target.filename})...`,
    );
    const result = await withBackups(service => service.restoreBackup({ backupId: target.id }));
    if (result?.success !== true) throw new Error('The daemon did not confirm the restore; inspect the destination before retrying');
    log.success('Backup restored successfully');
  } catch (err) {
    emitError(err);
    process.exitCode = 1;
  }
}
