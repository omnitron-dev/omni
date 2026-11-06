import type { ContainerState } from './types.js';

/** Evidence belongs to one native incarnation, never just a container name. */
export interface UnhealthyEvidence {
  containerId: string;
  startedAt: string;
  firstObservedAt: number;
  lastProbeAt: number;
  confirmations: number;
}

export const UNHEALTHY_GRACE_MS = 60_000;
const MAX_PROBE_AGE_MS = 60_000;

/** Docker's completed probe, not the time at which we polled its cached status. */
export function nativeHealthCheck(value: unknown): ContainerState['healthCheck'] {
  if (!value || typeof value !== 'object') return undefined;
  const log = (value as { Log?: unknown }).Log;
  if (!Array.isArray(log) || !log.length) return undefined;
  const last = log.at(-1) as { End?: unknown; ExitCode?: unknown } | null;
  if (!last || typeof last.End !== 'string' || !Number.isFinite(Date.parse(last.End)) ||
      !Number.isSafeInteger(last.ExitCode)) return undefined;
  return { completedAt: last.End, exitCode: last.ExitCode as number };
}

/** Unknown, stale or repeated probes cannot authorize a destructive recovery. */
export function observeUnhealthy(previous: UnhealthyEvidence | undefined, actual: ContainerState, now: number): {
  evidence?: UnhealthyEvidence;
  restart: boolean;
  reason: string;
} {
  const probeAt = Date.parse(actual.healthCheck?.completedAt ?? '');
  const startedAt = Date.parse(actual.startedAt ?? '');
  if (actual.status !== 'running' || actual.health !== 'unhealthy' || !/^[a-f0-9]{64}$/.test(actual.containerId ?? '') ||
      !Number.isFinite(startedAt) || !Number.isFinite(probeAt) || probeAt < startedAt ||
      now < probeAt || now - probeAt > MAX_PROBE_AGE_MS ||
      !Number.isSafeInteger(actual.healthCheck?.exitCode) || actual.healthCheck?.exitCode === 0) {
    return { restart: false, reason: 'A fresh failed native health check for this container incarnation is required' };
  }
  const same = previous !== undefined && previous !== null && previous.containerId === actual.containerId && previous.startedAt === actual.startedAt &&
    Number.isFinite(previous.firstObservedAt) && previous.firstObservedAt >= startedAt && previous.firstObservedAt <= now &&
    Number.isFinite(previous.lastProbeAt) && previous.lastProbeAt >= startedAt && previous.lastProbeAt <= probeAt &&
    Number.isSafeInteger(previous.confirmations) && previous.confirmations >= 1;
  const evidence: UnhealthyEvidence = same ? { ...previous,
    lastProbeAt: probeAt, confirmations: Math.min(2, previous.confirmations + Number(probeAt > previous.lastProbeAt)),
  } : { containerId: actual.containerId!, startedAt: actual.startedAt!, firstObservedAt: now, lastProbeAt: probeAt, confirmations: 1 };
  const freshConfirmation = same && probeAt > previous.lastProbeAt;
  const restart = freshConfirmation && evidence.confirmations >= 2 && now - evidence.firstObservedAt >= UNHEALTHY_GRACE_MS;
  return { evidence, restart,
    reason: restart ? 'Distinct failed native checks persisted through the recovery grace period'
      : !freshConfirmation ? 'Waiting for another completed native health check' : 'Waiting for the recovery grace period' };
}
