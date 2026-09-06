/**
 * A stack that failed to start, versus an RPC that gave up waiting.
 *
 * `startStack` can take longer than the transport's request budget, so the
 * store deliberately ignores a timeout: both pages that call it poll
 * `fetchStacks`, and the real status arrives on its own. Everything else it
 * catches is the daemon saying why the stack did not start, and that has to
 * reach the operator.
 *
 * The old predicate separated the two by matching `/timeout|timed out/` over
 * the message, which is a decision made on the words that name a condition
 * rather than on the condition. The six messages below are real — extracted
 * from the daemon's own `new Error(...)` sites — and every one of them was
 * being discarded as "just a timeout, polling will sort it out".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const startStack = vi.fn();
const stopStack = vi.fn();

vi.mock('../../webapp/src/netron/client', () => ({
  project: {
    listProjects: vi.fn(async () => []),
    listStacks: vi.fn(async () => []),
    getStackStatus: vi.fn(async () => null),
    startStack: (...args: unknown[]) => startStack(...args),
    stopStack: (...args: unknown[]) => stopStack(...args),
  },
}));

/** Real messages from `apps/omnitron/src/**` — `new Error(...)` sites. */
const DAEMON_FAILURES = [
  'restartApp(main) timed out after 30000ms',
  'Port-forward timed out',
  'Step timed out after 60000ms',
  'Heartbeat timeout',
  'Daemon socket connection timeout (5000ms): unix:///tmp/omnitron.sock',
  'timeout',
];

/**
 * What the transport itself throws when it stops waiting.
 *
 * Two independent signals, and the fixtures keep them independent on purpose.
 * `code` alone covers the case where something between the transport and the
 * store re-words the message; the message alone covers the case where the
 * re-wrap drops the property. A fixture carrying both at once would make
 * either branch removable without a test noticing — which is how the first
 * version of this file passed with the `code` check deleted.
 */
function transportTimeout(kind: 'code-only-string' | 'code-only-numeric' | 'message-only') {
  const err = new Error(
    kind === 'message-only' ? 'Request timeout after 5000ms' : 'RPC daemon.startStack failed: request gave up'
  ) as Error & { code?: unknown };
  if (kind === 'code-only-string') err.code = 'TIMEOUT';
  if (kind === 'code-only-numeric') err.code = 408;
  return err;
}

async function freshStore() {
  vi.resetModules();
  const mod = await import('../../webapp/src/stores/project.store.js');
  return mod.useProjectStore;
}

beforeEach(() => {
  startStack.mockReset();
  stopStack.mockReset();
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
  });
});

describe('startStack', () => {
  it.each(DAEMON_FAILURES)('reports %j to the operator', async (message) => {
    const useProjectStore = await freshStore();
    startStack.mockRejectedValue(new Error(message));

    await useProjectStore.getState().startStack('demo', 'web');

    expect(useProjectStore.getState().error).toBe(message);
  });

  it.each(['code-only-string', 'code-only-numeric', 'message-only'] as const)(
    "stays quiet for the transport's own timeout (%s)",
    async (kind) => {
      const useProjectStore = await freshStore();
      startStack.mockRejectedValue(transportTimeout(kind));

      await useProjectStore.getState().startStack('demo', 'web');

      expect(useProjectStore.getState().error).toBeNull();
    }
  );
});

describe('stopStack', () => {
  it('reports a real failure', async () => {
    const useProjectStore = await freshStore();
    stopStack.mockRejectedValue(new Error('Step timed out after 60000ms'));

    await useProjectStore.getState().stopStack('demo', 'web');

    expect(useProjectStore.getState().error).toBe('Step timed out after 60000ms');
  });

  it("stays quiet for the transport's own timeout", async () => {
    const useProjectStore = await freshStore();
    stopStack.mockRejectedValue(transportTimeout('code-only-string'));

    await useProjectStore.getState().stopStack('demo', 'web');

    expect(useProjectStore.getState().error).toBeNull();
  });
});
