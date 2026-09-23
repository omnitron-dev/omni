/**
 * A deployment that called a failed daemon healthy.
 *
 * Measured on daos/test, 2026-09-23, the first deployment of bitcoind as a
 * host service: its `systemctl start` failed — `could not start bitcoind: `,
 * no reason — and the node answered `ready: true` with «Infrastructure
 * provisioned and healthy (5 services)», the failure listed beside it in
 * `failed`. The master logged that sentence, `stack start` printed «6/6 apps
 * online» and exited 0, and the audit row said `outcome: ok`.
 *
 * Readiness on the node counted the containers and the host services' plan
 * REFUSALS, not a host service that failed while its plan was carried out;
 * and the master, told «not ready», logged it and went on without carrying it
 * anywhere a reader looks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { provisioningVerdict, type ProvisioningOutcome } from '../../src/infrastructure/provisioning-outcome.js';
import { ProjectService } from '../../src/services/project.service.js';

const containersUp: ProvisioningOutcome = {
  ready: true,
  empty: false,
  running: ['postgres', 'redis', 'minio', 'tor', 'gateway'].map((name) => ({ name, image: 'x', status: 'running', error: undefined })),
  failed: [],
  missing: [],
};

describe('the node\'s verdict counts a host service that failed', () => {
  it('is not ready when a host service failed while it was carried out, and says which and why', () => {
    const v = provisioningVerdict(containersUp, {
      settled: [],
      failed: [{ name: 'bitcoin', status: 'failed', error: 'could not start bitcoind: ' }],
    });
    expect(v.ready).toBe(false);
    // The empty reason is said to be empty, not printed as a dangling colon.
    expect(v.detail).toBe('host services NOT up — bitcoin failed: could not start bitcoind');

    const silent = provisioningVerdict(containersUp, { settled: [], failed: [{ name: 'bitcoin', status: 'failed', error: null }] });
    expect(silent.detail).toContain('no reason given');
  });

  it('keeps the containers\' own complaint beside it', () => {
    const v = provisioningVerdict(
      { ...containersUp, ready: false, failed: [{ name: 'daos-test-redis', image: 'x', status: 'exited', error: undefined }] },
      { settled: [], failed: [{ name: 'bitcoin', status: 'refused', error: 'the chain is on another filesystem' }] },
    );
    expect(v.detail).toMatch(/NOT ready — 1 not running \(daos-test-redis\); host services NOT up — bitcoin refused/);
  });

  it('is ready when everything is up — the control', () => {
    expect(provisioningVerdict(containersUp, { settled: ['bitcoin'], failed: [] })).toEqual({
      ready: true,
      detail: 'Infrastructure provisioned and healthy (5 services)',
    });
  });
});

describe('the master carries «not ready» to the start\'s answer and its row', () => {
  const record = vi.fn(async () => {});
  const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

  function startable(reach: { nodes: number; reached: number; skipped: string[]; notReady: string[] }) {
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record },
      registry: { get: () => null, list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({})),
      resolveStacks: () => ({ test: { type: 'remote', apps: 'all', nodes: [] } }),
      startRemoteStack: vi.fn(async () => reach),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'remote', apps: APPS.map((name) => ({ name, status: 'online' })) }),
      emit: vi.fn(),
    });
    return svc;
  }

  beforeEach(() => vi.clearAllMocks());

  it('writes a partial start, names the node and its words, and answers with them', async () => {
    const svc = startable({
      nodes: 1,
      reached: 1,
      skipped: [],
      notReady: ['37.27.130.185:9700: host services NOT up — bitcoin failed: could not start bitcoind'],
    });

    const info = await svc.startStack('daos', 'test', { source: 'operator' });

    const row = record.mock.calls[0]![0] as any;
    expect(row.outcome).toBe('partial');
    expect(row.details.notUp).toMatch(/^infrastructure on 37\.27\.130\.185:9700: host services NOT up — bitcoin/);
    expect(row.details.notReady).toHaveLength(1);
    expect(info.notUp).toEqual([
      'infrastructure on 37.27.130.185:9700: host services NOT up — bitcoin failed: could not start bitcoind',
    ]);
  });

  it('writes ok and answers without notUp when every node came up — the control', async () => {
    const info = await startable({ nodes: 1, reached: 1, skipped: [], notReady: [] }).startStack('daos', 'test', {
      source: 'operator',
    });

    expect((record.mock.calls[0]![0] as any).outcome).toBe('ok');
    expect(info).not.toHaveProperty('notUp');
  });
});

describe('`stack start` says it and exits non-zero', () => {
  it('prints what is not up beside six apps online, and exits 1', async () => {
    const errors: string[] = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({
        service: async () => ({
          startStack: async () => ({
            name: 'test',
            apps: ['main', 'paysys'].map((name) => ({ name, status: 'online' })),
            infrastructure: { ready: true, services: {} },
            notUp: ['infrastructure on 37.27.130.185:9700: host services NOT up — bitcoin failed: could not start bitcoind'],
          }),
        }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/commands/output.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/commands/output.js')>();
      return {
        ...actual,
        emitJson: () => false,
        emitError: (m: string) => {
          errors.push(m);
          return true;
        },
        emitStep: () => undefined,
        emitSuccess: () => undefined,
        emitInfo: () => undefined,
      };
    });
    const { stackStartCommand } = await import('../../src/commands/stack.js');

    try {
      process.exitCode = 0;
      await stackStartCommand('daos', 'test');
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toMatch(/started with parts not up — infrastructure on 37\.27\.130\.185:9700: .*bitcoin/);
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
    }
  });
});
