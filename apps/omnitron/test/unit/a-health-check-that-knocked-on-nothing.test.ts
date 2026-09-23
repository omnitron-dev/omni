/**
 * A health check that knocked on nothing it named.
 *
 * `omnitron health-check` on the dev stand, 2026-09-23:
 *
 * - six lines `http:localhost/health — 200 OK`, one per app, the port dropped
 *   from every name — nothing said which app a line was about;
 * - `health-check main` knocked on nothing (the port came only from the
 *   caller, and the CLI sends none): «HEALTHY, 0ms», read from memory;
 * - `health-check nope` answered UNHEALTHY about an app that does not exist;
 * - the infrastructure was four fixed ports while the stack runs ten
 *   containers — a stopped bitcoin left the report HEALTHY, and anything on
 *   5432 passed for postgres;
 * - every report exited 0.
 *
 * These are real sockets: a check that does not connect cannot pass here.
 */

import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HealthCheckService } from '../../src/services/health-check.service.js';

let okServer: http.Server;
let failingServer: http.Server;
let tcpServer: net.Server;
let okPort = 0;
let failingPort = 0;
let tcpPort = 0;
let closedPort = 0;
let knocks = 0;

const listen = (server: http.Server | net.Server) =>
  new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));

beforeAll(async () => {
  okServer = http.createServer((req, res) => {
    knocks += 1;
    res.writeHead(req.url === '/health' ? 200 : 404).end('{"status":"online"}');
  });
  failingServer = http.createServer((_req, res) => res.writeHead(503).end('{"status":"stopping"}'));
  tcpServer = net.createServer((socket) => socket.end());
  okPort = await listen(okServer);
  failingPort = await listen(failingServer);
  tcpPort = await listen(tcpServer);
  // A port nobody listens on: opened, read, closed.
  const probe = net.createServer();
  closedPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
});

afterAll(async () => {
  await Promise.all([okServer, failingServer, tcpServer].map((s) => new Promise((resolve) => s.close(resolve))));
});

type App = { name: string; status: string; pid: number | null; port: number | null };

const orchestratorOf = (apps: App[]) => ({
  list: () => apps,
  getApp: (name: string) => apps.find((a) => a.name === name || a.name.endsWith(`/${name}`)) ?? null,
});

const container = (name: string, service: string, over: Record<string, unknown> = {}) => ({
  name,
  image: 'x',
  service,
  status: 'running',
  health: 'none',
  ...over,
});

const infraOf = (desired: string[], services: Record<string, unknown>, ready = true) => ({
  getState: () => ({ services, ready }),
  getDesiredServices: () => desired.map((name) => ({ name })),
});

const projectsWith = (stacks: Array<{ project: string; stack: string; infra: ReturnType<typeof infraOf> }>) => ({
  getInfraManager: () => ({ listInstances: () => stacks }),
});

const service = (apps: App[], stacks?: Parameters<typeof projectsWith>[0]) =>
  new HealthCheckService(orchestratorOf(apps) as never, stacks ? (projectsWith(stacks) as never) : undefined);

describe('an app is knocked on at its own port, and named for it', () => {
  it('names every check after its app and port', async () => {
    const report = await service([
      { name: 'daos/dev/main', status: 'online', pid: 11, port: okPort },
      { name: 'daos/dev/geo', status: 'online', pid: 12, port: failingPort },
    ]).checkApps();

    const names = report.checks.map((c) => c.name);
    expect(names).toContain(`daos/dev/main HTTP :${okPort}/health`);
    expect(names).toContain(`daos/dev/geo HTTP :${failingPort}/health`);
    expect(new Set(names).size).toBe(names.length);
    // The 503 is not a pass.
    expect(report.checks.find((c) => c.name.startsWith('daos/dev/geo HTTP'))!.status).toBe('fail');
    expect(report.overall).toBe('unhealthy');
  });

  it('knocks for one app with no port from the caller — the app has one', async () => {
    const before = knocks;
    const report = await service([{ name: 'daos/dev/main', status: 'online', pid: 11, port: okPort }]).checkApp('main');

    expect(knocks).toBe(before + 1);
    expect(report.checks.map((c) => c.name)).toEqual(['daos/dev/main process', `daos/dev/main HTTP :${okPort}/health`]);
    expect(report.overall).toBe('healthy');
  });

  it('fails an app whose port refuses, whatever its process table says', async () => {
    const report = await service([{ name: 'daos/dev/main', status: 'online', pid: 11, port: closedPort }]).checkApp('main');

    expect(report.checks[1]).toMatchObject({ status: 'fail', message: 'ECONNREFUSED' });
    expect(report.overall).toBe('unhealthy');
  });

  it('refuses a name this daemon does not run', async () => {
    await expect(service([]).checkApp('nope')).rejects.toThrow(/No app named 'nope'/);
  });

  it('says starting is a look, and errored a failure', async () => {
    const report = await service([
      { name: 'a', status: 'starting', pid: null, port: null },
      { name: 'b', status: 'errored', pid: null, port: null },
    ]).checkApps();

    expect(report.checks.map((c) => `${c.name}=${c.status}`)).toEqual(['a process=warn', 'b process=fail']);
  });
});

