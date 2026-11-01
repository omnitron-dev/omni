import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readManagedRuntime, hostBootIdentity, type ManagedRuntime } from './managed-runtime.js';
import { ExecutionJournal, readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { readProcessLifetime } from '../monitoring/process-lifetime.js';
import { withLinuxFileLock } from '../shared/linux-file-lock.js';

interface ProcessIdentity { pid: number; lifetime: string | null }
interface CrashReceipt { bootId: string; clean: false; pid: number }
export interface OwnerReconciliationPlan {
  protocol: 1; id: string; createdAt: string; bootId: string;
  instanceHome: string; directory: string; binding: string;
  ownerId: string; ownerPid: number; crashReceipt: CrashReceipt; receiptDigest: string; journalDigest: string;
  processes: ProcessIdentity[];
}
interface Acknowledgment { protocol: 1; plan: OwnerReconciliationPlan; acknowledgedAt: string; consumedBy?: ProcessIdentity; consumedAt?: string }
interface NativeEvidence {
  bootId: string; units: Array<{ mainPid: number; state: string }>;
  groups: number[][]; processes: Array<{ pid: number; lifetime: string | null; unknown?: boolean }>;
  sockets: string[];
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unitGroup = (unit: string) => `/system.slice/${unit}`;
const receiptFile = (config: ManagedRuntime) => path.join(config.directory, 'managed-owner.json');
const acknowledgmentFile = (config: ManagedRuntime) => path.join(config.directory, 'owner-reconciliation.json');
const binding = (config: ManagedRuntime) => digest({ ...config, owner: { ...config.owner, artifact: undefined }, backend: { ...config.backend, artifact: undefined } });

function requireSupported(config: ManagedRuntime): void {
  if (process.platform !== 'linux' || config.scope !== 'system')
    throw new Error('Explicit owner-crash reconciliation currently requires Linux systemd system services');
}

/** Shared with owner startup: the kernel releases this fence even if the CLI dies. */
export async function withOwnerBootFence<T>(config: ManagedRuntime, body: () => Promise<T>): Promise<T> {
  // Normal managed startup on other platforms keeps its existing clean-boot guard.
  if (process.platform !== 'linux') return body();
  return withLinuxFileLock(path.join(config.directory, 'owner-reconciliation.lock'), body);
}

async function groupPids(group: string): Promise<number[]> {
  const result: number[] = [];
  const visit = async (directory: string): Promise<void> => {
    let members: string;
    try { members = await fs.readFile(path.join(directory, 'cgroup.procs'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const value of members.trim().split(/\s+/).filter(Boolean)) {
      const pid = Number(value); if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid cgroup process identity');
      result.push(pid); if (result.length > 4096) throw new Error('Owner recovery inventory exceeds its process limit');
    }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) await visit(path.join(directory, entry.name));
  };
  await visit('/sys/fs/cgroup' + group);
  return [...new Set(result)].sort((a, b) => a - b);
}

async function nativeEvidence(config: ManagedRuntime, pids: readonly number[]): Promise<NativeEvidence> {
  requireSupported(config);
  const jobs = [config.owner, config.backend];
  const units = await Promise.all(jobs.map(async job => {
    const output = (await promisify(execFile)('systemctl', ['show', job.unit, '--property=MainPID,ActiveState,ControlGroup,LoadState'],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 })).stdout;
    const values = Object.fromEntries(output.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    const mainPid = Number(values['MainPID']);
    if (values['LoadState'] !== 'loaded' || !Number.isSafeInteger(mainPid) || mainPid < 0 ||
      (values['ControlGroup'] && values['ControlGroup'] !== unitGroup(job.unit))) throw new Error('OS service identity disagrees with private supervision configuration');
    return { mainPid, state: values['ActiveState'] ?? '' };
  }));
  const groups = await Promise.all(jobs.map(job => groupPids(unitGroup(job.unit))));
  const processes = pids.map(pid => {
    const life = readProcessLifetime(pid);
    return { pid, lifetime: life.state === 'alive' ? life.identity : null, ...(life.state === 'unknown' && { unknown: true }) };
  });
  const socket = path.join(config.directory, 'owner.sock');
  const sockets = (await fs.readFile('/proc/net/unix', 'utf8')).split('\n').filter(line => line.trim().split(/\s+/).at(-1) === socket);
  return { bootId: await hostBootIdentity(), units, groups, processes, sockets };
}

/** Pure safety decision; unknown observations always refuse reconciliation. */
export function assertOwnerReconciliationEvidence(plan: OwnerReconciliationPlan, observed: NativeEvidence, startingOwner?: number): void {
  if (observed.bootId !== plan.bootId) throw new Error('Host boot changed since the owner recovery plan');
  if (observed.sockets.length) throw new Error('An execution-owner socket is still registered with the kernel');
  if (observed.units.length !== 2 || observed.groups.length !== 2) throw new Error('Incomplete native service observation');
  for (const [index, unit] of observed.units.entries()) {
    const allowedPid = index === 0 ? startingOwner ?? 0 : 0;
    if (unit.mainPid !== allowedPid || (!allowedPid && !['inactive', 'failed'].includes(unit.state)))
      throw new Error('Owner and backend/guardian services must be stopped before reconciliation');
    if (observed.groups[index]!.some(pid => pid !== allowedPid)) throw new Error('An ownership cgroup still contains application or backend processes');
  }
  for (const expected of plan.processes) {
    const actual = observed.processes.find(item => item.pid === expected.pid);
    if (!actual || actual.unknown || (actual.lifetime && (!expected.lifetime || actual.lifetime === expected.lifetime)))
      throw new Error(`Recorded process ${expected.pid} has not been proven gone`);
  }
}

async function records(config: ManagedRuntime): Promise<{ receipt: CrashReceipt; journal: NonNullable<Awaited<ReturnType<ExecutionJournal['read']>>> }> {
  const receipt = await readPrivateRecord<CrashReceipt>(receiptFile(config));
  const journal = await new ExecutionJournal(path.join(config.directory, 'controller.json')).read();
  if (!receipt || receipt.clean !== false || !Number.isSafeInteger(receipt.pid) || receipt.pid < 1 ||
    typeof receipt.bootId !== 'string' || !journal || journal.owner.pid !== receipt.pid)
    throw new Error('A matching unclean owner receipt and controller journal are required');
  return { receipt, journal };
}

/** Read native process identities; no SQLite connection and no service or application mutation. */
export async function prepareOwnerReconciliation(config: ManagedRuntime, recordedWorkerPids: readonly number[]): Promise<OwnerReconciliationPlan> {
  requireSupported(config);
  if (!recordedWorkerPids.length || recordedWorkerPids.length > 4096 || recordedWorkerPids.some(pid => !Number.isSafeInteger(pid) || pid < 1))
    throw new Error('Provide the recorded pre-crash worker PIDs; an empty inventory cannot certify recovery');
  const { receipt, journal } = await records(config);
  const first = await nativeEvidence(config, [receipt.pid]);
  if (first.bootId !== receipt.bootId || first.processes[0]!.lifetime || first.processes[0]!.unknown || first.sockets.length)
    throw new Error('The previous owner must be proven dead on this boot before planning recovery');
  const pids = [...new Set([receipt.pid, ...recordedWorkerPids, ...first.groups.flat(), ...first.units.map(unit => unit.mainPid).filter(Boolean)])];
  const observed = await nativeEvidence(config, pids);
  if (observed.processes.some(item => item.unknown)) throw new Error('A recorded process identity could not be inspected');
  return { protocol: 1, id: randomUUID(), createdAt: new Date().toISOString(), bootId: observed.bootId,
    instanceHome: config.instanceHome, directory: config.directory, binding: binding(config),
    ownerId: journal.owner.id, ownerPid: receipt.pid, crashReceipt: receipt, receiptDigest: digest(receipt), journalDigest: digest(journal),
    processes: observed.processes.map(({ pid, lifetime }) => ({ pid, lifetime })) };
}

function validatePlan(plan: OwnerReconciliationPlan, config: ManagedRuntime): void {
  if (plan?.protocol !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) || !Number.isFinite(Date.parse(plan.createdAt)) || plan.instanceHome !== config.instanceHome ||
    plan.directory !== config.directory || plan.binding !== binding(config) || !plan.ownerId ||
    !Number.isSafeInteger(plan.ownerPid) || plan.ownerPid < 1 || !Array.isArray(plan.processes) || !plan.processes.length ||
    plan.processes.length > 8192 || new Set(plan.processes.map(item => item.pid)).size !== plan.processes.length || !plan.processes.some(item => item.pid === plan.ownerPid) ||
    plan.processes.some(item => !Number.isSafeInteger(item.pid) || item.pid < 1 || (item.lifetime !== null && typeof item.lifetime !== 'string')) ||
    digest(plan.crashReceipt) !== plan.receiptDigest || !/^[a-f0-9]{64}$/.test(plan.journalDigest) ||
    plan.crashReceipt.bootId !== plan.bootId || plan.crashReceipt.clean !== false || plan.crashReceipt.pid !== plan.ownerPid)
    throw new Error('Invalid or changed owner-recovery plan');
}

/** Offline acknowledgment only. It never sends signals or marks the crashed owner clean. */
export async function acknowledgeOwnerReconciliation(config: ManagedRuntime, plan: OwnerReconciliationPlan): Promise<string> {
  requireSupported(config); validatePlan(plan, config);
  return withOwnerBootFence(config, async () => {
    const current = await records(config);
    if (digest(current.receipt) !== plan.receiptDigest || digest(current.journal) !== plan.journalDigest || current.journal.owner.id !== plan.ownerId)
      throw new Error('Owner receipt or controller fence changed since recovery was planned');
    assertOwnerReconciliationEvidence(plan, await nativeEvidence(config, plan.processes.map(item => item.pid)));
    const socket = path.join(config.directory, 'owner.sock');
    const stat = await fs.lstat(socket).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Stale owner socket is not owned by this instance user');
      await fs.unlink(socket);
    }
    assertOwnerReconciliationEvidence(plan, await nativeEvidence(config, plan.processes.map(item => item.pid)));
    const archive = path.join(config.directory, 'owner-reconciliations', plan.id + '.json');
    const acknowledgment: Acknowledgment = { protocol: 1, plan, acknowledgedAt: new Date().toISOString() };
    await writePrivateRecord(archive, acknowledgment);
    await writePrivateRecord(acknowledgmentFile(config), acknowledgment);
    return archive;
  });
}

/** Called under withOwnerBootFence, before the new owner creates a socket or applications. */
export async function consumeOwnerReconciliation(config: ManagedRuntime, previous: unknown, bootId: string): Promise<void> {
  requireSupported(config);
  const acknowledgment = await readPrivateRecord<Acknowledgment>(acknowledgmentFile(config));
  if (!acknowledgment || acknowledgment.protocol !== 1 || acknowledgment.consumedBy) throw new Error('No unused explicit owner-crash reconciliation exists');
  const { plan } = acknowledgment; validatePlan(plan, config);
  if (bootId !== plan.bootId || digest(previous) !== plan.receiptDigest ||
    digest(await new ExecutionJournal(path.join(config.directory, 'controller.json')).read()) !== plan.journalDigest)
    throw new Error('Owner-crash acknowledgment does not match this startup fence');
  const evidence = await nativeEvidence(config, plan.processes.map(item => item.pid));
  // The kernel lock helper is a child of this new owner, not an old application.
  const members = evidence.groups[0] ?? [];
  for (const pid of members.filter(item => item !== process.pid)) {
    let ancestor = pid;
    for (let depth = 0; depth < 8 && ancestor !== process.pid; depth++) {
      const stat = await fs.readFile(`/proc/${ancestor}/stat`, 'utf8');
      ancestor = Number(stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[1]);
    }
    if (ancestor !== process.pid) throw new Error('The new owner cgroup contains a process from another owner');
  }
  evidence.groups[0] = members.filter(pid => pid === process.pid);
  assertOwnerReconciliationEvidence(plan, evidence, process.pid);
  if (await fs.lstat(path.join(config.directory, 'owner.sock')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }))
    throw new Error('Owner socket reappeared after crash reconciliation');
  const life = readProcessLifetime(process.pid);
  if (life.state !== 'alive') throw new Error('The new owner process lifetime could not be verified');
  const consumed: Acknowledgment = { ...acknowledgment, consumedBy: { pid: process.pid, lifetime: life.identity }, consumedAt: new Date().toISOString() };
  await writePrivateRecord(path.join(config.directory, 'owner-reconciliations', plan.id + '.consumed.json'), consumed);
  await writePrivateRecord(acknowledgmentFile(config), consumed);
}

export async function ownerReconciliationCommand(action: 'prepare' | 'acknowledge', input?: string): Promise<void> {
  const config = await readManagedRuntime();
  if (!config) throw new Error('Independent supervision is not configured');
  if (action === 'prepare') {
    const pids = (input ?? '').split(',').filter(Boolean).map(Number);
    const plan = await prepareOwnerReconciliation(config, pids);
    const file = path.join(config.directory, 'owner-reconciliations', plan.id + '.plan.json');
    await writePrivateRecord(file, plan); console.log(JSON.stringify({ plan: file, processCount: plan.processes.length }));
  } else {
    if (!input || !path.isAbsolute(input)) throw new Error('An absolute private recovery-plan path is required');
    const plan = await readPrivateRecord<OwnerReconciliationPlan>(input);
    if (!plan) throw new Error('Owner recovery plan is unavailable');
    console.log(JSON.stringify({ archived: await acknowledgeOwnerReconciliation(config, plan) }));
  }
}
