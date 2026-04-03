/**
 * omnitron monit — Live TUI monitoring dashboard
 *
 * Real-time process table with color-coded thresholds.
 */

import { table, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import {
  formatStatus,
  formatMemoryColored,
  formatUptime,
  formatCpu,
  formatRestarts,
  formatPort,
} from '../shared/format.js';
import { formatMemory } from '../shared/format.js';

export async function monitCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  console.clear();


  const render = async () => {
    try {
      const status = await client.status();

      const onlineCount = status.apps.filter((a) => a.status === 'online').length;
      const errorCount = status.apps.filter((a) => a.status === 'errored' || a.status === 'crashed').length;

      // Header
      // Clear terminal and move cursor to top (TUI refresh)
      process.stdout.write('\x1b[H\x1b[2J');

      const statusStr =
        errorCount > 0
          ? `${prism.green(String(onlineCount))} online  ${prism.red(String(errorCount))} errors`
          : `${prism.green(String(onlineCount))} online`;

      console.log(
        `${prism.bold('Omnitron Monitor')}  ${prism.dim('|')}  ${statusStr}  ${prism.dim('|')}  ` +
          `CPU: ${formatCpu(status.totalCpu)}  Mem: ${formatMemoryColored(status.totalMemory)}  ${prism.dim('|')}  ` +
          `PID: ${status.pid}  Up: ${formatUptime(status.uptime)}  ${prism.dim('|')}  [q]uit`
      );
      console.log();

      const data = status.apps.map((app) => ({
        name: `${app.critical ? prism.red('*') : ' '} ${app.name}`,
        status: formatStatus(app.status),
        pid: app.pid ? String(app.pid) : '-',
        port: formatPort(app.port),
        cpu: formatCpu(app.cpu),
        memory: formatMemoryColored(app.memory),
        uptime: formatUptime(app.uptime),
        restarts: formatRestarts(app.restarts),
        instances: app.instances > 1 ? prism.cyan(String(app.instances)) : '1',
      }));

      table({
        data,
        columns: [
          { key: 'name', header: 'NAME', width: 'content' },
          { key: 'status', header: 'STATUS', width: 'content' },
          { key: 'pid', header: 'PID', width: 'content' },
          { key: 'port', header: 'PORT', width: 'content' },
          { key: 'cpu', header: 'CPU', align: 'right' },
          { key: 'memory', header: 'MEMORY', align: 'right' },
          { key: 'uptime', header: 'UPTIME', width: 'content' },
          { key: 'restarts', header: 'RST', align: 'right' },
        ],
      });

      console.log();
      console.log(
        prism.dim(
          `  Totals: CPU ${status.totalCpu.toFixed(1)}%  |  Memory ${formatMemory(status.totalMemory)}  |  ` +
            `${status.apps.length} apps  |  Refresh: 2s`
        )
      );
    } catch {
      log.error('Lost connection to daemon');
    }
  };

  // Initial render
  await render();

  // Refresh every 2 seconds
  const interval = setInterval(render, 2000);

  // Listen for quit
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', async (chunk: Buffer) => {
      const key = chunk.toString();
      if (key === 'q' || key === '\x03') {
        clearInterval(interval);
        process.stdin.setRawMode(false);
        await client.disconnect();
        console.clear();
        process.exit(0);
      }
    });
  }

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await client.disconnect();
    process.exit(0);
  });
}
