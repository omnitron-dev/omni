/** Console lifecycle commands share the CLI output and outcome contract. */
import { log, prism } from '@xec-sh/kit';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebappService } from '../webapp/webapp.service.js';
import { expandPath } from '../shared/paths.js';
import { emitError, emitInfo, emitJson, isJsonMode } from './output.js';

function createWebappService(): WebappService {
  const message = (obj: unknown, text?: string) => text ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
  const cliLogger = {
    info: (obj: unknown, text?: string) => emitInfo(message(obj, text)),
    warn: (obj: unknown, text?: string) => {
      if (!isJsonMode()) log.warn(message(obj, text));
    },
    // Service logging is progress. Only the command boundary emits the final
    // machine error, including whether the lifecycle action already completed.
    error: (obj: unknown, text?: string) => {
      if (!isJsonMode()) log.error(message(obj, text));
    },
    debug: () => {},
    fatal: (obj: unknown, text?: string) => {
      if (!isJsonMode()) log.error(message(obj, text));
    },
    trace: () => {},
    child: () => cliLogger,
  } as any;
  return new WebappService(cliLogger, process.cwd());
}

async function requireRunningDaemon(): Promise<boolean> {
  const { PidManager } = await import('../daemon/pid-manager.js');
  const { DEFAULT_DAEMON_CONFIG } = await import('../config/defaults.js');
  if (new PidManager(expandPath(DEFAULT_DAEMON_CONFIG.pidFile)).isRunning()) return true;
  emitError('Omnitron daemon is not running. Start it first: omnitron up', {
    code: 'DAEMON_NOT_RUNNING',
    outcome: 'not-started',
  });
  process.exitCode = 1;
  return false;
}

async function persistAutoStart(enabled: boolean): Promise<boolean | null> {
  const { readSavedDaemonConfig, writeSavedDaemonConfig } = await import('../config/saved.js');
  const saved = readSavedDaemonConfig();
  if (!saved) return null;
  if (saved.webapp !== enabled) writeSavedDaemonConfig({ ...saved, webapp: enabled });
  return enabled;
}

function failed(error: unknown, operation: string, applied: boolean): void {
  emitError(error instanceof Error ? error.message : String(error), {
    operation,
    outcome: applied ? 'applied' : 'unknown',
    hint: applied
      ? 'The Console action completed, but a subsequent step failed. Inspect its state before retrying.'
      : 'Inspect Console status before retrying; a failed operation can have partially changed the container.',
  });
  process.exitCode = 1;
}

export async function webappBuildCommand(): Promise<void> {
  try {
    const { distPath, duration } = await createWebappService().build();
    if (!emitJson({ operation: 'build', distPath, durationMs: duration })) {
      emitInfo(`Built in ${Math.round(duration / 1000)}s → ${distPath}`);
    }
  } catch (error) {
    failed(error, 'build', false);
  }
}

export async function webappStartCommand(options?: { force?: boolean }): Promise<void> {
  let applied = false;
  try {
    if (!(await requireRunningDaemon())) return;
    const svc = createWebappService();
    await svc.start(options?.force ? { force: true } : undefined);
    applied = true;
    const autoStart = await persistAutoStart(true);
    const status = await svc.status();
    const url = `http://localhost:${status.port}`;
    if (!emitJson({ operation: 'start', ...status, url, autoStart })) emitInfo(`Omnitron Console: ${url}`);
  } catch (error) {
    failed(error, 'start', applied);
  }
}

export async function webappStopCommand(): Promise<void> {
  let applied = false;
  try {
    await createWebappService().stop();
    applied = true;
    const autoStart = await persistAutoStart(false);
    if (!emitJson({ operation: 'stop', stopped: true, autoStart })) emitInfo('Omnitron Console stopped');
  } catch (error) {
    failed(error, 'stop', applied);
  }
}

export async function webappStatusCommand(): Promise<void> {
  try {
    const status = await createWebappService().status();
    const url = `http://localhost:${status.port}`;
    if (emitJson({ ...status, url })) return;
    if (status.running) {
      const health = status.healthy ? prism.green('healthy') : prism.yellow('starting');
      log.success(`Omnitron Console: ${prism.green('running')} on port ${status.port} (${health})`);
      emitInfo(`URL: ${url}`);
    } else {
      log.warn(`Omnitron Console: ${prism.red('stopped')}`);
      emitInfo('Start with: omnitron webapp start');
    }
  } catch (error) {
    emitError(error instanceof Error ? error.message : String(error), { operation: 'status', outcome: 'not-started' });
    process.exitCode = 1;
  }
}

export async function webappOpenCommand(): Promise<void> {
  let applied = false;
  try {
    const svc = createWebappService();
    let status = await svc.status();
    if (!status.running) {
      if (!(await requireRunningDaemon())) return;
      emitInfo('Webapp not running. Starting...');
      await svc.start();
      applied = true;
      status = await svc.status();
    }
    const url = `http://localhost:${status.port}`;
    emitInfo(`Opening ${url}...`);
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd.exe' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', url] : [url];
    await promisify(execFile)(command, args, { timeout: 10_000 });
    if (!emitJson({ operation: 'open', url, browserOpened: true, started: applied })) emitInfo(`Opened ${url}`);
  } catch (error) {
    failed(error, 'open', applied);
  }
}
