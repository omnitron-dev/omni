/**
 * Backend connectivity store.
 *
 * Probes /health every PROBE_INTERVAL_MS and tracks whether the daemon
 * is reachable. Components read this store to gate sign-in, show banners, etc.
 */

import { create } from 'zustand';

import {
  classifyHealthResponse,
  nextBackendStatus,
  type BackendStatus,
  type ProbeOutcome,
} from 'src/utils/backend-health';

const PROBE_INTERVAL_MS = 30_000;
// Generous on purpose. The probe competes with everything else on the host,
// and the cost of waiting is a banner appearing a few seconds later; the cost
// of giving up early is telling an operator their daemon is down. Measured at
// 8.2 s on a loaded machine against a daemon answering in 3 ms.
const PROBE_TIMEOUT_MS = 15_000;

interface BackendStatusState {
  status: BackendStatus;
  lastChecked: number | null;
  /** Probes that failed to complete, in a row. Reset by any conclusive answer. */
  consecutiveUnreachable: number;
  /** Trigger an immediate probe and await the result */
  probe: () => Promise<void>;
  /** Start the background polling loop */
  startPolling: () => () => void;
}

async function probeHealth(): Promise<ProbeOutcome> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch('/api/health', { signal: ac.signal, cache: 'no-store' });
    clearTimeout(timer);

    const contentType = res.headers.get('content-type');
    const body = res.ok
      ? ((await res.json().catch(() => null)) as { status?: string } | null)
      : null;

    return classifyHealthResponse(res.status, contentType, body);
  } catch {
    // Timeout, abort, network error — the request did not complete, which
    // says nothing about whether the daemon is running.
    return 'unreachable';
  }
}

/** Run one probe and fold its outcome into the store. */
async function runProbe(
  set: (partial: Partial<BackendStatusState>) => void,
  get: () => BackendStatusState
): Promise<void> {
  const outcome = await probeHealth();
  const next = nextBackendStatus(outcome, get().consecutiveUnreachable);
  set({
    status: next.status,
    consecutiveUnreachable: next.consecutiveUnreachable,
    lastChecked: Date.now(),
  });
}

export const useBackendStatusStore = create<BackendStatusState>((set, get) => ({
  status: 'unknown',
  lastChecked: null,
  consecutiveUnreachable: 0,

  probe: async () => {
    await runProbe(set, get);
  },

  startPolling: () => {
    void runProbe(set, get);
    const id = setInterval(() => void runProbe(set, get), PROBE_INTERVAL_MS);
    return () => clearInterval(id);
  },
}));

/** Convenience selectors */
// `degraded` counts as usable: one probe that did not complete is not a
// reason to disable sign-in on a daemon that is very likely running.
export const useBackendOnline = () =>
  useBackendStatusStore((s) => s.status !== 'offline');

export const useBackendStatus = () => useBackendStatusStore((s) => s.status);
