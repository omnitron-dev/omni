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

  log.info('\nInfrastructure ready:');
  for (const [name, svc] of Object.entries(state.services)) {
    const icon = svc.status === 'running' ? prism.green('✓') : prism.red('✗');
    log.info(`  ${icon} ${name} (${svc.image})`);
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
    data: containers.map((c) => ({
      name: c.name,
      image: c.image,
      status: c.status === 'running' ? prism.green(c.status) : c.status === 'exited' ? prism.red(c.status) : prism.yellow(c.status ?? 'unknown'),
      health: c.health === 'healthy' ? prism.green(c.health) : c.health === 'unhealthy' ? prism.red(c.health) : prism.dim(c.health ?? 'n/a'),
    })),
    columns: [
      { key: 'name', header: 'Name', width: 24 },
      { key: 'image', header: 'Image', width: 24 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'health', header: 'Health', width: 12 },
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

  const apps = app ? [app] : ['main', 'storage', 'priceverse', 'paysys', 'messaging'];

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
