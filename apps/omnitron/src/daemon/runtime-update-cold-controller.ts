import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { compareProcessLifetimes } from '@omnitron-dev/common/process-identity';
import { ProjectRegistry } from '../project/registry.js';
import { readRestartConfiguration } from '../project/runtime-restart.js';
import type { RuntimeUpdatePlan } from '../shared/dto/runtime-update.js';
import { assertCertifiedBackendRecord, BackendRecoveryJournal, type BackendRecoveryState } from './backend-recovery-journal.js';
import { ExecutionJournal, type ExecutionJournalRecord } from './execution-journal.js';
import { executionDirectory } from './execution-launcher.js';
import { backendConfigurationDigest } from './backend-handoff-types.js';
import type { NativeEmptyRuntimeObservation } from './runtime-update-native.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const startup = 'Controller startup has not published a recovery snapshot';
const reasons = [startup, 'execution.configureReadiness', 'execution.setDevMode', 'execution.setWatchMode'];

export interface ColdControllerEvidence {
  authority: ExecutionJournalRecord;
  journal: Extract<BackendRecoveryState, { status: 'invalid' }>;
  retained: { registryDigest: string; inventoryDigest: string; ownerId: string; stacks: number };
  catalogue: { registryDigest: string; lifecycleDigest?: string; operationDigest?: string };
}

export async function readColdControllerEvidence(home: string, directory: string, plan: RuntimeUpdatePlan): Promise<ColdControllerEvidence> {
  if (plan.instance !== home || plan.configuration?.basis !== 'retained-next-start' ||
      plan.stacks.length || plan.watches.length || plan.backupOperations.length)
    throw Error('Cold controller retirement requires the retained empty update plan');
  const recovery = new BackendRecoveryJournal(directory, { readOnly: true });
  try {
    const journal = recovery.read();
    if (journal?.status !== 'invalid' || !journal.previousCertifiedAt) throw Error('No previous recovery certificate');
    const authority = await new ExecutionJournal(path.join(directory, 'controller.json')).read();
    if (!authority) throw Error('No durable execution grant');
    const retained = await readRestartConfiguration(home, plan.configuration.sha256);
    const catalogue = ProjectRegistry.withRecoveryCatalogue(path.join(home, 'data/daemon-state.db'),
      { lifecycle: true, operationsCertifiedAt: journal.previousCertifiedAt }, value => value);
    return { authority, journal, catalogue, retained: { registryDigest: retained.registryDigest,
      inventoryDigest: retained.inventoryDigest, ownerId: retained.ownerId, stacks: retained.stacks.length } };
  } finally { await recovery.close(); }
}

/** The first grant committed by an otherwise empty candidate owner. All
 * observations prove only that this exact owner can be retired during rollback. */
