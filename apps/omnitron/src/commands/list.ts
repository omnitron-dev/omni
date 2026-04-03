/**
 * omnitron ls / omnitron list — Process list with status
 *
 * Shows all managed apps with their sub-process topology.
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

export async function listCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const apps = await client.list();

    if (apps.length === 0) {
      log.info('No apps registered');
      await client.disconnect();
      return;
    }

    // Build rows — main apps + indented sub-processes
    const data: Array<Record<string, string>> = [];

    for (const app of apps) {
      data.push({
        name: `${app.critical ? prism.red('*') : ' '} ${app.name}`,
        status: formatStatus(app.status),
        pid: app.pid ? String(app.pid) : '-',
        port: formatPort(app.port),
        cpu: formatCpu(app.cpu),
        memory: formatMemoryColored(app.memory),
        uptime: formatUptime(app.uptime),
        restarts: formatRestarts(app.restarts),
        instances: app.instances > 1 ? prism.cyan(String(app.instances)) : '1',
        mode: app.mode === 'bootstrap' ? 'boot' : 'classic',
      });

      // Sub-processes indented
      if (app.processes && app.processes.length > 0) {
        for (const proc of app.processes) {
          data.push({
            name: `    ${prism.dim('└')} ${proc.name} ${prism.dim(`(${proc.type})`)}`,
            status: formatStatus(proc.status),
            pid: proc.pid ? String(proc.pid) : '-',
            port: '',
            cpu: formatCpu(proc.cpu),
            memory: formatMemoryColored(proc.memory),
            uptime: formatUptime(proc.uptime),
            restarts: formatRestarts(proc.restarts),
            instances: '',
            mode: '',
          });
        }
      }
    }

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
        { key: 'mode', header: 'MODE', width: 'content' },
      ],
    });

    console.log(prism.dim('  * = critical'));
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
