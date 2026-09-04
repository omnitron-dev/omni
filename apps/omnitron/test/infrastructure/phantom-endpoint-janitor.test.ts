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
 * The janitor scans the managed network's endpoint table and
 * force-disconnects entries whose container is gone.
 *
 * ## The 2026-09-04 incident these tests now guard
 *
 * `disconnect --force` on a LIVE container drops its host port
 * publication until the container is recreated. The original sweep
 * treated any non-zero `docker inspect` exit as "container gone", so a
 * timeout — trivially reachable with a full host disk — read as
 * "phantom". Nine running containers (daos-dev-pg, -redis, -postgres,
 * -minio, -tor, -tiles, -nominatim, both monero) were disconnected in
 * six minutes; the logged container IDs matched the live ones exactly.
 *
 * The earlier version of this file encoded that defect: it scripted
 * `{ ok: false }` with no stderr and asserted a disconnect followed.
 * Absence must now be POSITIVELY established — docker has to say
 * "No such object" — and anything else leaves the endpoint alone.
 *
 * We can't run real docker commands here, so we subclass the janitor
 * and stub `runDocker` with a programmable scripted responder. The
 * contract under test is the BEHAVIOUR of the sweep loop, not the
 * docker CLI integration.
 */

import { describe, it, expect } from 'vitest';
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

  /** Script `docker ps -aq --no-trunc` with the given live container ids. */
  withLiveContainers(ids: string[]): this {
    this.scripted.set('ps -aq --no-trunc', { ok: true, stdout: ids.join('\n') + (ids.length ? '\n' : '') });
    return this;
  }

  /** Script `docker network inspect <net>` with the given endpoint table. */
  withEndpoints(network: string, endpoints: Record<string, string>): this {
    this.scripted.set(`network inspect ${network}`, {
      ok: true,
      stdout: JSON.stringify([
        { Containers: Object.fromEntries(Object.entries(endpoints).map(([id, name]) => [id, { Name: name }])) },
      ]),
    });
    return this;
  }

  disconnectCalls(): string[] {
    return this.commands.filter((c) => c[0] === 'network' && c[1] === 'disconnect').map((c) => c[3]!);
  }
}

describe('PhantomEndpointJanitor — T#75', () => {
  it('disconnects only endpoints whose container docker reports as gone', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger, intervalMs: 60_000 })
      .withEndpoints('managed-net', { 'alive-cid': 'alive-svc', 'dead-cid': 'ghost-svc' })
      .withLiveContainers(['alive-cid']);
    j.scripted.set('inspect --type=container --format {{.Id}} dead-cid', { ok: false, stderr: 'Error: No such object: dead-cid' });
    j.scripted.set('network disconnect managed-net dead-cid --force', { ok: true, stdout: '' });

    const cleaned = await j.sweepAll();

    expect(cleaned).toBe(1);
    expect(j.disconnectCalls()).toEqual(['dead-cid']);
  });

  it('leaves a live container alone without even inspecting it', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'alive-cid': 'alive-svc' })
      .withLiveContainers(['alive-cid']);

    const cleaned = await j.sweepAll();

    expect(cleaned).toBe(0);
    expect(j.disconnectCalls()).toEqual([]);
    // The listing is authoritative for the "exists" case — no per-endpoint call.
    expect(j.commands).toEqual([
      ['network', 'inspect', 'managed-net'],
      ['ps', '-aq', '--no-trunc'],
    ]);
  });

  // --- The incident. ---------------------------------------------------

  it('does NOT disconnect when docker inspect times out (the 2026-09-04 regression)', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'running-cid': 'daos-dev-pg' })
      // Listing came back stale/incomplete — the container is missing from it…
      .withLiveContainers([]);
    // …and the confirming inspect times out rather than answering.
    j.scripted.set('inspect --type=container --format {{.Id}} running-cid', {
      ok: false,
      stderr: '\n[janitor: timeout]',
    });
    j.scripted.set('network disconnect managed-net running-cid --force', { ok: true });

    const cleaned = await j.sweepAll();

    expect(cleaned).toBe(0);
    expect(j.disconnectCalls()).toEqual([]);
  });

  it('does NOT disconnect when the docker CLI cannot be spawned', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'running-cid': 'daos-dev-redis' })
      .withLiveContainers([]);
    j.scripted.set('inspect --type=container --format {{.Id}} running-cid', {
      ok: false,
      stderr: '\n[janitor: spawn error]',
    });

    expect(await j.sweepAll()).toBe(0);
    expect(j.disconnectCalls()).toEqual([]);
  });

  it('does NOT disconnect on an unrecognised docker error', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'running-cid': 'daos-dev-minio' })
      .withLiveContainers([]);
    j.scripted.set('inspect --type=container --format {{.Id}} running-cid', {
      ok: false,
      stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
    });

    expect(await j.sweepAll()).toBe(0);
    expect(j.disconnectCalls()).toEqual([]);
  });

  it('skips the whole sweep when the container listing fails', async () => {
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'cid-a': 'svc-a', 'cid-b': 'svc-b' });
    j.scripted.set('ps -aq --no-trunc', { ok: false, stderr: 'daemon unreachable' });

    expect(await j.sweepAll()).toBe(0);
    expect(j.disconnectCalls()).toEqual([]);
    // No per-endpoint inspect either — nothing is known, nothing is touched.
    expect(j.commands.some((c) => c[0] === 'inspect')).toBe(false);
  });

  it('still cleans a phantom that appeared while the listing was taken', async () => {
    // Endpoint is absent from the listing AND docker confirms it is gone.
    const j = new TestJanitor({ networks: ['managed-net'], logger })
      .withEndpoints('managed-net', { 'ep-stale': 'ghost' })
      .withLiveContainers(['some-other-cid']);
    j.scripted.set('inspect --type=container --format {{.Id}} ep-stale', {
      ok: false,
      stderr: 'Error response from daemon: No such container: ep-stale',
    });
    j.scripted.set('network disconnect managed-net ep-stale --force', { ok: true });

    expect(await j.sweepAll()).toBe(1);
    expect(j.disconnectCalls()).toEqual(['ep-stale']);
  });

  // --- Loop-level behaviour. -------------------------------------------

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
    const j = new TestJanitor({ networks: ['net-a', 'net-b'], logger })
      .withEndpoints('net-a', { 'ph-a': 'ph-a' })
      .withEndpoints('net-b', { 'ph-b': 'ph-b' })
      .withLiveContainers([]);
    j.scripted.set('inspect --type=container --format {{.Id}} ph-a', { ok: false, stderr: 'No such object: ph-a' });
    j.scripted.set('network disconnect net-a ph-a --force', { ok: true });
    j.scripted.set('inspect --type=container --format {{.Id}} ph-b', { ok: false, stderr: 'No such object: ph-b' });
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
    j.withEndpoints('net-a', { ph: 'ph' }).withLiveContainers([]);
    j.scripted.set('inspect --type=container --format {{.Id}} ph', { ok: false, stderr: 'No such object: ph' });
    j.scripted.set('network disconnect net-a ph --force', { ok: true });

    const cleaned = await j.sweepAll();
    expect(cleaned).toBe(1);
    expect(events).toEqual([['net-a', 1]]);
  });
});
