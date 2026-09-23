/**
 * HealthCheckService — what answers on this machine, asked now, from outside.
 *
 * `omnitron health` reads what the apps say about themselves (their
 * indicators). This one knocks: is the process up, does its HTTP server
 * answer `/health`, does every container of every stack on this machine run
 * and take a connection on the port it publishes.
 *
 * It printed more than it asked. Measured 2026-09-23 on the dev stand:
 *
 * - six lines `http:localhost/health — 200 OK`, one per app: the checker
 *   named a URL by its hostname, so the port — the only thing telling the
 *   six apart — was not in any of them;
 * - `health-check main` knocked on nothing: the port came only from the
 *   caller and the CLI sends none, so the report was the process table read
 *   from memory — «HEALTHY, 0ms»;
 * - `health-check nope` answered UNHEALTHY about an app that does not exist;
 * - the infrastructure was four fixed ports — 5432, 5480, 6379, 9000 — while
 *   the dev stack runs ten containers: a stopped bitcoin, monero daemon,
 *   wallet, tor, gateway, tiles or nominatim left the report HEALTHY, and
 *   any process at all on 5432 passed for postgres;
 * - `infra-reconciler` was wired to an accessor that answered `null` on
 *   every call, so it never ran;
 * - and every one of those checks existed twice — through `@xec-sh/ops` when
 *   it loaded, and a fallback naming the same checks differently when not.
 *
 * Now one implementation, every check named after its subject, the port
 * taken from the app itself, and the infrastructure read from the stacks
 * this daemon runs rather than from a list of default ports.
 */

import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { ProjectService } from './project.service.js';
import type { ContainerState } from '../infrastructure/types.js';
import { ORCHESTRATOR_TOKEN, PROJECT_SERVICE_TOKEN } from '../shared/tokens.js';
import type { HealthCheckResult, HealthReport, PlatformHealthReport } from '../shared/dto/health.js';

export type { HealthCheckResult, HealthReport, PlatformHealthReport } from '../shared/dto/health.js';

const HTTP_TIMEOUT_MS = 5000;
const TCP_TIMEOUT_MS = 3000;

// =============================================================================
// Probes
// =============================================================================

/** A TCP connection accepted, or the reason it was not. */
export async function probeTcp(host: string, port: number, timeout = TCP_TIMEOUT_MS): Promise<string | null> {
  const net = await import('node:net');
  return new Promise<string | null>((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (why: string | null) => {
      socket.destroy();
      resolve(why);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(null));
    socket.once('timeout', () => done(`no answer in ${timeout}ms`));
    socket.once('error', (err: NodeJS.ErrnoException) => done(err.code ?? err.message));
  });
}

/** The status a URL answered with, or the reason it did not answer. */
export async function probeHttp(url: string, timeout = HTTP_TIMEOUT_MS): Promise<{ status: number } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.body?.cancel();
    return { status: response.status };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return { error: controller.signal.aborted ? `no answer in ${timeout}ms` : (cause ?? (err as Error).message) };
  } finally {
    clearTimeout(timer);
  }
}

function aggregateStatus(checks: HealthCheckResult[]): HealthReport['overall'] {
  if (checks.some((c) => c.status === 'fail')) return 'unhealthy';
  if (checks.some((c) => c.status === 'warn')) return 'degraded';
  return 'healthy';
}

async function timed(name: string, run: () => Promise<Omit<HealthCheckResult, 'name' | 'duration'>>): Promise<HealthCheckResult> {
  const start = Date.now();
  const result = await run();
  return { name, ...result, duration: Date.now() - start };
}

/** Where a status passes, merely needs a look, or fails. */
const PROCESS_WARN = new Set(['starting', 'stopping', 'restarting']);

// =============================================================================
// Service
// =============================================================================

@Injectable()
export class HealthCheckService {
  constructor(
    @Inject(ORCHESTRATOR_TOKEN) private readonly orchestrator: OrchestratorService,
    // The stacks' containers are the project service's; optional as they are
    // for the backup service, so a daemon without one still checks its apps.
    @Optional() @Inject(PROJECT_SERVICE_TOKEN) private readonly projects?: Pick<ProjectService, 'getInfraManager'>,
  ) {}

  /**
   * One app: its process, and its HTTP server when it has a port.
   *
   * A name this daemon does not run is refused — it used to come back as an
   * UNHEALTHY app, which is a claim about something that does not exist.
   */
  async checkApp(appName: string, port?: number | null): Promise<HealthReport> {
    const start = Date.now();
    const info = this.orchestrator.getApp(appName);
    if (!info) {
      throw new Error(`No app named '${appName}' runs on this daemon — \`omnitron list\` shows what does`);
    }
    const checks = await this.appChecks(info.name, info.status, info.pid, port ?? info.port ?? null);
    return { overall: aggregateStatus(checks), checks, timestamp: new Date().toISOString(), duration: Date.now() - start };
  }

