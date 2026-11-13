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
 *   omnitron infra reset      — Recreate containers using their existing volumes
 */

import os from 'node:os';
import { assertStandaloneInfrastructure } from '../cluster/standalone-infrastructure.js';
import { log, table, prism } from '@xec-sh/kit';
import { ownedContainerId } from '../infrastructure/owned-container.js';
import { loadEcosystemConfig } from '../config/loader.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { emitError, emitJson, isJsonMode } from './output.js';
import type { IStackInfo } from '../shared/dto/project.js';
import { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { ContainerState } from '../infrastructure/types.js';
import { summariseProvisioning } from '../infrastructure/provisioning-outcome.js';
import { probeFields, type ProbeReading } from '../infrastructure/host-inspection.js';
import {
  listManagedContainers,
  getContainerLogs,
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

async function standaloneServices(): Promise<InfrastructureService> {
  assertStandaloneInfrastructure();
  const config = await loadEcosystemConfig();
  if (!config.infrastructure) throw new Error('No infrastructure declared in this ecosystem');
  if (config.stacks && Object.keys(config.stacks).length) throw new Error('This project declares stacks. Select its project and stack through omnitron stack.');
  return new InfrastructureService(cliLogger, config.infrastructure, undefined, undefined, undefined, false);
}

export async function infraUpCommand(): Promise<void> {
  await provisionStandalone(await standaloneServices());
}

async function provisionStandalone(infra: InfrastructureService): Promise<void> {
  assertStandaloneInfrastructure();
  let state;
  try { state = await infra.provision(); }
  finally { infra.dispose(); }
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

  if (!outcome.ready) throw new Error('Declared infrastructure is not ready');
}

export async function infraDownCommand(opts?: { volumes?: boolean }): Promise<void> {
  assertStandaloneInfrastructure();
  if (opts?.volumes) throw new Error('Volume removal is unsupported. Select the exact data volumes for manual removal.');
  await removeStandalone(await standaloneServices());
}

async function removeStandalone(infra: InfrastructureService): Promise<void> {
  const desired = new Map(infra.getDesiredContainers().map(container => [container.name, container]));
  const inventory = await listManagedContainers({ orThrow: true, checkNames: new Set(desired.keys()) });
  const containers = inventory.flatMap(actual => {
    const declared = desired.get(actual.name);
    if (!declared) return [];
    const id = ownedContainerId(declared, actual);
    return [{ ...actual, id }];
  });
  for (const container of containers) {
    assertStandaloneInfrastructure();
    log.info(`Stopping ${container.name}...`);
    if (container.status !== 'exited' && container.status !== 'created') await stopContainer(container.id, 10);
    assertStandaloneInfrastructure();
    await removeContainer(container.id, { graceful: true });
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
  if (!project || !stack || rest.length > 0) return `--stack takes <project>/<stack>, e.g. sample/test — got '${value}'`;
  return { project, stack };
}

/**
 * Resolve the selected stack and its node observations through the controller.
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

/** Read the controller's host inventory, including setup observations when the daemon is reachable. */
async function localContainerInventory(): Promise<ContainerState[]> {
  const client = createDaemonClient();
  try {
    if (await client.isReachable()) {
      const service = await client.service<import('../shared/dto/services.js').IOmnitronInfraService>('OmnitronInfra');
      return await service.listContainers();
    }
    log.warn('Daemon unavailable: native container health only; declared service setup is not verified.');
    return await listManagedContainers({ orThrow: true });
  } finally { await client.disconnect(); }
}

export async function infraStatusCommand(opts: { stack?: string } = {}): Promise<void> {
  const machine = os.hostname();

  if (opts.stack !== undefined) {
    const wanted = parseStack(opts.stack);
    if (typeof wanted === 'string') {
      log.error(wanted);
      process.exitCode = 1;
      return;
    }
    const info = await askStack(wanted.project, wanted.stack);
    if (typeof info === 'string') {
      log.error(`Container inventory unavailable for ${opts.stack}: ${info}.`);
      process.exitCode = 1;
      return;
    }
    if (info.type === 'local') {
      const scope = info.runtimeScope ?? wanted;
      try {
        const here = (await localContainerInventory()).filter(c => c.project === scope.project && c.stack === scope.stack);
        if (here.length) {
          log.info(prism.bold(`Containers of ${opts.stack} on this machine (${machine})`));
          printContainers(here);
        } else log.info(`No managed containers of ${opts.stack} on this machine (${machine}).`);
      } catch (error) {
        log.error(`Container inventory unavailable for ${opts.stack} on ${machine}: ${(error as Error).message}`);
        process.exitCode = 1;
      }
      return;
    }
    const hosts = info.nodes.map((n) => n.host).join(', ') || 'its node';
    log.info(prism.bold(`Containers of ${opts.stack} on ${hosts} — asked of the node through the daemon`));
    const placements = info.placements ?? [];
    const rows = placements.length ? placements.flatMap(node => {
      if (!node.infrastructureObserved || !node.infrastructure) {
        log.warn(`${node.nodeKey}: infrastructure inventory unavailable.`);
        process.exitCode = 1;
        return [];
      }
      const services = Object.entries(node.infrastructure.services);
      if (!services.length) log.info(`${node.nodeKey}: no managed containers reported.`);
      return services.map(([name, svc]) => ({ node: node.nodeKey, name, svc }));
    }) : Object.entries(info.infrastructure.services).map(([name, svc]) => ({
      node: svc.nodeKey ?? (info.nodes.length === 1 ? hosts : 'Not reported'), name, svc,
    }));
    if (!rows.length) {
      if (!placements.length) {
        log.warn(`Infrastructure inventory unavailable for ${opts.stack} on ${hosts}.`);
        process.exitCode = 1;
      }
      return;
    }
    table({
      width: 'auto',
      data: rows.map(({ node, name, svc }) => ({
        node,
        service: svc.service ?? name,
        container: svc.containerName,
        status: colourStatus(svc.nativeStatus ?? svc.status),
        health: svc.health ?? 'Not reported',
        port: svc.port ?? '-',
        setup: svc.provisioning ?? 'Not reported',
        reason: svc.error ?? '-',
      })),
      columns: [
        { key: 'node', header: 'Node' },
        { key: 'service', header: 'Service' },
        { key: 'container', header: 'Container' },
        { key: 'status', header: 'Status' },
        { key: 'health', header: 'Health' },
        { key: 'port', header: 'Port' },
        { key: 'setup', header: 'Setup' },
        { key: 'reason', header: 'Reason' },
      ],
    });
    return;
  }

  const containers = await localContainerInventory();
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
    if (readings.some((r) => r.error)) process.exitCode = 1;
    if (emitJson({ stack: target, nodes: readings })) return;
    for (const reading of readings) printInspection(target, reading);
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
  if (inspection.memory) {
    const m = inspection.memory;
    log.info(
      `memory: available ${bytes(m.availableBytes)} of ${bytes(m.totalBytes)} · swap free ${bytes(m.swapFreeBytes)} of ${bytes(m.swapTotalBytes)}`
    );
  }

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
          (h.unit ? `${h.unit.name} ${h.unit.known ? h.unit.state : 'unknown'}` : '-') +
          ` · config ${h.config} · unit file ${h.unitFile}`,
      );
      for (const p of h.packages ?? []) {
        log[p.state === 'blocked' ? 'warn' : 'info'](`  APT ${p.name} · installed ${p.installed ?? '—'} · candidate ${p.candidate ?? '—'} · ${p.state} · ${p.detail}`);
      }
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
    if (!unit.known) {
      log.info(`unit ${unit.unit}: unknown`);
      continue;
    }
    log.info(
      `unit ${unit.unit}: ${unit.state}${unit.result && unit.result !== 'success' ? ` · last ended ${unit.result}` : ''} · ` +
        `${unit.enabled ? 'enabled' : 'disabled'} · pid ${unit.mainPid ?? '-'} · restarts ${unit.restarts ?? '-'}` +
        `${unit.since ? ` · active since ${unit.since}` : ''} · ${unit.fragmentPath}` +
        (unit.execStart ? ` · ${unit.execStart}` : ''),
    );
    for (const p of unit.processes) {
      const where = `pid ${p.pid} in ${p.cgroup ?? 'an unknown cgroup'}`;
      log[p.inUnit ? 'info' : 'warn'](`  ${where}${p.inUnit ? '' : ` — outside ${unit.unit}`}`);
    }
    for (const job of unit.jobs) log.info(`  job ${job}`);
    for (const line of unit.journal) log.info(prism.dim(`  ${line}`));
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
      setup: c.provisioning ?? 'Not reported',
      reason: c.error ?? '-',
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
      { key: 'setup', header: 'Setup' },
      { key: 'reason', header: 'Reason' },
    ],
  });
}

