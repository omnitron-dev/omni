import type { HandoffTicket, ControllerGrant } from '@omnitron-dev/titan-pm';
import { createHash } from 'node:crypto';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import type { ProjectService } from '../services/project.service.js';
import type { InfrastructureHandoffState } from '../infrastructure/infrastructure.service.js';
import path from 'node:path';
import { readPrivateRecord } from './execution-journal.js';
import { expandPath } from '../shared/paths.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { OperationReceipt } from '../shared/dto/execution-operations.js';
import type { BackendHandoffReview } from './backend-recovery-journal.js';
import { isDeepStrictEqual } from 'node:util';

/** Private controller checkpoint; contains resolved configuration and must never enter public diagnostics. */
export interface BackendHandoffState {
  protocol: 1;
  ticket: HandoffTicket;
  watchConfig: IEcosystemConfig;
  projects: Awaited<ReturnType<ProjectService['prepareHandoff']>>;
  infrastructure: InfrastructureHandoffState | null;
  executionInventory: string;
}

export interface BackendBootRecord {
  protocol: 1;
  state: BackendHandoffState;
  daemonConfig: IDaemonConfig;
  previousEntry: string;
  previousPid: number;
  createdAt: string;
  cwd: string;
  environment: Record<string, string>;
  /** Bound by the live controller before freezing its authoritative checkpoint. */
  configuration?: BackendConfigurationReview;
}

export interface BackendConfigurationReview { sha256: string; registryDigest: string }
export interface BackendHandoffAdmission {
  backend: { pid: number; controller: ControllerGrant };
  configuration: BackendConfigurationReview;
  backups: OperationReceipt[];
}

/** One snapshot builder for read-only recovery and the authoritative frozen checkpoint. */
export function backendSnapshot<State extends Omit<BackendHandoffState, 'ticket'>>(
  state: State, daemonConfig: IDaemonConfig, previousEntry: string, createdAt = new Date().toISOString(),
): Omit<BackendBootRecord, 'state'> & { state: State } {
  return { protocol: 1, state: structuredClone(state), daemonConfig: structuredClone(daemonConfig), previousEntry,
    previousPid: process.pid, createdAt, cwd: process.cwd(),
    environment: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), OMNITRON_HOME } };
}

/** Native health observations may advance during drain. Configuration, grants,
 * application inventory and execution context may not. Infrastructure adoption
 * separately validates every native resource in the exact frozen checkpoint. */
export function backendConfigurationDigest(record: Omit<BackendBootRecord, 'state'> & {
  state: Omit<BackendHandoffState, 'ticket'> & { ticket?: HandoffTicket }; controller?: ControllerGrant;
}, registryDigest: string): string {
  const controller = record.state.ticket?.from ?? record.controller;
  if (!controller?.ownerId || !controller.controllerId || !Number.isSafeInteger(controller.epoch) || controller.epoch < 1 ||
      !/^[a-f0-9]{64}$/.test(registryDigest) || !/^[a-f0-9]{64}$/.test(record.state.executionInventory))
    throw Error('Backend configuration has no exact registry and controller identity');
  const infrastructureIntent = (snapshot: InfrastructureHandoffState | null) => {
    if (!snapshot) return null;
    const { nativeState, state, unhealthyTicks: _ticks, unhealthyEvidence: _health, restartBackoff: _retry, ...definition } = snapshot;
    return { ...definition, nativeProtocol: nativeState?.protocol,
      containersObserved: Object.entries(state.services).map(([name, container]) => ({ name, containerId: container.containerId ?? null,
        ...(container.containerId ? {} : { failedCreation: container.status === 'exited' && Boolean(container.error) }) })) };
  };
  const { infrastructure, resumeBackoff: _retry, ...projectIntent } = record.state.projects;
  return createHash('sha256').update(JSON.stringify({ protocol: 1, registryDigest, ownerId: controller.ownerId, daemonConfig: record.daemonConfig,
    cwd: record.cwd, environment: record.environment, watchConfig: record.state.watchConfig,
    projects: { ...projectIntent, infrastructure: infrastructure.map(({ infrastructure: snapshot, ...scope }) => ({
      ...scope, infrastructure: infrastructureIntent(snapshot),
    })) }, infrastructure: infrastructureIntent(record.state.infrastructure), executionInventory: record.state.executionInventory })).digest('hex');
}