  /** Every app this daemon runs. */
  async checkApps(): Promise<HealthReport> {
    const start = Date.now();
    const checks = (
      await Promise.all(this.orchestrator.list().map((a) => this.appChecks(a.name, a.status, a.pid, a.port ?? null)))
    ).flat();
    return { overall: aggregateStatus(checks), checks, timestamp: new Date().toISOString(), duration: Date.now() - start };
  }

  /**
   * Every container of every stack whose infrastructure this daemon runs:
   * what docker last said about it, and a connection to each port it
   * publishes, made now.
   */
  async checkInfrastructure(): Promise<HealthReport> {
    const start = Date.now();
    const stacks = this.projects?.getInfraManager().listInstances() ?? [];
    const seen = new Set<string>();
    const pending: Array<Promise<HealthCheckResult>> = [];

    for (const { project, stack, infra } of stacks) {
      const state = infra.getState();
      pending.push(
        timed(`${project}/${stack} infrastructure`, async () =>
          state.ready ? { status: 'pass', message: 'ready' } : { status: 'fail', message: 'not ready — its reconciler has not converged' },
        ),
      );
      // What was declared, not only what exists: a container never created
      // leaves no entry in the state, and its absence is not its health.
      const declared = infra.getDesiredServices().map((d) => d.name);
      const names = [...new Set([...declared, ...Object.keys(state.services)])];
      for (const container of names) {
        // The daemon's own database sits in every stack's state.
        if (seen.has(container)) continue;
        seen.add(container);
        pending.push(this.containerCheck(project, stack, container, state.services[container]));
      }
    }

    const checks = await Promise.all(pending);
    return { overall: aggregateStatus(checks), checks, timestamp: new Date().toISOString(), duration: Date.now() - start };
  }

  /** Both, at once. */
  async checkAll(): Promise<PlatformHealthReport> {
    const [apps, infra] = await Promise.all([this.checkApps(), this.checkInfrastructure()]);
    const overall: PlatformHealthReport['overall'] =
      apps.overall === 'unhealthy' || infra.overall === 'unhealthy'
        ? 'unhealthy'
        : apps.overall === 'degraded' || infra.overall === 'degraded'
          ? 'degraded'
          : 'healthy';
    return { apps, infra, overall, timestamp: new Date().toISOString() };
  }

  // ---------------------------------------------------------------------------

  private appChecks(name: string, status: string, pid: number | null, port: number | null): Promise<HealthCheckResult[]> {
    const checks: Array<Promise<HealthCheckResult>> = [
      timed(`${name} process`, async () =>
        status === 'online'
          ? { status: 'pass', message: `online, pid ${pid}` }
          : { status: PROCESS_WARN.has(status) ? 'warn' : 'fail', message: status },
      ),
    ];
    if (port) {
      // titan answers `/health` with 200 while its HTTP server is online and
      // 503 otherwise: this is the server taking a request, not the app's
      // own verdict on itself — that is `omnitron health`.
      checks.push(
        timed(`${name} HTTP :${port}/health`, async () => {
          const answer = await probeHttp(`http://localhost:${port}/health`);
          if ('error' in answer) return { status: 'fail', message: answer.error };
          if (answer.status === 200) return { status: 'pass', message: '200 — its HTTP server takes requests' };
          return { status: answer.status >= 500 ? 'fail' : 'warn', message: `HTTP ${answer.status}` };
        }),
      );
    }
    return Promise.all(checks);
  }

  private containerCheck(
    project: string,
    stack: string,
    container: string,
    state: ContainerState | undefined,
  ): Promise<HealthCheckResult> {
    const service = state?.service ?? container;
    const ports = Object.values(state?.ports ?? {});
    const name = `${project}/${stack} ${service}${ports.length > 0 ? ` :${ports.join(',')}` : ''}`;
    return timed(name, async () => {
      if (!state) return { status: 'fail', message: `${container}: declared, never created` };
      if (state.status !== 'running') {
        return { status: 'fail', message: `${container}: ${state.status}${state.error ? ` — ${state.error}` : ''}` };
      }
      if (state.networkAttached === false) {
        return { status: 'fail', message: `${container}: running, detached from every network` };
      }
      const refused = (await Promise.all(ports.map(async (p) => ({ p, why: await probeTcp('127.0.0.1', p) })))).filter(
        (r) => r.why !== null,
      );
      if (refused.length > 0) {
        return {
          status: 'fail',
          message: `${container}: running, but ${refused.map((r) => `:${r.p} ${r.why}`).join(', ')}`,
        };
      }
      if (state.health === 'unhealthy') return { status: 'fail', message: `${container}: its own healthcheck fails` };
      if (state.health === 'starting') return { status: 'warn', message: `${container}: its healthcheck is still starting` };
      return {
        status: 'pass',
        message: `${container}: running${ports.length > 0 ? ', accepts connections' : ', publishes no port'}`,
      };
    });
  }
}
