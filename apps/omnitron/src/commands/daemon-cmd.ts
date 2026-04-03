/**
 * omnitron daemon start|stop|ping|kill
 */

import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, spinner } from '@xec-sh/kit';
import { PidManager } from '../daemon/pid-manager.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { OmnitronDaemon } from '../daemon/daemon.js';
import { formatUptime } from '../shared/format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function daemonStart(options: { foreground?: boolean; config?: string } = {}): Promise<void> {
  const dc = DEFAULT_DAEMON_CONFIG;
  const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
  const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
  const pidManager = new PidManager(pidFile);

  if (pidManager.isRunning()) {
    const pid = pidManager.getPid();
    log.warn(`Daemon already running (PID: ${pid})`);
    return;
  }

  // Clean up stale PID/socket from a crashed daemon
  if (pidManager.cleanupStale(socketPath)) {
    log.info('Cleaned up stale state from a previously crashed daemon');
  }

  if (options.foreground) {
    const { loadEcosystemConfig } = await import('../config/loader.js');
    const { defineEcosystem } = await import('../config/define-ecosystem.js');
    let config;
    try {
      config = await loadEcosystemConfig();
    } catch {
      config = defineEcosystem({ apps: [] });
    }
    const daemon = new OmnitronDaemon();
    await daemon.start(config);
    return;
  }

  const s = spinner();
  s.start('Starting Omnitron daemon...');

  const daemonScript = path.resolve(__dirname, '../daemon/daemon-entry.js');
  const child = fork(daemonScript, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, OMNITRON_CWD: process.cwd() },
    execArgv: ['--import', 'tsx/esm'],
  });

  child.unref();

  // Wait for daemon to be reachable via Unix socket
  const client = createDaemonClient(socketPath);
  const maxWait = 15_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (await client.isReachable()) {
      const info = await client.ping();
      s.stop(`Daemon started (PID: ${info.pid}, socket: ${socketPath})`);
      await client.disconnect();
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  s.stop('Daemon may have started — could not verify connectivity');
  await client.disconnect();
}

export async function daemonStop(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    // Socket not responding — try PID-based cleanup as fallback
    const dc = DEFAULT_DAEMON_CONFIG;
    const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
    const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
    const pidManager = new PidManager(pidFile);
    const pid = pidManager.getPid();

    if (pid) {
      log.info(`Socket unreachable but daemon alive (PID: ${pid}), sending SIGTERM...`);
      try {
        process.kill(pid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 3000));
        if (!PidManager.isProcessAlive(pid)) {
          pidManager.remove();
          log.success('Daemon stopped via SIGTERM');
        } else {
          process.kill(pid, 'SIGKILL');
          pidManager.remove();
          log.success(`Daemon force-killed (PID: ${pid})`);
        }
      } catch {
        pidManager.cleanupStale(socketPath);
        log.warn('Daemon process already dead — cleaned up stale state');
      }
    } else {
      pidManager.cleanupStale(socketPath);
      log.warn('Daemon is not running');
    }

    await client.disconnect();
    return;
  }

  const dc = DEFAULT_DAEMON_CONFIG;
  const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
  const pidManager = new PidManager(pidFile);
  const pid = pidManager.getPid();

  const s = spinner();
  s.start('Stopping Omnitron daemon...');

  try {
    await client.shutdown({ force: false });
  } catch {
    // Connection may close before response — expected during shutdown
  }

  await client.disconnect();

  // Wait for process to actually exit (up to 20s — graceful shutdown needs time for parallel infra teardown)
  if (pid) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && PidManager.isProcessAlive(pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }

    if (PidManager.isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL');
      s.stop(`Daemon force-killed (PID: ${pid})`);
    } else {
      s.stop('Daemon stopped');
    }
  } else {
    s.stop('Daemon stopped');
  }

  // Clean up stale files
  pidManager.remove();
}

export async function daemonPing(): Promise<void> {
  const client = createDaemonClient();

  try {
    const info = await client.ping();
    log.success(`Daemon is running (PID: ${info.pid}, uptime: ${formatUptime(info.uptime)}, v${info.version})`);
  } catch {
    log.error('Daemon is not running');
  }

  await client.disconnect();
}

export async function daemonKill(): Promise<void> {
  const dc = DEFAULT_DAEMON_CONFIG;
  const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
  const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
  const pidManager = new PidManager(pidFile);
  const rawPid = pidManager.readPid();

  if (!rawPid) {
    log.warn('No daemon process found');
    return;
  }

  if (!PidManager.isProcessAlive(rawPid)) {
    pidManager.cleanupStale(socketPath);
    log.warn(`Daemon (PID: ${rawPid}) was already dead — cleaned up stale files`);
    return;
  }

  try {
    process.kill(rawPid, 'SIGKILL');
    pidManager.remove();
    // Also clean up socket since SIGKILL prevents graceful cleanup
    if (socketPath) {
      try {
        const fs = await import('node:fs');
        fs.unlinkSync(socketPath);
      } catch {
        /* may not exist */
      }
    }
    log.success(`Killed daemon (PID: ${rawPid})`);
  } catch (err) {
    log.error(`Failed to kill PID ${rawPid}: ${(err as Error).message}`);
  }
}