/**
 * `omnitron infra logs [service] [--stack <project>/<stack>]`.
 *
 * Every container is named with its stack and machine before its logs.
 * `infra logs tor` printed `sample-dev-tor`'s log bare — the first container
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
    // The service label first — `tor` is a service; `sample-dev-tor` a name.
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

/** Open only a service whose identity is unambiguous in the local Docker inventory. */
async function execInteractively(
  what: string,
  services: string[],
  scope: string | undefined,
  argv: (container: ContainerState) => string[],
): Promise<void> {
  try {
    const wanted = scope === undefined ? undefined : parseStack(scope);
    if (typeof wanted === 'string') throw new Error(wanted);
    const managed = await listManagedContainers({ orThrow: true });
    const scoped = wanted ? managed.filter(c => c.project === wanted.project && c.stack === wanted.stack) : managed;
    // Prefer the application service. A stopped application database must never select the control database.
    const service = services.find(name => scoped.some(c => c.service === name));
    const matches = service ? scoped.filter(c => c.service === service) : [];
    if (!matches.length) throw new Error('No ' + what + ' container on this host' + (scope ? ' for ' + scope : '') +
      '. Inspect the target with omnitron infra status' + (scope ? ' --stack ' + scope : '') + '.');
    if (matches.length > 1) throw new Error('Several ' + what + ' containers match. Select --stack <project>/<stack>. Candidates: ' +
      matches.map(c => stackLabel(c) + ' (' + c.name + ')').sort().join(', '));
    const container = matches[0]!;
    if (container.status !== 'running') throw new Error(what + ' container ' + container.name + ' (' + container.status + ')');
    const { execFileSync } = await import('node:child_process');
    const terminal = process.stdin.isTTY && process.stdout.isTTY ? '-it' : '-i';
    execFileSync('docker', ['exec', terminal, container.containerId ?? container.name, ...argv(container)], { stdio: 'inherit' });
  } catch (err) {
    const status = (err as { status?: number }).status;
    // psql/redis-cli and Docker already wrote their diagnostic to the inherited terminal or pipe.
    if (typeof status === 'number' && status > 0) { process.exitCode = status; return; }
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

export async function infraPsqlCommand(database?: string, options: { stack?: string; command?: string } = {}): Promise<void> {
  const db = database ?? 'postgres';
  if (options.stack !== undefined && (db.includes('=') || /^postgres(?:ql)?:\/\//i.test(db))) {
    log.error('A scoped database shell takes a database name; a connection string can select a different server.');
    process.exitCode = 1;
    return;
  }
  await execInteractively('PostgreSQL', options.stack === undefined ? ['postgres', 'omnitron-pg'] : ['postgres'], options.stack, c => [
    'psql', '-U', c.service === 'omnitron-pg' ? 'omnitron' : 'postgres', '-d', db,
    ...(options.command === undefined ? [] : ['-v', 'ON_ERROR_STOP=1', '-c', options.command]),
  ]);
}

export async function infraRedisCliCommand(options: { stack?: string; db?: string } = {}, args: string[] = []): Promise<void> {
  if (options.db !== undefined && (!/^\d+$/.test(options.db) || !Number.isSafeInteger(Number(options.db)))) {
    log.error('--db takes a nonnegative Redis database index');
    process.exitCode = 1;
    return;
  }
  if (args.length && !/^[a-z][\w.-]*$/i.test(args[0]!)) {
    log.error('Pass a Redis command followed by its arguments. Use --db to select a database.');
    process.exitCode = 1;
    return;
  }
  await execInteractively('Redis', ['redis'], options.stack, () => [
    'redis-cli', ...(options.db === undefined ? [] : ['-n', options.db]), ...(args.length ? ['-e', ...args] : []),
  ]);
}

export async function infraMigrateCommand(app?: string, options: { dryRun?: boolean; stack?: string } = {}): Promise<void> {
  assertStandaloneInfrastructure();
  const { planWorkspaceMigrations, planDeclaredWorkspaceMigrations } = await import('../migration/workspace.js');
  const config = await loadEcosystemConfig();
  const declared = await planDeclaredWorkspaceMigrations(process.cwd(), config, { ...(app ? { app } : {}), ...(options.stack ? { stack: options.stack } : {}) });
  if (declared !== null) {
    const summary = declared.map(({ target }) => ({ app: target.app, service: target.service, database: target.database,
      mode: target.mode, file: target.script, directory: target.cwd }));
    if (options.dryRun) {
      if (!emitJson({ migrations: summary })) for (const target of summary) log.info(`${target.service}/${target.database} · ${target.app} · ${target.file}`);
      return;
    }
    const { executeLocalMigration } = await import('../services/migration-process.js');
    const { waitForPostgres } = await import('../services/wait-for-postgres.js');
    const { migrationOutput } = await import('../services/migration-output.js');
    const { localMigrationTargets } = await import('../services/migration-target.js');
    const { redactDiagnosticText } = await import('@omnitron-dev/titan/diagnostics');
    for (const { target, env } of declared) if (target.mode === 'config') {
      assertStandaloneInfrastructure();
      try { await executeLocalMigration(target, env, { validate: true }); }
      catch (error) {
        const detail = error as { stderr?: string; message?: string };
        throw Error(`Migration configuration preflight failed for ${target.app}: ${redactDiagnosticText(detail.stderr || detail.message || String(error))}. No migrations executed.`, { cause: error });
      }
    }
    for (const { target, env, database } of declared) {
      assertStandaloneInfrastructure();
      await waitForPostgres(database.host, database.port, database.user, database.password, 180_000, database.connectionString);
      assertStandaloneInfrastructure();
      const [checked] = await localMigrationTargets([target], config.apps, process.cwd());
      if (checked?.script !== target.script || checked.cwd !== target.cwd)
        throw Error(`Migration source changed for ${target.app}; inspect the plan before retrying`);
      const result = await executeLocalMigration(target, env);
      if (!isJsonMode()) for (const line of migrationOutput(result.stdout)) log.info(redactDiagnosticText(line));
    }
    emitJson({ migrated: summary });
    return;
  }
  const plan = await planWorkspaceMigrations(process.cwd(), config.apps, app);
  if (options.dryRun) {
    if (!emitJson({ applications: plan })) {
      for (const target of plan) log.info(`${target.app} · pnpm run migrate · ${target.directory}`);
    }
    return;
  }
  const { spawnSync } = await import('node:child_process');
  const json = isJsonMode();
  for (const target of plan) {
    assertStandaloneInfrastructure();
    if (!json) log.step(`Migrating ${target.app} in ${target.directory}`);
    const run = spawnSync('pnpm', ['run', 'migrate'], { cwd: target.directory, stdio: json ? ['inherit', 2, 2] : 'inherit' });
    if (run.error || run.status !== 0) {
      throw new Error(`Migration failed for '${target.app}': ${run.error?.message ?? run.signal ?? `exit ${run.status}`}`, { cause: run.error });
    }
    if (!json) log.success(`${target.app} migrated`);
  }
  emitJson({ migrated: plan.map(target => target.app) });
}

export async function infraResetCommand(opts?: { yes?: boolean }): Promise<void> {
  if (!opts?.yes) {
    log.error('This will recreate managed containers. Pass --yes to confirm.');
    process.exitCode = 1;
    return;
  }

  log.warn('Recreating managed containers with their existing volumes...');
  const infra = await standaloneServices();
  await removeStandalone(infra);
  await provisionStandalone(infra);
  log.info('Infrastructure reset complete.');
}
