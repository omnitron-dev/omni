/**
 * `strategy: 'weighted'` weights.
 *
 * It did not: `selectWeighted` ignored the weights and called
 * `selectRandom`, with a note to that effect inside the private method. The
 * note is invisible from where the decision is made — `LoadBalancingStrategy`
 * offers `'weighted'` as a first-class choice, `BackendConfig.weight`
 * documents "higher = more traffic", and the client's own header advertises
 * weighted load balancing. An operator sizing traffic 90/10 to match backend
 * capacity got 50/50.
 *
 * Distribution is asserted by controlling `Math.random`, not by sampling: a
 * statistical test of a random selector is exactly the kind that fails on a
 * loaded machine for no reason.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ServiceRouter } from '../../../src/netron/multi-backend/service-router.js';
import type { BackendStatus } from '../../../src/netron/multi-backend/types.js';

function backend(id: string, weight?: number): BackendStatus {
  return {
    id,
    url: `http://${id}`,
    health: 'healthy',
    state: 'connected',
    activeConnections: 0,
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    weight,
  } as BackendStatus;
}

// `defaultStrategy`, not `loadBalancing`: the strategy consulted is
// `route.strategy || config.defaultStrategy || 'round-robin'`. My first version
// of this test configured a field the router never reads — the same class of
// mistake the test exists to catch, and it presented as the implementation
// being wrong.
const router = () => new ServiceRouter({ routes: [], defaultStrategy: 'weighted' });

afterEach(() => vi.restoreAllMocks());

describe('weighted backend selection', () => {
  it('gives each backend a share of the range proportional to its weight', () => {
    const backends = [backend('big', 9), backend('small', 1)];
    const r = router();

    // Total weight 10. The first 90% of the range must land on `big`.
    for (const [roll, expected] of [
      [0, 'big'],
      [0.5, 'big'],
      [0.89, 'big'],
      [0.9, 'small'],
      [0.99, 'small'],
    ] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      expect(r.selectBackend('svc', backends)?.backendId, `roll ${roll}`).toBe(expected);
    }
  });

  it('treats a missing weight as 1', () => {
    const backends = [backend('a'), backend('b', 3)];
    const r = router();

    // Total 4: a owns [0, 0.25), b owns the rest.
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    expect(r.selectBackend('svc', backends)?.backendId).toBe('a');
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    expect(r.selectBackend('svc', backends)?.backendId).toBe('b');
  });

  it('honours an explicit zero as "drained", not as "unspecified"', () => {
    // `weight: 0` is a deliberate drain; treating it like an absent weight
    // would send traffic to a backend someone took out of rotation.
    const backends = [backend('drained', 0), backend('live', 5)];
    const r = router();
    for (const roll of [0, 0.5, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      expect(r.selectBackend('svc', backends)?.backendId, `roll ${roll}`).toBe('live');
    }
  });

  it('falls back to uniform choice when no weight is positive', () => {
    // All drained: the caller still asked for a backend, so answer rather than
    // refuse — refusing here would turn a routing preference into an outage.
    const backends = [backend('a', 0), backend('b', -5)];
    const r = router();

    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const chosen = r.selectBackend('svc', backends)?.backendId;
    expect(['a', 'b']).toContain(chosen);
  });

  it('returns null for an empty candidate list', () => {
    expect(router().selectBackend('svc', [])).toBeNull();
  });
});