export function coldControllerEvidenceDigest(home: string, plan: RuntimeUpdatePlan | undefined, observed: NativeEmptyRuntimeObservation): string {
  const { config, selection, owner, guardian, native, markerPid, startupEvidence: evidence } = observed;
  if (!plan || !evidence || plan.instance !== home || plan.configuration?.basis !== 'retained-next-start' ||
      !hash.test(plan.configuration.sha256) || plan.stacks.length || plan.watches.length || plan.backupOperations.length)
    throw Error('Cannot retire a claimed owner without the retained empty update plan');
  const { authority, journal, retained, catalogue } = evidence;
  const before = plan.before, prior = journal.previous, status = owner.status, ticket = status.pending;
  if (!prior || journal.status !== 'invalid' || journal.reason !== startup || journal.additionalReasons !== undefined ||
      !Array.isArray(journal.reasons) || journal.reasons[0] !== startup ||
      !isDeepStrictEqual([...journal.reasons].sort(), [...reasons].sort()))
    throw Error('Cannot retire a controller with incomplete or additional startup mutations');
  assertCertifiedBackendRecord(prior);
  if (!Array.isArray(prior.state.watchConfig?.apps) || !Array.isArray(prior.state.projects?.projects) ||
      !Array.isArray(prior.state.projects.stacks) || !Array.isArray(prior.state.projects.infrastructure) ||
      !Array.isArray(prior.state.projects.resumeBackoff) || typeof prior.state.projects.reconciling !== 'boolean')
    throw Error('Cannot retire a controller with incomplete previous ownership evidence');
  if (before.scope !== config.scope || before.backend !== before.owner || before.backend !== before.guardian || before.backend === plan.target.artifact ||
      selection.current !== plan.target.artifact || selection.previous !== before.backend || selection.revision !== before.revision + 1 ||
      prior.protocol !== 1 || prior.state?.protocol !== 1 || prior.runtimeHash !== before.backend || prior.previousPid !== before.backendPid ||
      prior.previousEntry !== path.join(home, 'runtime/releases', before.backend, 'packages/0/dist/daemon/daemon-entry.js') ||
      !prior.daemonConfig?.executionHost?.enabled || executionDirectory(prior.daemonConfig) !== config.directory ||
      prior.controller?.ownerId !== before.ownerId || retained.ownerId !== before.ownerId || retained.stacks !== 0 ||
      prior.registryDigest !== retained.registryDigest || prior.registryDigest !== catalogue.registryDigest ||
      !hash.test(catalogue.lifecycleDigest ?? '') || !hash.test(catalogue.operationDigest ?? '') ||
      prior.state.executionInventory !== retained.inventoryDigest)
    throw Error('Cannot retire a controller whose previous certificate, selection or catalogue differs from the update');
  // Validate the retained certificate with the same configuration projection used in live handoff.
  backendConfigurationDigest(prior, catalogue.registryDigest);
  if (!Number.isSafeInteger(prior.controller.epoch) || prior.controller.epoch < 1 || !uuid.test(prior.controller.controllerId) ||
      !ticket || !uuid.test(ticket.id) || ticket.ownerId !== status.owner.id || ticket.from.ownerId !== status.owner.id ||
      ticket.from.controllerId !== 'unclaimed' || ticket.from.epoch !== prior.controller.epoch + 1 ||
      ticket.to.epoch !== ticket.from.epoch + 1 || !uuid.test(ticket.to.controllerId) || ticket.to.controllerId === prior.controller.controllerId ||
      !isDeepStrictEqual(ticket.to, status.controller) || authority.protocol !== 1 ||
      !isDeepStrictEqual(authority.owner, status.owner) || !isDeepStrictEqual(authority.grant, ticket.to) || before.ownerId === status.owner.id)
    throw Error('Cannot retire a controller without the durable first grant of the candidate owner');
  if (typeof owner.devMode !== 'boolean' || typeof owner.watchEnabled !== 'boolean' || owner.lastEvent !== 0 || owner.acknowledgedEvent !== 0 || owner.droppedEvents !== 0 || !Array.isArray(owner.events) || owner.events.length ||
      owner.inventoryDigest !== digest({ apps: [], workers: [] }) ||
      !Number.isSafeInteger(guardian.backendPid) || !guardian.backendPid || markerPid !== null && markerPid !== guardian.backendPid ||
      !isDeepStrictEqual(before.retiredPids, [...new Set([before.guardianPid, before.backendPid])].sort((a, b) => a - b)))
    throw Error('Cannot retire a controller with application history or unconfirmed backend ownership');
  const oldPids = [before.ownerPid, before.guardianPid, before.backendPid];
  if (oldPids.some(pid => !Number.isSafeInteger(pid) || pid < 1) || new Set([...oldPids, status.owner.pid, guardian.pid, guardian.backendPid]).size !== 6 || oldPids.some(pid =>
    !native.processes.some(row => row.pid === pid && !row.unknown && row.lifetime === null)) ||
      native.sockets.some(socket => ![path.join(config.directory, 'owner.sock'), path.join(config.directory, 'supervisor.sock')].includes(socket)))
    throw Error('Cannot retire a controller with remaining processes or private backend sockets');
  const lifetimes = [before.ownerLifetime, ...native.cohort.map(row => row.lifetime)];
  if (native.native.bootSession !== native.bootId.slice(7) || lifetimes.some(life => !life.startsWith(native.bootId + ':utc:') ||
      compareProcessLifetimes(life, life) !== 'same'))
    throw Error('Cannot retire a controller with unconfirmed boot or process lifetimes');
  const times = [prior.createdAt, journal.previousCertifiedAt, selection.selectedAt, status.owner.startedAt, journal.at].map(s => Date.parse(s ?? ''));
  if (times.some((t, i) => !Number.isFinite(t) || i > 0 && t < times[i - 1]!))
    throw Error('Cannot retire a controller with inconsistent certificate chronology');
  return digest({ plan, authority, journal, retained, catalogue, selection, ticket, guardianBackendPid: guardian.backendPid, guardianReason: guardian.reason,
    markerPid, devMode: owner.devMode, watchEnabled: owner.watchEnabled, native: native.native });
}
