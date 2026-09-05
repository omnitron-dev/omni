/**
 * The checks that look underneath an app's status.
 *
 * `omnitron list` reports one status per app, taken from its main process.
 * Everything that goes wrong with the app's other processes is invisible
 * there, and that invisibility is not hypothetical: two pool workers spent a
 * whole session being killed and respawned every thirty seconds while their
 * apps read `online` the entire time, and a pool declared with two workers
 * ran eight without a word.
 *
 * These are the checks that would have said so. The live stack is healthy —
 * which is why they are exercised here, where the unhealthy shapes can
 * actually be constructed.
 */

import { describe, it, expect } from 'vitest';

import net from 'node:net';

import { Findings, checkAppInternals, checkPorts } from '../../src/commands/doctor.js';
import type { ProcessInfoDto, SubProcessInfoDto } from '../../src/config/types.js';

function sub(over: Partial<SubProcessInfoDto> = {}): SubProcessInfoDto {
  return {
    name: 'http',
    type: 'server',
    pid: 200,
    status: 'online',
    cpu: 1,
    memory: 1,
    uptime: 1,
    restarts: 0,
    instances: 1,
    declaredInstances: 1,
    ...over,
  };
}

function app(over: Partial<ProcessInfoDto> = {}): ProcessInfoDto {
  return {
    name: 'daos/dev/main',
    pid: 100,
    status: 'online',
    cpu: 1,
    memory: 1,
    uptime: 1,
    restarts: 0,
    instances: 1,
    port: 3001,
    mode: 'bootstrap',
    critical: false,
    processes: [sub()],
    ...over,
  };
}

/** Run the check and return the findings it produced. */
async function run(apps: ProcessInfoDto[]) {
  const findings = new Findings();
  await checkAppInternals(findings, apps);
  return findings.all();
}

describe('checkAppInternals', () => {
  it('says nothing about a healthy app', async () => {
    expect(await run([app()])).toEqual([]);
  });

  it('reports a sub-process whose pid the OS no longer knows', async () => {
    const [finding, ...rest] = await run([
      app({ processes: [sub(), sub({ name: 'automation-worker', type: 'custom', status: 'crashed', pid: 4711 })] }),
    ]);

    expect(rest).toEqual([]);
    expect(finding!.id).toBe('app.subprocess-crashed');
    // An error, not a warning: the app claims to be online, so nothing else
    // in the system is going to raise this.
    expect(finding!.severity).toBe('error');
    expect(finding!.title).toContain('automation-worker');
    expect(finding!.evidence.join(' ')).toContain('4711');
    expect(finding!.remedy).toBeTruthy();
  });

  it('reports a declared sub-process that never started', async () => {
    // `uptime` matters here and the fixture default (1ms) is not it. An app
    // that came online a millisecond ago is still bringing its topology up,
    // and that is a different finding — see the next test. This one is an
    // app that has been online for five minutes with a process that never
    // arrived.
    const [finding] = await run([
      app({
        uptime: 5 * 60_000,
        processes: [sub({ name: 'collector', type: 'custom', status: 'stopped', pid: null })],
      }),
    ]);

    expect(finding!.id).toBe('app.subprocess-stopped');
    expect(finding!.severity).toBe('warning');
    expect(finding!.title).toContain('collector');
    expect(finding!.title).toContain('not running');
  });

  it('does not call a sub-process missing while the app is still starting up', async () => {
    // An app reports `online` from its main process; the topology processes
    // come up alongside it. Reporting that window as a fault puts a warning
    // on every restart, and a warning that appears every restart is one
    // nobody reads.
    const [finding] = await run([
      app({
        uptime: 2_000,
        processes: [sub({ name: 'collector', type: 'custom', status: 'stopped', pid: null })],
      }),
    ]);

    expect(finding!.id).toBe('app.subprocess-stopped');
    expect(finding!.severity).toBe('info');
    expect(finding!.title).toContain('has not started yet');
    // Still says how long, so a reader can judge rather than trust.
    expect(finding!.evidence.join(' ')).toContain('2s');
  });

  it('reports a pool that has grown past its declaration', async () => {
    // The defect this check exists for. A pool with more workers than asked
    // for reports itself perfectly healthy — it does have workers — so
    // nothing else in the system will mention it.
    const [finding] = await run([
      app({ processes: [sub({ name: 'transform', type: 'worker', instances: 8, declaredInstances: 2 })] }),
    ]);

    expect(finding!.id).toBe('pool.oversized');
    expect(finding!.title).toContain('8');
    expect(finding!.title).toContain('2');
    expect(finding!.evidence).toEqual(['declared instances: 2', 'live workers: 8']);
    expect(finding!.remedy).toContain('scaling.strategy');
  });

  it('reports a pool running short of its declaration', async () => {
    const [finding] = await run([
      app({ processes: [sub({ name: 'transform', type: 'worker', instances: 1, declaredInstances: 4 })] }),
    ]);

    expect(finding!.id).toBe('pool.undersized');
    expect(finding!.severity).toBe('warning');
  });

  it('leaves a pool at its declared size alone', async () => {
    expect(
      await run([app({ processes: [sub({ name: 'transform', type: 'worker', instances: 2, declaredInstances: 2 })] })])
    ).toEqual([]);
  });

  it('looks only at apps that claim to be online', async () => {
    // An app that is stopped or errored is reported by `checkApps` with its
    // exit code and stderr. Repeating it here would bury that.
    const stopped = app({ status: 'stopped', processes: [sub({ status: 'stopped', pid: null })] });
    expect(await run([stopped])).toEqual([]);
  });

  it('spans every app, not just the first with a fault', async () => {
    const findings = await run([
      app({ name: 'a', processes: [sub({ name: 'w', status: 'crashed' })] }),
      app({ name: 'b', processes: [sub({ name: 'w', type: 'worker', instances: 5, declaredInstances: 2 })] }),
    ]);

    expect(findings.map((f) => f.id)).toEqual(['app.subprocess-crashed', 'pool.oversized']);
  });

  it('does not trip over an app with no declared topology', async () => {
    const bare = app();
    delete (bare as { processes?: unknown }).processes;
    expect(await run([bare])).toEqual([]);
  });
});

describe('checkPorts', () => {
  /** A real listener on an ephemeral port, and its number. */
  async function listener(): Promise<{ port: number; close: () => Promise<void> }> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('no port');
    return {
      port: address.port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  async function run(apps: ProcessInfoDto[]) {
    const findings = new Findings();
    await checkPorts(findings, apps);
    return findings.all();
  }

  it('says nothing when the port actually accepts connections', async () => {
    const server = await listener();
    try {
      expect(await run([app({ port: server.port })])).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('reports an online app whose port refuses connections', async () => {
    // The port is real and was listening a moment ago, so the number in the
    // DTO is not obviously wrong — which is exactly the case an operator
    // cannot distinguish from the outside.
    const server = await listener();
    const { port } = server;
    await server.close();

    const [finding, ...rest] = await run([app({ port })]);

    expect(rest).toEqual([]);
    expect(finding!.id).toBe('app.port-unreachable');
    expect(finding!.severity).toBe('error');
    expect(finding!.title).toContain(String(port));
    expect(finding!.evidence.join(' ')).toContain(`127.0.0.1:${port}`);
  });

  it('ignores an app that declares no port', async () => {
    expect(await run([app({ port: null })])).toEqual([]);
  });

  it('ignores an app that is not online', async () => {
    const server = await listener();
    const { port } = server;
    await server.close();

    expect(await run([app({ status: 'stopped', port })])).toEqual([]);
  });
});
