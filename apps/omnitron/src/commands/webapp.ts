/**
 * Webapp CLI Commands
 *
 *   omnitron webapp build     — Build webapp (vite build)
 *   omnitron webapp start     — Start nginx serving webapp + API gateway
 *   omnitron webapp stop      — Stop nginx
 *   omnitron webapp status    — Show nginx status
 *   omnitron webapp open      — Open webapp in browser
 */

import { log, prism } from '@xec-sh/kit';
import { WebappService } from '../webapp/webapp.service.js';

function createWebappService(): WebappService {
  const cliLogger = {
    info: (obj: any, msg?: string) => log.info(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
    warn: (obj: any, msg?: string) => log.warn(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
    error: (obj: any, msg?: string) => log.error(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
    debug: () => {},
    fatal: (obj: any, msg?: string) => log.error(msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj))),
    trace: () => {},
    child: () => cliLogger,
  } as any;

  return new WebappService(cliLogger, process.cwd());
}

export async function webappBuildCommand(): Promise<void> {
  const svc = createWebappService();
  try {
    const { distPath, duration } = await svc.build();
    log.info(`Built in ${Math.round(duration / 1000)}s → ${distPath}`);
  } catch (err) {
    log.error((err as Error).message);
  }
}

export async function webappStartCommand(options?: { force?: boolean }): Promise<void> {
  // Check if daemon is running
  const { PidManager } = await import('../daemon/pid-manager.js');
  const { DEFAULT_DAEMON_CONFIG } = await import('../config/defaults.js');
  const pidFile = DEFAULT_DAEMON_CONFIG.pidFile.replace('~', process.env['HOME'] ?? '');
  const pidManager = new PidManager(pidFile);

  if (!pidManager.isRunning()) {
    log.error('Omnitron daemon is not running.');
    log.info('Start the daemon first: omnitron up');
    return;
  }

  const svc = createWebappService();
  try {
    await svc.start(options?.force ? { force: true } : undefined);
    log.info(`Omnitron Console: http://localhost:9800`);

    // Persist — auto-start webapp on future daemon restarts
    const { readSavedDaemonConfig, writeSavedDaemonConfig } = await import('./up.js');
    const saved = readSavedDaemonConfig();
    if (saved && !saved.webapp) {
      saved.webapp = true;
      writeSavedDaemonConfig(saved);
    }
  } catch (err) {
    log.error((err as Error).message);
  }
}

export async function webappStopCommand(): Promise<void> {
  const svc = createWebappService();
  await svc.stop();

  // Persist — don't auto-start webapp on future daemon restarts
  const { readSavedDaemonConfig, writeSavedDaemonConfig } = await import('./up.js');
  const saved = readSavedDaemonConfig();
  if (saved && saved.webapp) {
    saved.webapp = false;
    writeSavedDaemonConfig(saved);
  }
}

export async function webappStatusCommand(): Promise<void> {
  const svc = createWebappService();
  const status = await svc.status();

  if (status.running) {
    const health = status.healthy ? prism.green('healthy') : prism.yellow('starting');
    log.success(`Omnitron Console: ${prism.green('running')} on port ${status.port} (${health})`);
    log.info(`URL: http://localhost:${status.port}`);
  } else {
    log.warn(`Omnitron Console: ${prism.red('stopped')}`);
    log.info('Start with: omnitron webapp start');
  }
}

export async function webappOpenCommand(): Promise<void> {
  const svc = createWebappService();
  const status = await svc.status();

  if (!status.running) {
    log.warn('Webapp not running. Starting...');
    await svc.start();
  }

  const url = `http://localhost:${status.port}`;
  log.info(`Opening ${url}...`);

  try {
    const { exec } = await import('node:child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${url}`);
  } catch {
    log.info(`Open manually: ${url}`);
  }
}
