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

import { log, table, prism } from '@xec-sh/kit';
import { loadEcosystemConfig } from '../config/loader.js';
import { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import { summariseProvisioning } from '../infrastructure/provisioning-outcome.js';
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

export async function infraStatusCommand(): Promise<void> {
  const containers = await listManagedContainers();

  if (containers.length === 0) {
    log.info('No Omnitron-managed containers found.');
    log.info('Run: omnitron infra up');
    return;
  }

  table({
    width: 'auto',
    data: containers.map((c) => ({
      name: c.name,
      image: c.image,
      status: c.status === 'running' ? prism.green(c.status) : c.status === 'exited' ? prism.red(c.status) : prism.yellow(c.status ?? 'unknown'),
      health: c.health === 'healthy' ? prism.green(c.health) : c.health === 'unhealthy' ? prism.red(c.health) : prism.dim(c.health ?? 'n/a'),
    })),
    // No fixed widths: with `width: 'auto'` the table sizes to its content,
    // and a cap here only truncates. `btcpayserver/bitcoin:31.0` rendered as
    // `btcpayserver/bitcoin:...` — the version tag cut off, which is the
    // half of an image name anyone reads this column for.
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'image', header: 'Image' },
      { key: 'status', header: 'Status' },
      { key: 'health', header: 'Health' },
    ],
  });
}

export async function infraLogsCommand(service?: string, opts?: { follow?: boolean; lines?: string }): Promise<void> {
  const containers = await listManagedContainers();
  const target = service
    ? containers.find((c) => c.name.includes(service))
    : null;

  if (service && !target) {
    log.error(`Container matching '${service}' not found.`);
    log.info(`Available: ${containers.map((c) => c.name).join(', ')}`);
    return;
  }

  const targets = target ? [target] : containers.filter((c) => c.status === 'running');
  const tail = parseInt(opts?.lines ?? '50', 10);

  for (const t of targets) {
    if (targets.length > 1) {
      process.stdout.write(`\n${prism.cyan(`─── ${t.name} ───`)}\n`);
    }
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

export async function infraPsqlCommand(database?: string): Promise<void> {
  const db = database ?? 'postgres';
  const { execFileSync } = await import('node:child_process');

  try {
    execFileSync('docker', ['exec', '-it', 'omnitron-postgres', 'psql', '-U', 'postgres', '-d', db], {
      stdio: 'inherit',
    });
  } catch {
    // Try omnitron's own PG
    try {
      execFileSync('docker', ['exec', '-it', 'omnitron-pg', 'psql', '-U', 'omnitron', '-d', db], {
        stdio: 'inherit',
      });
    } catch {
      log.error('No PostgreSQL container found. Run: omnitron infra up');
    }
  }
}

export async function infraRedisCliCommand(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('docker', ['exec', '-it', 'omnitron-redis', 'redis-cli'], {
      stdio: 'inherit',
    });
  } catch {
    log.error('Redis container not found. Run: omnitron infra up');
  }
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