describe('the infrastructure is what the stacks run here, not a list of default ports', () => {
  it('checks every declared container and knocks on what each publishes', async () => {
    const infra = infraOf(['daos-dev-postgres', 'daos-dev-bitcoin', 'daos-dev-tor', 'daos-dev-tiles'], {
      'daos-dev-postgres': container('daos-dev-postgres', 'postgres', { ports: { '5432/tcp': tcpPort } }),
      'daos-dev-bitcoin': container('daos-dev-bitcoin', 'bitcoin', { status: 'exited' }),
      'daos-dev-tor': container('daos-dev-tor', 'tor'),
    });

    const report = await service([], [{ project: 'daos', stack: 'dev', infra }]).checkInfrastructure();
    const by = Object.fromEntries(report.checks.map((c) => [c.name, c]));

    expect(by['daos/dev infrastructure']!.status).toBe('pass');
    expect(by[`daos/dev postgres :${tcpPort}`]!.status).toBe('pass');
    expect(by['daos/dev bitcoin']).toMatchObject({ status: 'fail', message: 'daos-dev-bitcoin: exited' });
    expect(by['daos/dev tor']!.status).toBe('pass');
    // Declared and never created: its absence is not its health.
    expect(by['daos/dev daos-dev-tiles']).toMatchObject({ status: 'fail', message: 'daos-dev-tiles: declared, never created' });
    expect(report.overall).toBe('unhealthy');
  });

  it('fails a running container whose published port refuses', async () => {
    const infra = infraOf(['daos-dev-redis'], {
      'daos-dev-redis': container('daos-dev-redis', 'redis', { ports: { '6379/tcp': closedPort } }),
    });

    const report = await service([], [{ project: 'daos', stack: 'dev', infra }]).checkInfrastructure();

    expect(report.checks[1]).toMatchObject({ status: 'fail' });
    expect(report.checks[1]!.message).toContain(`:${closedPort} ECONNREFUSED`);
  });

  it('reads a container detached from its networks, or unhealthy by its own check, as failing', async () => {
    const infra = infraOf(['p-s-a', 'p-s-b'], {
      'p-s-a': container('p-s-a', 'a', { networkAttached: false }),
      'p-s-b': container('p-s-b', 'b', { health: 'unhealthy' }),
    });

    const report = await service([], [{ project: 'p', stack: 's', infra }]).checkInfrastructure();

    expect(report.checks.slice(1).map((c) => c.status)).toEqual(['fail', 'fail']);
  });

  it('checks the daemon\'s own database once, though every stack lists it', async () => {
    const pg = container('omnitron-pg', 'omnitron-pg', { ports: { '5432/tcp': tcpPort } });
    const report = await service(
      [],
      [
        { project: 'daos', stack: 'dev', infra: infraOf([], { 'omnitron-pg': pg }) },
        { project: 'acme', stack: 'dev', infra: infraOf([], { 'omnitron-pg': pg }) },
      ],
    ).checkInfrastructure();

    expect(report.checks.filter((c) => c.name.includes('omnitron-pg'))).toHaveLength(1);
  });

  it('says a stack whose reconciler has not converged is not ready', async () => {
    const report = await service([], [{ project: 'daos', stack: 'dev', infra: infraOf([], {}, false) }]).checkInfrastructure();

    expect(report.checks[0]).toMatchObject({ name: 'daos/dev infrastructure', status: 'fail' });
  });
});

describe('the command says it with its exit code', () => {
  it('exits 1 on an unhealthy report and on a refusal, 0 on a healthy one', async () => {
    const answers: Array<() => Promise<unknown>> = [];
    vi.doMock('../../src/daemon/daemon-client.js', () => ({
      createDaemonClient: () => ({
        service: async () => ({ checkApp: () => answers.shift()!(), checkAll: () => answers.shift()!() }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/commands/daemon-required.js', () => ({ requireDaemon: async () => true }));
    vi.doMock('@xec-sh/kit', () => ({
      box: () => undefined,
      log: { error: () => undefined },
      prism: new Proxy({}, { get: () => (s: string) => s }),
    }));
    const { healthCheckCommand } = await import('../../src/commands/health-check.js');
    const report = (overall: string) => async () => ({ overall, checks: [], timestamp: '', duration: 0 });

    try {
      process.exitCode = 0;
      answers.push(report('healthy'));
      await healthCheckCommand('main');
      expect(process.exitCode).toBe(0);

      answers.push(report('unhealthy'));
      await healthCheckCommand('main');
      expect(process.exitCode).toBe(1);

      process.exitCode = 0;
      answers.push(async () => {
        throw new Error("No app named 'nope' runs on this daemon");
      });
      await healthCheckCommand('nope');
      expect(process.exitCode).toBe(1);

      process.exitCode = 0;
      answers.push(async () => ({ apps: await report('healthy')(), infra: await report('degraded')(), overall: 'degraded' }));
      await healthCheckCommand();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/daemon-required.js');
      vi.doUnmock('@xec-sh/kit');
    }
  });
});
