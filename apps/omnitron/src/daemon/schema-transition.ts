import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDaemonClient } from './daemon-client.js';
import type { BackendRpcService } from './backend.rpc-service.js';
import type { BackendControlService } from './backend-control.js';
import { privateControlClient } from './private-control-client.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from './backend-recovery-journal.js';
import type { BackendArtifact } from './backend-candidate.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { masterMigrationFiles, schemaReceiptFile, schemaReceiptIndex } from '../database/schema-compatibility.js';
import { assertSchemaHistory, planSchemaAdditions, readSchemaPlan, schemaPlanFile,
  type SchemaSnapshot, type SchemaTransitionPlan } from '../database/schema-transition-plan.js';
import { expandPath } from '../shared/paths.js';

const execute = promisify(execFile);

async function observe(socket?: string) {
  const client = createDaemonClient(socket, 15_000);
  let address: { socket: string }, pid: number;
  try {
    pid = (await client.ping()).pid;
    address = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress();
  } finally { await client.disconnect(); }
  const control = await privateControlClient<BackendControlService>(address.socket, 'OmnitronBackendControl');
  try {
    const state = await control.service.status();
    if (state.retired || state.ticketId || !state.runtime.owner || !path.isAbsolute(state.instanceHome)) {
      throw new Error('Wait for a ready resident backend before preparing its schema');
    }
    const journal = new BackendRecoveryJournal(path.dirname(address.socket));
    try {
      const certificate = journal.read();
      if (certificate?.status !== 'ready' || certificate.record.previousPid !== pid ||
          certificate.record.environment['OMNITRON_HOME'] !== state.instanceHome ||
          certificate.record.previousEntry !== state.entry ||
          certificate.record.controller.ownerId !== state.runtime.owner.id) {
        throw new Error('Wait for a current recovery certificate for this backend');
      }
      if (certificate.record.daemonConfig.role !== 'master') throw new Error('Online schema expansion currently supports master PostgreSQL only; local node schemas require a separate rollout');
      return { instanceHome: state.instanceHome, control: address.socket, pid, ownerPid: state.runtime.owner.pid, record: certificate.record };
    } finally { await journal.close(); }
  } finally { await control.close(); }
}

