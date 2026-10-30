import type { HandoffTicket } from '@omnitron-dev/titan-pm';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import type { ProjectService } from '../services/project.service.js';
import type { InfrastructureHandoffState } from '../infrastructure/infrastructure.service.js';
import path from 'node:path';
import { readPrivateRecord } from './execution-journal.js';

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
