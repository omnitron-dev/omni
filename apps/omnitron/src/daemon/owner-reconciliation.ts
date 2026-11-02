import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readManagedRuntime, hostBootIdentity, type ManagedRuntime } from './managed-runtime.js';
import { ExecutionJournal, readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { readProcessLifetime } from '../monitoring/process-lifetime.js';
import { withKernelFileLock } from '../shared/kernel-file-lock.js';
import { readDarwinOwnerEvidence, type DarwinReconciliationScope } from './darwin-owner-evidence.js';

interface ProcessIdentity { pid: number; lifetime: string | null }
interface CrashReceipt { bootId: string; clean: false; pid: number }
export interface OwnerReconciliationPlan {
  protocol: 1; id: string; createdAt: string; bootId: string;
  instanceHome: string; directory: string; binding: string;
  ownerId: string; ownerPid: number; journalOwnerPid: number; crashReceipt: CrashReceipt; receiptDigest: string; journalDigest: string;
  processes: ProcessIdentity[];
  native?: DarwinReconciliationScope;
}
interface Acknowledgment { protocol: 1; attemptId: string; plan: OwnerReconciliationPlan; acknowledgedAt: string; consumedBy?: ProcessIdentity; consumedAt?: string }
interface NativeEvidence {
  bootId: string; units: Array<{ mainPid: number; state: string }>;
  groups: number[][]; processes: Array<{ pid: number; lifetime: string | null; unknown?: boolean }>;
  sockets: string[];
  native?: DarwinReconciliationScope;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unitGroup = (unit: string) => `/system.slice/${unit}`;
const receiptFile = (config: ManagedRuntime) => path.join(config.directory, 'managed-owner.json');
const acknowledgmentFile = (config: ManagedRuntime) => path.join(config.directory, 'owner-reconciliation.json');
const binding = (config: ManagedRuntime) => digest({ ...config, owner: { ...config.owner, artifact: undefined }, backend: { ...config.backend, artifact: undefined } });

function requireSupported(config: ManagedRuntime): void {
  if (process.platform !== 'darwin' && !(process.platform === 'linux' && config.scope === 'system'))
    throw new Error('Explicit owner-crash reconciliation requires macOS launchd or Linux systemd system services');
}

/** Shared with owner startup: the kernel releases this fence even if the CLI dies. */
export async function withOwnerBootFence<T>(config: ManagedRuntime, body: () => Promise<T>): Promise<T> {
  return withKernelFileLock(path.join(config.directory, 'owner-reconciliation.lock'), body);
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

async function nativeEvidence(config: ManagedRuntime, identities: readonly ProcessIdentity[], native?: DarwinReconciliationScope): Promise<NativeEvidence> {
  requireSupported(config);
  if (process.platform === 'darwin') return readDarwinOwnerEvidence(config, identities, await hostBootIdentity(), native);
  const pids = identities.map(identity => identity.pid);
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
  if (plan.native && (observed.native?.bootSession !== plan.native.bootSession || observed.native.domain !== plan.native.domain))
    throw new Error('Native boot session or service domain changed since recovery was planned');
  if (observed.sockets.length) throw new Error('An execution-owner socket is still registered with the kernel');
  if (observed.units.length !== 2 || observed.groups.length !== 2) throw new Error('Incomplete native service observation');
  for (const [index, unit] of observed.units.entries()) {
    const allowedPid = index === 0 ? startingOwner ?? 0 : 0;
    if (unit.mainPid !== allowedPid || (!allowedPid && !['inactive', 'failed'].includes(unit.state)))
      throw new Error('Owner and backend/guardian services must be stopped before reconciliation');
    if (observed.groups[index]!.some(pid => pid !== allowedPid)) throw new Error('An ownership cgroup/process group still contains application or backend processes');
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
    typeof receipt.bootId !== 'string' || !journal)
    throw new Error('An unclean owner receipt and controller journal are required');
  return { receipt, journal };
}

/** Seal native identities in private records; no SQLite or service/application mutation. */
export async function prepareOwnerReconciliation(config: ManagedRuntime, recordedWorkerPids: readonly number[]): Promise<OwnerReconciliationPlan> {
  requireSupported(config);
  if (!recordedWorkerPids.length || recordedWorkerPids.length > 4096 || recordedWorkerPids.some(pid => !Number.isSafeInteger(pid) || pid < 1))
    throw new Error('Provide the recorded pre-crash worker PIDs; an empty inventory cannot certify recovery');
  return withOwnerBootFence(config, async () => {
    const { receipt, journal } = await records(config);
    // A failed new startup can write its dirty receipt before the controller
    // journal advances. Preserve and fence BOTH identities in that case.
    const previousOwners = [...new Set([receipt.pid, journal.owner.pid])];
    const first = await nativeEvidence(config, previousOwners.map(pid => ({ pid, lifetime: null })));
    if (first.bootId !== receipt.bootId || first.processes.some(item => item.lifetime || item.unknown) || first.sockets.length)
      throw new Error('Every previous owner identity must be proven dead on this boot before planning recovery');
    const pids = [...new Set([...previousOwners, ...recordedWorkerPids, ...first.groups.flat(), ...first.units.map(unit => unit.mainPid).filter(Boolean)])];
    const observed = await nativeEvidence(config, pids.map(pid => ({ pid, lifetime: null })));
    if (observed.processes.some(item => item.unknown)) throw new Error('A recorded process identity could not be inspected');
    const plan: OwnerReconciliationPlan = { protocol: 1, id: randomUUID(), createdAt: new Date().toISOString(), bootId: observed.bootId,
      instanceHome: config.instanceHome, directory: config.directory, binding: binding(config),
      ownerId: journal.owner.id, ownerPid: receipt.pid, journalOwnerPid: journal.owner.pid, crashReceipt: receipt, receiptDigest: digest(receipt), journalDigest: digest(journal),
      processes: observed.processes.map(({ pid, lifetime }) => ({ pid, lifetime })), ...(observed.native && { native: observed.native }) };
    await writePrivateRecord(path.join(config.directory, 'owner-reconciliations', plan.id + '.plan.json'), plan);
    await writePrivateRecord(path.join(config.directory, 'owner-reconciliations', plan.id + '.seal.json'), { protocol: 1, sha256: digest(plan) });
    return plan;
  });
}

function validatePlan(plan: OwnerReconciliationPlan, config: ManagedRuntime): void {
  if (plan?.protocol !== 1 || !/^[a-f0-9-]{36}$/.test(plan.id) || !Number.isFinite(Date.parse(plan.createdAt)) || plan.instanceHome !== config.instanceHome ||
    plan.directory !== config.directory || plan.binding !== binding(config) || !plan.ownerId ||
    !Number.isSafeInteger(plan.ownerPid) || plan.ownerPid < 1 || !Number.isSafeInteger(plan.journalOwnerPid) || plan.journalOwnerPid < 1 ||
    !Array.isArray(plan.processes) || !plan.processes.length ||
    plan.processes.length > 8192 || new Set(plan.processes.map(item => item.pid)).size !== plan.processes.length ||
    ![plan.ownerPid, plan.journalOwnerPid].every(pid => plan.processes.some(item => item.pid === pid)) ||
    plan.processes.some(item => !Number.isSafeInteger(item.pid) || item.pid < 1 || (item.lifetime !== null && typeof item.lifetime !== 'string')) ||
    digest(plan.crashReceipt) !== plan.receiptDigest || !/^[a-f0-9]{64}$/.test(plan.journalDigest) ||
    plan.crashReceipt.bootId !== plan.bootId || plan.crashReceipt.clean !== false || plan.crashReceipt.pid !== plan.ownerPid ||
    (process.platform === 'darwin' && (!plan.native || plan.native.platform !== 'darwin' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(plan.native.bootSession) || plan.native.domain !== (config.scope === 'system' ? 'system' : `gui/${process.getuid!()}`) ||
      !Array.isArray(plan.native.processGroups) || plan.native.processGroups.length > 8192 ||
      new Set(plan.native.processGroups).size !== plan.native.processGroups.length ||
      plan.native.processGroups.some(group => !Number.isSafeInteger(group) || group < 1))) ||
    (process.platform !== 'darwin' && plan.native))
    throw new Error('Invalid or changed owner-recovery plan');
}

async function validateSealedPlan(config: ManagedRuntime, plan: OwnerReconciliationPlan): Promise<void> {
  const base = path.join(config.directory, 'owner-reconciliations', plan.id);
  const saved = await readPrivateRecord<OwnerReconciliationPlan>(base + '.plan.json');
  const seal = await readPrivateRecord<{ protocol: number; sha256: string }>(base + '.seal.json');
  if (!saved || seal?.protocol !== 1 || seal.sha256 !== digest(saved) || digest(plan) !== seal.sha256)
    throw new Error('Recovery plan is unsealed or changed; prepare a fresh native observation');
  if (await readPrivateRecord(base + '.consumed.json'))
    throw new Error('Owner recovery plan has already been consumed; prepare a fresh plan');
}

async function assertUnusedAcknowledgment(config: ManagedRuntime, acknowledgment: Acknowledgment): Promise<void> {
  if (acknowledgment.consumedBy || await readPrivateRecord(path.join(config.directory, 'owner-reconciliations',
    acknowledgment.plan.id + '.' + acknowledgment.attemptId + '.consumed.json')))
    throw new Error('Owner recovery acknowledgment has already been consumed; prepare a fresh plan');
}

/** Offline acknowledgment only. It never sends signals or marks the crashed owner clean. */
export async function acknowledgeOwnerReconciliation(config: ManagedRuntime, plan: OwnerReconciliationPlan): Promise<string> {
  requireSupported(config); validatePlan(plan, config);
  return withOwnerBootFence(config, async () => {
    await validateSealedPlan(config, plan);
    const previous = await readPrivateRecord<Acknowledgment>(acknowledgmentFile(config));
    if (previous && (previous.protocol !== 1 || !/^[a-f0-9-]{36}$/.test(previous.attemptId) || !/^[a-f0-9-]{36}$/.test(previous.plan?.id)))
      throw new Error('Invalid previous owner recovery acknowledgment');
    if (previous?.plan?.id === plan.id) await assertUnusedAcknowledgment(config, previous);
    const current = await records(config);
    if (digest(current.receipt) !== plan.receiptDigest || digest(current.journal) !== plan.journalDigest || current.journal.owner.id !== plan.ownerId)
      throw new Error('Owner receipt or controller fence changed since recovery was planned');
    assertOwnerReconciliationEvidence(plan, await nativeEvidence(config, plan.processes, plan.native));
    const socket = path.join(config.directory, 'owner.sock');
    const stat = await fs.lstat(socket).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Stale owner socket is not owned by this instance user');
      await fs.unlink(socket);
    }
    assertOwnerReconciliationEvidence(plan, await nativeEvidence(config, plan.processes, plan.native));
    const attemptId = randomUUID();
    const archive = path.join(config.directory, 'owner-reconciliations', plan.id + '.' + attemptId + '.json');
    const acknowledgment: Acknowledgment = { protocol: 1, attemptId, plan, acknowledgedAt: new Date().toISOString() };
    await writePrivateRecord(archive, acknowledgment);
    await writePrivateRecord(acknowledgmentFile(config), acknowledgment);
    return archive;
  });
}

/** Called under withOwnerBootFence, before the new owner creates a socket or applications. */
export async function consumeOwnerReconciliation(config: ManagedRuntime, previous: unknown, bootId: string): Promise<void> {
  requireSupported(config);
  const acknowledgment = await readPrivateRecord<Acknowledgment>(acknowledgmentFile(config));
  if (!acknowledgment || acknowledgment.protocol !== 1 || !/^[a-f0-9-]{36}$/.test(acknowledgment.attemptId) || acknowledgment.consumedBy)
    throw new Error('No unused explicit owner-crash reconciliation exists');
  const { plan } = acknowledgment; validatePlan(plan, config);
  await validateSealedPlan(config, plan);
  await assertUnusedAcknowledgment(config, acknowledgment);
  if (bootId !== plan.bootId || digest(previous) !== plan.receiptDigest ||
    digest(await new ExecutionJournal(path.join(config.directory, 'controller.json')).read()) !== plan.journalDigest)
    throw new Error('Owner-crash acknowledgment does not match this startup fence');
  const evidence = await nativeEvidence(config, plan.processes, plan.native);
  // The inherited-descriptor kernel helper has already exited. No application
  // or other descendant may exist before this acknowledgment is consumed.
  assertOwnerReconciliationEvidence(plan, evidence, process.pid);
  if (await fs.lstat(path.join(config.directory, 'owner.sock')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }))
    throw new Error('Owner socket reappeared after crash reconciliation');
  const life = readProcessLifetime(process.pid);
  if (life.state !== 'alive') throw new Error('The new owner process lifetime could not be verified');
  const consumed: Acknowledgment = { ...acknowledgment, consumedBy: { pid: process.pid, lifetime: life.identity }, consumedAt: new Date().toISOString() };
  await writePrivateRecord(path.join(config.directory, 'owner-reconciliations', plan.id + '.consumed.json'), consumed);
  await writePrivateRecord(path.join(config.directory, 'owner-reconciliations', plan.id + '.' + acknowledgment.attemptId + '.consumed.json'), consumed);
  await writePrivateRecord(acknowledgmentFile(config), consumed);
}

export async function ownerReconciliationCommand(action: 'prepare' | 'acknowledge', input?: string): Promise<void> {
  const { emitJson } = await import('../commands/output.js');
  const config = await readManagedRuntime();
  if (!config) throw new Error('Independent supervision is not configured');
  if (action === 'prepare') {
    const pids = (input ?? '').split(',').filter(Boolean).map(Number);
    const plan = await prepareOwnerReconciliation(config, pids);
    const file = path.join(config.directory, 'owner-reconciliations', plan.id + '.plan.json');
    const result = { plan: file, sha256: digest(plan), processCount: plan.processes.length, platform: process.platform,
      ...(plan.native && { processGroups: plan.native.processGroups, coverage: 'Supplied identities, observed descendants and retained process groups; detached unrecorded processes require independent reconciliation.' }) };
    if (!emitJson(result)) console.log(JSON.stringify(result));
  } else {
    if (!input || !path.isAbsolute(input)) throw new Error('An absolute private recovery-plan path is required');
    const plan = await readPrivateRecord<OwnerReconciliationPlan>(input);
    if (!plan) throw new Error('Owner recovery plan is unavailable');
    const result = { archived: await acknowledgeOwnerReconciliation(config, plan) };
    if (!emitJson(result)) console.log(JSON.stringify(result));
  }
}