async function worker<T>(artifact: BackendArtifact, environment: Record<string, string>, mode: 'inspect' | 'apply', argument: string): Promise<T> {
  const entry = path.join(artifact.directory, 'database/schema-worker.js');
  await fs.access(entry);
  const output = await execute(artifact.execPath, [entry, mode, argument], {
    cwd: path.dirname(artifact.directory), env: environment, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(output.stdout) as T;
}

function assertOwner(plan: SchemaTransitionPlan, live: Awaited<ReturnType<typeof observe>>) {
  if (live.instanceHome !== plan.receipt.instanceHome || live.control !== plan.backend.control ||
      live.record.controller.ownerId !== plan.owner.id ||
      live.ownerPid !== plan.owner.pid ||
      live.record.state.executionInventory !== plan.owner.inventory ||
      (plan.phase === 'prepared' && live.pid !== plan.backend.pid)) {
    throw new Error('The backend, instance or execution inventory changed; prepare a fresh schema plan');
  }
}

async function assertArtifacts(plan: SchemaTransitionPlan, source: BackendArtifact, target: BackendArtifact) {
  if (source.schemaExpansionProtocol !== 1 || target.schemaExpansionProtocol !== 1 ||
      source.runtimeHash !== plan.receipt.fromRuntime || target.runtimeHash !== plan.receipt.toRuntime) {
    throw new Error('The schema transition requires the exact compatibility-capable runtimes');
  }
  const [before, after] = await Promise.all([masterMigrationFiles(source.directory), masterMigrationFiles(target.directory)]);
  if (JSON.stringify(before) !== JSON.stringify(plan.receipt.baseFiles) ||
      Object.keys(after).length !== Object.keys(before).length + plan.receipt.additions.length ||
      Object.entries(before).some(([name, hash]) => after[name] !== hash) ||
      plan.receipt.additions.some(m => after[m.name] !== m.fileHash)) {
    throw new Error('Migration files no longer match the schema transition');
  }
}

function summary(plan: SchemaTransitionPlan) {
  return { id: plan.receipt.id, phase: plan.phase, instanceHome: plan.receipt.instanceHome,
    from: plan.receipt.fromRuntime, to: plan.receipt.toRuntime, database: plan.receipt.database,
    additions: plan.receipt.additions.map((m, i) => ({ ...m, description: plan.descriptions[i] })),
    backendPid: plan.backend.pid, ownerPid: plan.owner.pid,
    legacyIntegrityUnverified: plan.baseline.filter(row => row.checksum === null).map(row => row.name) };
}

/** Read the target database; install artifacts and save the private plan without changing schema. */
export async function prepareSchemaTransition(directory: string, socket?: string) {
  const live = await observe(socket);
  const installation = await RuntimeInstallation.open(live.instanceHome, { existing: true });
  if (!installation) throw new Error('No permanent runtime installation exists');
  try { return await installation.exclusive(async () => {
    if (installation.activation()) throw new Error('Finish the pending backend activation first');
    if (installation.selection()?.current !== live.record.runtimeHash) throw new Error('The running runtime differs from the startup selection');
    const source = await installation.artifact(live.record.runtimeHash);
    if (source.schemaExpansionProtocol !== 1) throw new Error('First activate a compatibility bridge with schema expansion protocol 1');
    const target = await installation.install(path.resolve(directory));
    if (target.runtimeHash === source.runtimeHash || target.schemaExpansionProtocol !== 1) throw new Error('Choose a different schema-expansion-capable candidate');
    const before = await worker<SchemaSnapshot>(target, live.record.environment, 'inspect', source.directory);
    const after = await worker<SchemaSnapshot>(target, live.record.environment, 'inspect', target.directory);
    const baseFiles = await masterMigrationFiles(source.directory);
    const additions = planSchemaAdditions(before, after, baseFiles, await masterMigrationFiles(target.directory));
    const plan: SchemaTransitionPlan = {
      protocol: 1, phase: 'prepared', baseline: before.inspection.executed,
      receipt: { protocol: 1, id: randomUUID(), kind: 'master-expand', phase: 'approved', instanceHome: live.instanceHome,
        fromRuntime: source.runtimeHash, toRuntime: target.runtimeHash, database: before.database, baseFiles,
        additions: additions.map(({ name, checksum, fileHash }) => ({ name, checksum, fileHash })), approvedAt: new Date().toISOString() },
      backend: { pid: live.pid, control: live.control, socket: expandPath(live.record.daemonConfig.socketPath) },
      owner: { id: live.record.controller.ownerId, pid: live.ownerPid,
        inventory: live.record.state.executionInventory },
      descriptions: additions.map(m => m.summary),
    };
    assertOwner(plan, await observe(plan.backend.socket));
    const file = schemaPlanFile(live.instanceHome, plan.receipt.id);
    await writePrivateRecord(file, plan);
    return { file, plan: summary(plan) };
  }); } finally { await installation.close(); }
}

async function publishApproval(plan: SchemaTransitionPlan): Promise<void> {
  const indexFile = schemaReceiptIndex(plan.receipt.instanceHome);
  try {
    if ((await fs.lstat(indexFile)).size > 16 * 1024) throw new Error('Schema receipt index exceeds its size limit');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let index = await readPrivateRecord<{ protocol: number; receipts: string[] }>(indexFile);
  if (!index) index = { protocol: 1, receipts: [] };
  if (index.protocol !== 1 || !Array.isArray(index.receipts) || index.receipts.length > 64 ||
      !index.receipts.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) ||
      new Set(index.receipts).size !== index.receipts.length) throw new Error('Invalid schema receipt index');
  if (!index.receipts.includes(plan.receipt.id) && index.receipts.length === 64) throw new Error('Schema receipt index is full; retain rollback evidence and review obsolete runtimes before pruning');
  await writePrivateRecord(schemaReceiptFile(plan.receipt.instanceHome, plan.receipt.id), plan.receipt);
  if (!index.receipts.includes(plan.receipt.id)) index.receipts.push(plan.receipt.id);
  await writePrivateRecord(indexFile, index);
}

/** Approval precedes DDL durably: a crash after COMMIT can still cold-start the old runtime. */
export async function applySchemaTransition(file: string) {
  file = path.resolve(file);
  let plan = await readSchemaPlan(file);
  const installation = await RuntimeInstallation.open(plan.receipt.instanceHome, { existing: true });
  if (!installation) throw new Error('No permanent runtime installation exists');
  try { return await installation.exclusive(async () => {
    plan = await readSchemaPlan(file);
    if (installation.activation()) throw new Error('Finish the pending backend activation first');
    const live = await observe(plan.backend.socket);
    assertOwner(plan, live);
    if (live.record.runtimeHash !== plan.receipt.fromRuntime || installation.selection()?.current !== plan.receipt.fromRuntime) {
      throw new Error('The schema plan must be applied while its compatibility runtime is selected and running');
    }
    const source = await installation.artifact(plan.receipt.fromRuntime);
    const target = await installation.artifact(plan.receipt.toRuntime);
    await assertArtifacts(plan, source, target);
    assertSchemaHistory(plan, await worker<SchemaSnapshot>(target, live.record.environment, 'inspect', target.directory));
    if (plan.phase === 'prepared') {
      plan.phase = 'approved'; plan.receipt.approvedAt = new Date().toISOString();
      await writePrivateRecord(file, plan);
    }
    await publishApproval(plan);
    await worker(target, live.record.environment, 'apply', file);
    await assertReady(plan, source, target, live.record);
    plan.phase = 'applied'; plan.receipt.phase = 'applied'; plan.receipt.appliedAt = new Date().toISOString();
    await publishApproval(plan);
    await writePrivateRecord(file, plan);
    return summary(plan);
  }); } finally { await installation.close(); }
}

async function assertReady(plan: SchemaTransitionPlan, source: BackendArtifact, target: BackendArtifact, record: BackendRecoveryRecord) {
  const next = await worker<SchemaSnapshot>(target, record.environment, 'inspect', target.directory);
  assertSchemaHistory(plan, next);
  if (next.inspection.pending.length) throw new Error('The planned schema expansion is not completely applied');
  const prior = await worker<SchemaSnapshot>(target, record.environment, 'inspect', source.directory);
  if (prior.inspection.pending.length || prior.inspection.drift.length ||
      prior.inspection.missingFiles.some(name => !plan.receipt.additions.some(m => m.name === name))) {
    throw new Error('The rollback runtime is not compatible with the resulting schema');
  }
}

/** An exact applied plan replaces the digest gate only for these two artifacts and this database. */
export async function validateSchemaTransitionForUpgrade(file: string, current: BackendArtifact, candidate: BackendArtifact, home: string): Promise<void> {
  const plan = await readSchemaPlan(path.resolve(file));
  if (plan.phase !== 'applied' || plan.receipt.instanceHome !== home ||
      !([plan.receipt.fromRuntime, plan.receipt.toRuntime].includes(current.runtimeHash) &&
        [plan.receipt.fromRuntime, plan.receipt.toRuntime].includes(candidate.runtimeHash)) || current.runtimeHash === candidate.runtimeHash) {
    throw new Error('Backend replacement requires an applied schema plan bound to this instance and these exact releases');
  }
  const published = await readPrivateRecord(schemaReceiptFile(home, plan.receipt.id));
  const index = await readPrivateRecord<{ receipts?: string[] }>(schemaReceiptIndex(home));
  if (JSON.stringify(published) !== JSON.stringify(plan.receipt) || !index?.receipts?.includes(plan.receipt.id)) throw new Error('Published schema compatibility evidence is missing or changed');
  const live = await observe(plan.backend.socket);
  if (live.instanceHome !== home || live.record.runtimeHash !== current.runtimeHash) throw new Error('The live backend changed during schema compatibility validation');
  const source = current.runtimeHash === plan.receipt.fromRuntime ? current : candidate;
  const target = current.runtimeHash === plan.receipt.toRuntime ? current : candidate;
  await assertArtifacts(plan, source, target);
  await assertReady(plan, source, target, live.record);
}
