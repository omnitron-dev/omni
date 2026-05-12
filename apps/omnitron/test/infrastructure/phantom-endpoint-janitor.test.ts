/**
 * Regression tests for T#75 — phantom-endpoint janitor.
 *
 * Docker networks accumulate "phantom endpoint" records when a
 * container is force-removed mid-network-disconnect or when
 * dockerd restarts with stale state. The visible symptom is a
 * recreation failure:
 *
 *     Error response from daemon: endpoint with name X
 *     already exists in network managed-net
 *
 * The janitor periodically scans the managed network's endpoint
 * table, looks each entry up as a container, and force-
 * disconnects any whose container has vanished.
 *
 * We can't run real docker commands here, so we subclass the
 * janitor and stub `runDocker` with a programmable scripted
 * responder. The contract under test is the BEHAVIOUR of the
 * sweep loop, not the docker CLI integration.
 */

import { describe, it, expect, vi } from 'vitest';
import { PhantomEndpointJanitor } from '../../src/infrastructure/phantom-endpoint-janitor.js';

const logger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => logger,
};

class TestJanitor extends PhantomEndpointJanitor {
  public commands: string[][] = [];
  public scripted = new Map<string, { ok: boolean; stdout?: string; stderr?: string }>();

  protected override runDocker(args: string[]) {
    this.commands.push(args);
    const key = args.join(' ');
    const r = this.scripted.get(key) ?? { ok: false, stdout: '', stderr: 'no script' };
    return Promise.resolve({ ok: r.ok, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  }
}

describe('PhantomEndpointJanitor — T#75', () => {
  it('disconnects only endpoints whose container has vanished', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger, intervalMs: 60_000 });
    // Network has TWO endpoints: alive-cid (container exists) and
    // dead-cid (container is gone).
    j.scripted.set('network inspect managed-net', {
      ok: true,
      stdout: JSON.stringify([
        {
          Containers: {
            'alive-cid': { Name: 'alive-svc' },
            'dead-cid': { Name: 'ghost-svc' },
          },
        },
      ]),
    });
    j.scripted.set('inspect --type=container --format {{.Id}} alive-cid', { ok: true, stdout: 'alive-cid\n' });
    j.scripted.set('inspect --type=container --format {{.Id}} dead-cid', { ok: false, stderr: 'No such object' });
    j.scripted.set('network disconnect managed-net dead-cid --force', { ok: true, stdout: '' });

    const cleaned = await j.sweepAll();

    expect(cleaned).toBe(1);
    // The alive container was inspected and left alone — NO disconnect for it.
    expect(j.commands).not.toContainEqual(['network', 'disconnect', 'managed-net', 'alive-cid', '--force']);
    // The dead one WAS disconnected.
    expect(j.commands).toContainEqual(['network', 'disconnect', 'managed-net', 'dead-cid', '--force']);
  });

  it('returns 0 cleaned when the network does not exist', async () => {
    const j = new TestJanitor({ networks: ['missing-net'], logger });
    j.scripted.set('network inspect missing-net', { ok: false, stderr: 'No such network' });
    const cleaned = await j.sweepAll();
    expect(cleaned).toBe(0);
  });

  it("doesn't reach into per-container inspect when the network has no endpoints", async () => {
    const j = new TestJanitor({ networks: ['empty-net'], logger });
    j.scripted.set('network inspect empty-net', { ok: true, stdout: JSON.stringify([{ Containers: {} }]) });
    const cleaned = await j.sweepAll();
    expect(cleaned).toBe(0);
    expect(j.commands).toEqual([['network', 'inspect', 'empty-net']]);
  });

  it('coalesces concurrent sweepAll() calls — second is a no-op', async () => {
    const j = new TestJanitor({ networks: ['net-a'], logger });
    let resolveFirst!: () => void;
    // Stall the first runDocker so a second sweep can arrive
    // mid-flight. The second must early-return without issuing its
    // own commands.
    j['runDocker'] = function (args: string[]) {
      this.commands.push(args);
      return new Promise((r) => {
        resolveFirst = () => r({ ok: true, stdout: JSON.stringify([{ Containers: {} }]), stderr: '' });
      });
    } as any;

    const a = j.sweepAll();
    const b = j.sweepAll();
    // Second sweep observed the in-flight guard and returned 0 immediately.
    await new Promise((r) => setImmediate(r));
    expect(await b).toBe(0);
    resolveFirst();
    await a;
  });

  it('per-network errors do not stop the sweep across remaining networks', async () => {
    const j = new TestJanitor({ networks: ['net-a', 'net-b'], logger });
    // net-a's inspect succeeds with one phantom; the disconnect
    // call we'll let succeed.
    j.scripted.set('network inspect net-a', {
      ok: true,
      stdout: JSON.stringify([{ Containers: { 'ph-a': { Name: 'ph-a' } } }]),
    });
    j.scripted.set('inspect --type=container --format {{.Id}} ph-a', { ok: false });
    j.scripted.set('network disconnect net-a ph-a --force', { ok: true });
    // net-b's inspect succeeds with one phantom too.
    j.scripted.set('network inspect net-b', {
      ok: true,
      stdout: JSON.stringify([{ Containers: { 'ph-b': { Name: 'ph-b' } } }]),
    });
    j.scripted.set('inspect --type=container --format {{.Id}} ph-b', { ok: false });
    j.scripted.set('network disconnect net-b ph-b --force', { ok: true });

    const cleaned = await j.sweepAll();
    expect(cleaned).toBe(2);
  });

  it('fires onCleanup per network', async () => {
    const events: Array<[string, number]> = [];
    const j = new TestJanitor({
      networks: ['net-a'],
      logger,
      onCleanup: (net, n) => events.push([net, n]),
    });
    j.scripted.set('network inspect net-a', {
      ok: true,
      stdout: JSON.stringify([{ Containers: { 'ph': { Name: 'ph' } } }]),
    });
    j.scripted.set('inspect --type=container --format {{.Id}} ph', { ok: false });
    j.scripted.set('network disconnect net-a ph --force', { ok: true });

    const cleaned = await j.sweepAll();
    expect(cleaned).toBe(1);
    expect(events).toEqual([['net-a', 1]]);
  });
});
