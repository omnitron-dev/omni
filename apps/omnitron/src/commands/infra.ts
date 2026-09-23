/**
 * Infrastructure CLI Commands
 *
 * Manages Docker containers for platform services (PostgreSQL, Redis, MinIO, etc.)
 * These commands replace the old `infra/dev.sh` shell script.
 *
 * Usage:
 *   omnitron infra up         — Provision all infrastructure
 *   omnitron infra down       — Stop containers
 *   omnitron infra status     — Show container health
 *   omnitron infra logs redis — View Redis logs
 *   omnitron infra psql main  — Open psql to 'main' database
 *   omnitron infra redis-cli  — Open redis-cli
 *   omnitron infra migrate    — Run all app migrations
 *   omnitron infra reset      — DESTRUCTIVE: wipe volumes, recreate
 */

import os from 'node:os';
import { log, table, prism } from '@xec-sh/kit';
import { loadEcosystemConfig } from '../config/loader.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { emitError, emitJson } from './output.js';
import type { IStackInfo } from '../shared/dto/project.js';
import { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { ContainerState } from '../infrastructure/types.js';
import { summariseProvisioning } from '../infrastructure/provisioning-outcome.js';
import { probeFields, type ProbeReading } from '../infrastructure/host-inspection.js';
import {
  listManagedContainers,
  getContainerLogs,
  isDockerAvailable,
  stopContainer,
  removeContainer,
} from '../infrastructure/container-runtime.js';

// Simple logger adapter for InfrastructureService
const cliLogger = {
  info: (obj: any, msg?: string) => log.info(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
  warn: (obj: any, msg?: string) => log.warn(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
  error: (obj: any, msg?: string) => log.error(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
  debug: () => {},
  fatal: (obj: any, msg?: string) => log.error(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
  trace: () => {},
  child: () => cliLogger,
} as any;

export async function infraUpCommand(): Promise<void> {
  if (!(await isDockerAvailable())) {
    log.error('Docker is not available. Install: https://docs.docker.com/get-docker/');
    return;
  }

  const config = await loadEcosystemConfig();
  if (!config.infrastructure) {
    log.warn('No infrastructure section in omnitron.config.ts');
    return;
  }

  const infra = new InfrastructureService(cliLogger, config.infrastructure);
  const state = await infra.provision();

  // The heading asserted the outcome before looking at it.
  //
  // `Infrastructure ready:` was printed unconditionally, and then whatever
  // `state.services` held was listed beneath it. An empty object printed the
  // heading and nothing else — and a list of problems that is empty because
  // nothing was examined looks exactly like one that is empty because there
  // are none. Observed three times in one shift, while the two containers
  // the stack needs were absent from `docker ps -a` altogether.
  const outcome = summariseProvisioning(infra.getDesiredServices(), state.services);

  log.info(`\n${outcome.ready ? 'Infrastructure ready:' : 'Infrastructure is NOT ready:'}`);

  for (const svc of outcome.running) {
    log.info(`  ${prism.green('✓')} ${svc.name} (${svc.image ?? 'unknown image'})`);
  }
  for (const svc of outcome.failed) {
    log.info(`  ${prism.red('✗')} ${svc.name} (${svc.image ?? 'unknown image'}) — ${svc.status}${svc.error ? `: ${svc.error}` : ''}`);
  }
  for (const svc of outcome.missing) {
    // Named as absent rather than omitted. This is the state that cost an
    // afternoon: a container that is not there produces no row, no error and
    // no complaint, so the reader concludes the problem is theirs.
    log.info(`  ${prism.red('✗')} ${svc.name} — MISSING, nothing was provisioned for it`);
  }

  if (outcome.empty) {
    log.warn('Nothing is declared in this config, so nothing was provisioned. Check that you are in the right project directory.');
  }

  const restarted = infra.getRestartedServices();
  if (restarted.length > 0) {
    // A new container is a new socket. Applications already running hold
    // pools pointing at the old one and go on answering `/health` 200 —
    // that probe asks titan whether the process is alive, not whether its
    // database is — while every request they serve fails with "Connection
    // terminated unexpectedly". Nothing else in the system says this.
    log.warn(
      `Restarted: ${restarted.join(', ')}. Applications already connected to these are holding dead pools — ` +
        'restart them (`omnitron restart <app>`), or they will keep reporting healthy and failing every request.',
    );
  }

  if (!outcome.ready) {
    process.exitCode = 1;
  }
}

export async function infraDownCommand(opts?: { volumes?: boolean }): Promise<void> {
  const containers = await listManagedContainers();
  if (containers.length === 0) {
    log.info('No Omnitron-managed containers running.');
    return;
  }

  for (const c of containers) {
    log.info(`Stopping ${c.name}...`);
    try { await stopContainer(c.name, 10); } catch { /* already stopped */ }
    await removeContainer(c.name);
  }

  if (opts?.volumes) {
    log.warn('Volume removal not yet implemented — use `docker volume prune` manually.');
  }

  log.info(`Stopped ${containers.length} container(s).`);
}

/** `project/stack` as a container's labels say, or `-` when it carries none. */
function stackLabel(c: ContainerState): string {
  return c.project && c.stack ? `${c.project}/${c.stack}` : '-';
}

/**
 * `--stack <project>/<stack>`, split — or the reason it cannot be.
 */
function parseStack(value: string): { project: string; stack: string } | string {
  const [project, stack, ...rest] = value.split('/');
  if (!project || !stack || rest.length > 0) return `--stack takes <project>/<stack>, e.g. daos/test — got '${value}'`;
  return { project, stack };
}

/**
 * Ask the daemon about a stack this machine holds no containers of.
 *
 * The same read `omnitron stack status` makes: for a remote stack,
 * `getStack` asks the node itself for its containers (`remoteInfraStatus`
 * in the project service, over the master's mesh). A string is the reason
 * the daemon could not answer.
 */
async function askStack(project: string, stack: string): Promise<IStackInfo | string> {
  const client = createDaemonClient();
  try {
    if (!(await client.isReachable())) return 'the daemon did not answer, so where the stack runs is unknown';
    const projects = await client.service<import('../shared/dto/services.js').IProjectRpcService>('OmnitronProject');
    return await projects.getStack({ project, stack });
  } catch (err) {
    return (err as Error).message;
  } finally {
    await client.disconnect();
  }
}

/**
 * `omnitron infra status [--stack <project>/<stack>]`.
 *
 * What `listManagedContainers` returns is THIS machine's containers, and the
 * table said so nowhere: measured 2026-09-23 on the master, twelve
 * `daos-dev-*` / `omnitron-*` rows with no host and no stack column, and the
 * six containers of the test stack — on 37.27.130.185 — invisible, with
 * nothing to say they exist. Now the header names the machine, each row its
 * stack, and `--stack` reaches a remote stack's containers the way `stack
 * status` does: by asking its node.
 */
export async function infraStatusCommand(opts: { stack?: string } = {}): Promise<void> {
  const containers = await listManagedContainers();
  const machine = os.hostname();

  if (opts.stack) {
    const wanted = parseStack(opts.stack);
    if (typeof wanted === 'string') {
      log.error(wanted);
      process.exitCode = 1;
      return;
    }
    const here = containers.filter((c) => c.project === wanted.project && c.stack === wanted.stack);
    if (here.length > 0) {
      log.info(prism.bold(`Containers of ${opts.stack} on this machine (${machine})`));
      printContainers(here);
      return;
    }

    const info = await askStack(wanted.project, wanted.stack);
    if (typeof info === 'string') {
      log.error(`No containers of ${opts.stack} on this machine (${machine}), and ${info}.`);
      process.exitCode = 1;
      return;
    }
    if (info.type === 'local') {
      log.error(`No containers of ${opts.stack} on this machine (${machine}) — the stack is local and has none running.`);
      process.exitCode = 1;
      return;
    }
    const hosts = info.nodes.map((n) => n.host).join(', ') || 'its node';
    const services = Object.entries(info.infrastructure.services);
    if (services.length === 0) {
      log.warn(
        `${opts.stack} runs on ${hosts}, and no infrastructure was reported for it — the node may not have answered. ` +
          `\`omnitron stack status ${wanted.project} ${wanted.stack}\` shows what the master knows.`,
      );
      process.exitCode = 1;
      return;
    }
    log.info(prism.bold(`Containers of ${opts.stack} on ${hosts} — asked of the node through the daemon`));
    table({
      width: 'auto',
      data: services.map(([name, svc]) => ({
        service: name,
        container: svc.containerName,
        status: colourStatus(svc.status),
        port: svc.port ?? '-',
      })),
      columns: [
        { key: 'service', header: 'Service' },
        { key: 'container', header: 'Container' },
        { key: 'status', header: 'Status' },
        { key: 'port', header: 'Port' },
      ],
    });
    return;
  }

  if (containers.length === 0) {
    log.info(`No Omnitron-managed containers on this machine (${machine}).`);
    log.info('Run: omnitron infra up');
    return;
  }

  log.info(prism.bold(`Containers on this machine (${machine})`));
  printContainers(containers);
  log.info(prism.dim('A remote stack\'s containers run on its node: omnitron infra status --stack <project>/<stack>'));
}

/**
 * `omnitron infra inspect <project>/<stack>` — what each node of a remote
 * stack would find and do on its host for the services the stack declares,
 * read and never changed (`host-inspection.ts`).
 *
 * `--unit`, `--path`, `--snap` and `--config <file>:<key>,<key>` add host
 * facts for a decision the declaration does not cover — a unit a person
 * wrote, a chain directory to adopt. No file's content is printed, and a
 * config key naming a credential is refused.
 */
export async function infraInspectCommand(
  target: string,
  opts: { unit?: string[]; path?: string[]; snap?: string[]; config?: string[] } = {},
): Promise<void> {
  const wanted = parseStack(target);
  if (typeof wanted === 'string') {
    emitError(wanted.replace('--stack takes', 'Takes'));
    process.exitCode = 1;
    return;
  }
  const configKeys = (opts.config ?? []).map((spec) => {
    const at = spec.lastIndexOf(':');
    return { path: spec.slice(0, at), keys: spec.slice(at + 1).split(',').filter(Boolean) };
  });

  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const projects = await client.service<import('../shared/dto/services.js').IProjectRpcService>('OmnitronProject');
    const readings = await projects.inspectStackHost({
      ...wanted,
      ...(opts.unit?.length ? { units: opts.unit } : {}),
      ...(opts.path?.length ? { paths: opts.path } : {}),
      ...(opts.snap?.length ? { snaps: opts.snap } : {}),
      ...(configKeys.length ? { configKeys } : {}),
    });
    if (emitJson({ stack: target, nodes: readings })) return;
    for (const reading of readings) printInspection(target, reading);
    if (readings.some((r) => r.error)) process.exitCode = 1;
  } catch (err) {
    emitError(`Could not inspect ${target}: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

const bytes = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : n >= 1e12 ? `${(n / 1e12).toFixed(2)} TB` : `${(n / 1e9).toFixed(1)} GB`;
const yes = (flag: boolean) => (flag ? prism.green('yes') : prism.red('no'));

/** A probe's answer on one line: the fields its declaration reads it by, and how many more `--json` has. */
function formatProbe(reading: ProbeReading): string {
  const { fields, more } = probeFields(reading);
  const line = fields.map(([name, value]) => `${name}=${value ?? '—'}`).join(' ');
  return more > 0 ? `${line} ${prism.dim(`+${more} in --json`)}` : line;
}

function printInspection(
  target: string,
  reading: { node: string; inspection?: import('../infrastructure/host-inspection.js').HostInspection; error?: string },
): void {
  if (!reading.inspection) {
    log.error(`${target} on ${reading.node}: ${reading.error ?? 'no answer'}`);
    return;
  }
  const inspection = reading.inspection;
  log.info(prism.bold(`${target} on ${reading.node} — read, nothing changed`));
  log.info(
    `interfaces: ${inspection.interfaces
      .filter((i) => i.family === 'IPv4')
      .map((i) => `${i.name} ${i.address}`)
      .join(' · ')}`,
  );

  for (const service of inspection.services) {
    const head = `${prism.bold(service.name)} ${service.provisioning}${service.networkMode ? ` · ${service.networkMode}` : ''}`;
    if (service.external) {
      const e = service.external;
      const answer = e.probe
        ? e.probe.ok
          ? `${e.probe.method}: ${formatProbe(e.probe)}`
          : `${e.probe.method}: ${prism.red(e.probe.error ?? 'failed')}`
        : '';
      log.info(`${head} → ${e.host}:${e.port ?? '-'} · on this node ${yes(e.local)} · reachable ${yes(e.reachable)} ${answer}`);
    } else if (service.onHost) {
      const h = service.onHost;
      log.info(
        `${head} · installed ${yes(h.installed)} · user ${yes(h.userExists)} · unit ` +
          (h.unit ? `${h.unit.name} ${h.unit.known ? (h.unit.active ? 'active' : 'inactive') : 'unknown'}` : '-') +
          ` · config ${h.config} · unit file ${h.unitFile}`,
      );
      if (h.dataDir) {
        log.info(
          `  data ${h.dataDir.path} · ${h.dataDir.exists ? `owner ${h.dataDir.owner}` : 'absent'} · ` +
            `${h.dataDir.disk ? `${h.dataDir.disk.mount} free ${bytes(h.dataDir.disk.availBytes)} of ${bytes(h.dataDir.disk.sizeBytes)}` : 'disk unknown'}`,
        );
      }
      if (h.probe) {
        log.info(`  ${h.probe.method}: ${h.probe.ok ? formatProbe(h.probe) : prism.red(h.probe.error ?? 'failed')}`);
      }
      for (const action of h.actions) log.info(`  would ${action}`);
      for (const refusal of h.refusals) log.warn(`  refuses: ${refusal}`);
    } else {
      log.info(head);
    }
  }

  for (const unit of inspection.units) {
    log.info(
      `unit ${unit.unit}: ${unit.known ? `${unit.active ? 'active' : 'inactive'}, ${unit.enabled ? 'enabled' : 'disabled'}, ${unit.fragmentPath}` : 'unknown'}` +
        (unit.execStart ? ` · ${unit.execStart}` : ''),
    );
  }
  for (const path of inspection.paths) {
    log.info(
      `path ${path.path}: ${path.exists ? `owner ${path.owner} · ${bytes(path.sizeBytes)}` : 'absent'}` +
        (path.disk ? ` · ${path.disk.mount} free ${bytes(path.disk.availBytes)} of ${bytes(path.disk.sizeBytes)}` : ''),
    );
  }
  for (const snap of inspection.snaps) {
    log.info(`snap ${snap.name}: ${snap.installed ? `${snap.version} (rev ${snap.revision})` : 'not installed'}`);
  }
  for (const file of inspection.configKeys) {
    const values = Object.entries(file.values).map(([k, v]) => `${k}=${v ?? '(unset)'}`).join(' ');
    log.info(`config ${file.path}: ${file.exists ? values : 'absent'}${file.refused.length ? ` · refused ${file.refused.join(', ')}` : ''}`);
  }
}

function colourStatus(status: string | undefined): string {
  return status === 'running' ? prism.green(status) : status === 'exited' || status === 'error' ? prism.red(status) : prism.yellow(status ?? 'unknown');
}

function printContainers(containers: readonly ContainerState[]): void {
  table({
    width: 'auto',
    data: containers.map((c) => ({
      name: c.name,
      stack: stackLabel(c),
      image: c.image,
      status: colourStatus(c.status),
      health: c.health === 'healthy' ? prism.green(c.health) : c.health === 'unhealthy' ? prism.red(c.health) : prism.dim(c.health ?? 'n/a'),
    })),
    // No fixed widths: with `width: 'auto'` the table sizes to its content,
    // and a cap here only truncates. `btcpayserver/bitcoin:31.0` rendered as
    // `btcpayserver/bitcoin:...` — the version tag cut off, which is the
    // half of an image name anyone reads this column for.
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'stack', header: 'Stack' },
      { key: 'image', header: 'Image' },
      { key: 'status', header: 'Status' },
      { key: 'health', header: 'Health' },
    ],
  });
}

/**
 * `omnitron infra logs [service] [--stack <project>/<stack>]`.
 *
 * Every container is named with its stack and machine before its logs.
 * `infra logs tor` printed `daos-dev-tor`'s log bare — the first container
 * whose name contained «tor» — to an operator who may have meant the test
 * stack's, on another machine. Several matches are now listed rather than
 * the first one taken; a remote stack's logs are on its node, and no daemon
 * RPC relays a node's container logs to this CLI, so that is said instead
 * of printing this machine's.
 */
export async function infraLogsCommand(
  service?: string,
  opts?: { follow?: boolean; lines?: string; stack?: string },
): Promise<void> {
  const all = await listManagedContainers();
  const machine = os.hostname();
  const tail = parseInt(opts?.lines ?? '50', 10);

  let containers = all;
  if (opts?.stack) {
    const wanted = parseStack(opts.stack);
    if (typeof wanted === 'string') {
      log.error(wanted);
      process.exitCode = 1;
      return;
    }
    containers = all.filter((c) => c.project === wanted.project && c.stack === wanted.stack);
    if (containers.length === 0) {
      const info = await askStack(wanted.project, wanted.stack);
      if (typeof info !== 'string' && info.type !== 'local') {
        const hosts = info.nodes.map((n) => n.host).join(', ') || 'its node';
        const named = service ? info.infrastructure.services[service]?.containerName : undefined;
        log.error(
          `The containers of ${opts.stack} run on ${hosts}, not on this machine (${machine}), ` +
            'and no daemon RPC relays a node\'s container logs to this command.',
        );
        log.info(`  On the node: docker logs --tail ${tail} ${named ?? '<container>'}`);
      } else {
        log.error(`No containers of ${opts.stack} on this machine (${machine})${typeof info === 'string' ? `, and ${info}` : ''}.`);
      }
      process.exitCode = 1;
      return;
    }
  }

  let targets: ContainerState[];
  if (service) {
    // The service label first — `tor` is a service; `daos-dev-tor` a name.
    const byLabel = containers.filter((c) => c.service === service);
    const matches = byLabel.length > 0 ? byLabel : containers.filter((c) => c.name.includes(service));
    if (matches.length === 0) {
      log.error(`Container matching '${service}' not found on this machine (${machine}).`);
      log.info(`Available: ${containers.map((c) => c.name).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    if (matches.length > 1) {
      log.error(`'${service}' matches ${matches.length} containers on this machine — choose one with --stack <project>/<stack>:`);
      for (const c of matches) log.info(`  ${c.name}  (stack ${stackLabel(c)})`);
      process.exitCode = 1;
      return;
    }
    targets = matches;
  } else {
    targets = containers.filter((c) => c.status === 'running');
  }

  for (const t of targets) {
    process.stdout.write(`\n${prism.cyan(`─── ${t.name} — stack ${stackLabel(t)}, this machine (${machine}) ───`)}\n`);
    try {
      const logs = await getContainerLogs(t.name, tail);
      process.stdout.write(logs + '\n');
    } catch (err) {
      log.warn(`Could not get logs for ${t.name}: ${(err as Error).message}`);
    }
  }

  if (opts?.follow) {
    log.info('Follow mode not yet implemented for infra logs. Use: docker logs -f <container>');
  }
}

/**
 * The running container for a declared service, found by its label.
 *
 * A container's NAME carries the project-and-environment prefix
 * (`daos-test-postgres`); only the `omnitron.service` label says which
 * service it is. These two commands used to guess the name — `omnitron-postgres`,
 * then `omnitron-pg`, then `omnitron-redis` — and on a host where the stack
 * is anything but the default they all missed. Measured on the `daos/test`
 * node: `daos-test-postgres` and `daos-test-redis` both up and healthy, and
 * `infra psql` answered "No PostgreSQL container found. Run: omnitron infra up"
 * — the wrong cause, and advice to re-provision a database that was serving.
 */
async function runningContainerForService(...services: string[]): Promise<ContainerState | null> {
  const managed = await listManagedContainers();
  for (const service of services) {
    const found = managed.find((c) => c.service === service && c.status === 'running');
    if (found) return found;
  }
  return null;
}

/**
 * Hand the terminal to a tool inside a container.
 *
 * The lookup happens BEFORE the exec so the two outcomes stay separate: a
 * container that is not there is this command's problem to explain, while a
 * non-zero exit from psql or redis-cli belongs to the user's own session and
 * must not be reported as a missing container. The previous form could not
 * tell them apart — quitting psql after a failed query looked exactly like an
 * absent container and sent the reader to `infra up`.
 */
async function execInteractively(
  what: string,
  services: string[],
  argv: (container: ContainerState) => string[],
): Promise<void> {
  const container = await runningContainerForService(...services);
  if (!container) {
    const managed = await listManagedContainers();
    const present = managed.filter((c) => services.includes(c.service ?? '')).map((c) => `${c.name} (${c.status})`);
    log.error(
      present.length > 0
        ? `No RUNNING ${what} container. Found: ${present.join(', ')}. Start it with: omnitron infra up`
        : `No ${what} container on this host. Run: omnitron infra up`,
    );
    return;
  }

  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('docker', ['exec', '-it', container.name, ...argv(container)], { stdio: 'inherit' });
  } catch (err) {
    // The container was found a moment ago, so this is the tool's own exit
    // status or a docker failure — report it as such rather than as absence.
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status !== 0) return; // the user's own session ended non-zero
    log.error(`Could not attach to ${container.name}: ${(err as Error).message}`);
  }
}

export async function infraPsqlCommand(database?: string): Promise<void> {
  const db = database ?? 'postgres';
  // The stack's own Postgres first, then the daemon's internal one: a caller
  // asking for `psql` wants the application database when there is one.
  await execInteractively('PostgreSQL', ['postgres', 'omnitron-pg'], (c) => [
    'psql',
    '-U',
    c.service === 'omnitron-pg' ? 'omnitron' : 'postgres',
    '-d',
    db,
  ]);
}

export async function infraRedisCliCommand(): Promise<void> {
  await execInteractively('Redis', ['redis'], () => ['redis-cli']);
}

export async function infraMigrateCommand(app?: string): Promise<void> {
  log.info('Running migrations...');
  const { execFileSync } = await import('node:child_process');
  const cwd = process.cwd();

  const apps = app ? [app] : ['main', 'storage', 'pricing', 'payments', 'messaging'];

  for (const a of apps) {
    try {
      log.step(`Migrating ${a}...`);
      execFileSync('pnpm', ['--filter', `@omnitron-dev/${a}`, 'migrate'], {
        cwd,
        timeout: 30_000,
        stdio: 'pipe',
      });
      log.success(`${a} migrated`);
    } catch {
      log.warn(`${a} skipped`);
    }
  }
}

export async function infraResetCommand(opts?: { yes?: boolean }): Promise<void> {
  if (!opts?.yes) {
    log.error('This will DESTROY all data volumes. Pass --yes to confirm.');
    return;
  }

  log.warn('Resetting infrastructure — destroying all data...');
  await infraDownCommand({ volumes: true });
  await infraUpCommand();
  log.info('Infrastructure reset complete.');
}
