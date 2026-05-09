/**
 * Backend connectivity store.
 *
 * Probes /health every PROBE_INTERVAL_MS and tracks whether the daemon
 * is reachable. Components read this store to gate sign-in, show banners, etc.
 */

import { create } from 'zustand';

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

type BackendStatus = 'unknown' | 'online' | 'offline';

interface BackendStatusState {
  status: BackendStatus;
  lastChecked: number | null;
  /** Trigger an immediate probe and await the result */
  probe: () => Promise<void>;
  /** Start the background polling loop */
  startPolling: () => () => void;
}

async function checkHealth(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch('/api/health', { signal: ac.signal, cache: 'no-store' });
    clearTimeout(timer);
    // 502/503 = proxy can't reach daemon
    if (res.status === 502 || res.status === 503) return false;
    // SPA fallback (text/html) means the route isn't proxied to the daemon
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return false;
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === 'online';
  } catch {
    return false;
  }
}

export const useBackendStatusStore = create<BackendStatusState>((set) => ({
  status: 'unknown',
  lastChecked: null,

  probe: async () => {
    const ok = await checkHealth();
    set({ status: ok ? 'online' : 'offline', lastChecked: Date.now() });
  },

  startPolling: () => {
    // Immediate probe on start
    checkHealth().then((ok) =>
      set({ status: ok ? 'online' : 'offline', lastChecked: Date.now() })
    );

    const id = setInterval(async () => {
      const ok = await checkHealth();
      set({ status: ok ? 'online' : 'offline', lastChecked: Date.now() });
    }, PROBE_INTERVAL_MS);

    return () => clearInterval(id);
  },
}));

/** Convenience selectors */
export const useBackendOnline = () =>
  useBackendStatusStore((s) => s.status === 'online' || s.status === 'unknown');

export const useBackendStatus = () => useBackendStatusStore((s) => s.status);