export function assertBackendHandoffAdmission(admission: BackendHandoffAdmission): void {
  if (!admission || !Number.isSafeInteger(admission.backend?.pid) || admission.backend.pid < 1 ||
      !admission.backend.controller?.ownerId || !admission.backend.controller.controllerId ||
      !Number.isSafeInteger(admission.backend.controller.epoch) || admission.backend.controller.epoch < 1 ||
      ![admission.configuration?.sha256, admission.configuration?.registryDigest]
    .every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) ||
      !Array.isArray(admission.backups) || admission.backups.length > 1000 ||
      new Set(admission.backups.map(value => value?.id)).size !== admission.backups.length ||
      admission.backups.some(value => !value || value.protocol !== 1 || value.kind !== 'backup' ||
        !['prepared', 'running'].includes(value.state) || typeof value.id !== 'string' || !value.id ||
        !Number.isSafeInteger(value.revision) || value.revision < 1 || !/^[a-f0-9]{64}$/.test(value.inputDigest) ||
        !Array.isArray(value.resources))) throw Error('Invalid reviewed backend admission');
}

export function assertBackendHandoffReview(review: BackendHandoffReview, expected: {
  pid: number; entry: string; instanceHome: string; ownerId: string | undefined; epoch: number | undefined; inventory?: string; runtimeHash?: string;
}): void {
  assertBackendHandoffAdmission(review?.admission);
  const { record, admission } = review;
  if (!record || record.protocol !== 1 || record.state?.protocol !== 1 || 'ticket' in record.state ||
      !/^[a-f0-9]{64}$/.test(record.runtimeHash) || expected.runtimeHash !== undefined && record.runtimeHash !== expected.runtimeHash ||
      record.previousPid !== expected.pid || record.previousEntry !== expected.entry ||
      checkpointInstanceHome(record) !== path.resolve(expected.instanceHome) || record.controller.ownerId !== expected.ownerId ||
      record.controller.epoch !== expected.epoch || admission.backend.pid !== expected.pid ||
      !isDeepStrictEqual(admission.backend.controller, record.controller) || admission.configuration.registryDigest !== record.registryDigest ||
      backendConfigurationDigest(record, record.registryDigest) !== admission.configuration.sha256 ||
      expected.inventory !== undefined && record.state.executionInventory !== expected.inventory)
    throw Error('Backend handoff review does not match the selected controller and configuration');
}

/** Rollback can follow the successor's grant, but inherits no new cancellation
 * authority. A newly started backup must finish before that rollback can drain. */
export function backendHandoffAdmissionForApply(reviewed: BackendHandoffAdmission, current: BackendHandoffAdmission, rollback = false): BackendHandoffAdmission {
  assertBackendHandoffAdmission(reviewed); assertBackendHandoffAdmission(current);
  if (!isDeepStrictEqual(reviewed.configuration, current.configuration) ||
      reviewed.backend.controller.ownerId !== current.backend.controller.ownerId ||
      !rollback && !isDeepStrictEqual(reviewed.backend, current.backend))
    throw Error('Reviewed backend identity or configuration changed before handoff');
  return structuredClone(rollback ? { ...current, backups: [] } : reviewed);
}

/** Resolve the selected checkpoint, never the invoking shell's default instance. */
export function checkpointInstanceHome(record: Pick<BackendBootRecord, 'environment' | 'daemonConfig'>): string {
  const home = record.environment['OMNITRON_HOME'];
  if (home !== undefined) {
    if (!path.isAbsolute(home)) throw new Error('Checkpoint instance home must be absolute');
    return path.resolve(home);
  }
  // Older checkpoints did not explicitly capture the default instance home.
  const marker = record.daemonConfig.pidFile;
  if (typeof marker !== 'string' || !path.isAbsolute(expandPath(marker))) throw new Error('Checkpoint has no absolute instance identity');
  return path.dirname(expandPath(marker));
}

export async function readBackendBootRecord(file: string | undefined): Promise<BackendBootRecord> {
  if (!file || !path.isAbsolute(file)) throw new Error('An absolute private backend checkpoint is required');
  const record = await readPrivateRecord<BackendBootRecord>(file);
  if (!record || record.protocol !== 1 || record.state?.protocol !== 1 || !record.state.ticket?.id ||
      !record.daemonConfig?.executionHost?.enabled || typeof record.previousEntry !== 'string' || !path.isAbsolute(record.previousEntry) ||
      !Number.isSafeInteger(record.previousPid) || record.previousPid < 1 ||
      typeof record.cwd !== 'string' || !path.isAbsolute(record.cwd) || !record.environment ||
      !/^[a-f0-9]{64}$/.test(record.state.executionInventory) ||
      typeof record.environment !== 'object' || Array.isArray(record.environment) ||
      Object.values(record.environment).some(value => typeof value !== 'string')) {
    throw new Error('Invalid backend checkpoint; automatic adoption is refused');
  }
  return record;
}
