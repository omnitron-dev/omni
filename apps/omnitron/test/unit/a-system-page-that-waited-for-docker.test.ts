/**
 * A system page that waited for Docker.
 *
 * The daemon's system snapshot asked every section together and waited for
 * the slowest, with a 5-second timeout each. On the master (2026-09-23) Docker,
 * asked through systeminformation's socket client, never answered — so every
 * cold snapshot took 5113 ms, the console drew placeholders for five seconds,
 * the Docker card vanished as though there were no Docker, and each snapshot
 * left one more socket open, because a timeout around a promise ends the
 * waiting, not the question. Under a 5-second poll a 3-second cache made
 * nearly every snapshot cold.
 */

import { describe, it, expect } from 'vitest';

import { SystemInfoService, type SectionReaders } from '../../src/services/system-info.service.js';

const logger: any = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child: () => logger };

/** Every section answers at once, with nothing in it. */
const quiet: SectionReaders = {
  os: async () => ({ info: { platform: 'darwin', hostname: 'court' } as never, uptime: 1 }),
  cpu: async () => ({ info: { cores: 10 } as never, load: { currentLoad: 12, cpus: [] } as never, temperature: null }),
  memory: async () => ({ total: 100, available: 40, free: 10, used: 90 } as never),
  disks: async () => [],
  network: async () => ({ interfaces: [], stats: [] }),
  docker: async () => ({ running: 2, paused: 0, stopped: 1 }),
};

/** A Docker that never answers, counting how often it is asked. */
function hungDocker() {
  let asked = 0;
  return {
    asked: () => asked,
    read: () => {
      asked += 1;
      return new Promise<never>(() => undefined);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a system page that waited for Docker', () => {
  it('coalesces fresh requests and distinguishes an unmeasured rate from measured zero', async () => {
    let reads = 0;
    const network: SectionReaders['network'] = async () => ({
      interfaces: ['en0', 'lo'].map(iface => ({ iface, ifaceName: iface, internal: iface === 'lo',
        default: iface === 'en0', ip4: '', ip4subnet: '', ip6: '', ip6subnet: '', mac: '', virtual: false,
        operstate: 'up', type: 'wired', duplex: 'full', mtu: 1500, speed: 1000, dhcp: false,
        dnsSuffix: '', ieee8021xAuth: '', ieee8021xState: '', carrierChanges: 0 })),
      stats: [{ iface: 'en0', rx_sec: ++reads === 1 ? -1 : 0, tx_sec: 0 },
        { iface: 'lo', rx_sec: 50, tx_sec: 100 }].map(rate => ({ operstate: 'up', rx_bytes: 0,
          rx_dropped: 0, rx_errors: 0, tx_bytes: 0, tx_dropped: 0, tx_errors: 0, ms: 1000, ...rate })),
    });
    const service = new SystemInfoService(logger, 'master', { readers: { ...quiet, network }, refreshAfterMs: 0 });
    expect((await service.getSnapshot()).network.rateAvailable).toBe(false);
    const [first,second] = await Promise.all([service.getSnapshot({ fresh: true }),service.getSnapshot({ fresh: true })]);
    expect(first).toBe(second);
    expect(first.network).toMatchObject({ rateAvailable: true, rxSec: 0, txSec: 0 });
    expect(reads).toBe(2);
  });

  it('answers without the section that did not answer, and says why', async () => {
    const docker = hungDocker();
    const service = new SystemInfoService(logger, 'master', { readers: { ...quiet, docker: docker.read }, budgetMs: 100 });

    const started = Date.now();
    const snapshot = await service.getSnapshot();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(snapshot.docker).toBeNull();
    expect(snapshot.unanswered.docker).toMatch(/did not answer within 100 ms/);
    expect(Object.keys(snapshot.unanswered)).toEqual(['docker']);
    expect(snapshot.cpu.cores).toBe(10);
  });

  it('asks a section that has not answered once, not once per snapshot', async () => {
    const docker = hungDocker();
    const service = new SystemInfoService(logger, 'master', {
      readers: { ...quiet, docker: docker.read },
      budgetMs: 50,
      refreshAfterMs: 0,
    });

    await service.getSnapshot();
    for (let i = 0; i < 3; i++) {
      await service.getSnapshot();
      await sleep(80);
    }

    expect(docker.asked()).toBe(1);
    expect((await service.getSnapshot()).unanswered.docker).toMatch(/still out/);
  });

  it('serves the last snapshot at once after the first, and collects the next behind it', async () => {
    const docker = hungDocker();
    const service = new SystemInfoService(logger, 'master', {
      readers: { ...quiet, docker: docker.read },
      budgetMs: 200,
      refreshAfterMs: 0,
    });
    const first = await service.getSnapshot();

    const started = Date.now();
    const served = await service.getSnapshot();
    expect(Date.now() - started, 'no wait for the section budget').toBeLessThan(50);
    expect(served.timestamp).toBe(first.timestamp);

    await sleep(300);
    expect((await service.getSnapshot()).timestamp).toBeGreaterThan(first.timestamp);
  });

  it('names a section that failed, with its own words', async () => {
    const service = new SystemInfoService(logger, 'master', {
      readers: { ...quiet, docker: async () => Promise.reject(new Error('Cannot connect to the Docker daemon')) },
      budgetMs: 100,
    });

    expect((await service.getSnapshot()).unanswered).toEqual({ docker: 'Cannot connect to the Docker daemon' });
  });

  it('reads Docker when it answers', async () => {
    const service = new SystemInfoService(logger, 'master', { readers: quiet, budgetMs: 100 });

    const snapshot = await service.getSnapshot();
    expect(snapshot.docker).toEqual({ running: 2, paused: 0, stopped: 1 });
    expect(snapshot.unanswered).toEqual({});
  });
});
