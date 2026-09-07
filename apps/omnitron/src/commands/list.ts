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
import { emitJson, emitError, isJsonMode } from './output.js';

export async function listCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    if (isJsonMode()) {
      emitError('Daemon is not running');
    } else {
      log.warn('Daemon is not running');
    }
    await client.disconnect();
    return;
  }

  try {
    const apps = await client.list();
    if (emitJson({ apps })) {
      await client.disconnect();
      return;
    }

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
          // A pool row prints ONE pid for several processes. Without the
          // count the row reads as a single worker, and the `-` under RST
          // (nothing counts a pool's restarts) has nothing to explain it.
          // Drift from the declaration is coloured rather than hidden —
          // `doctor` reports it as a finding, but the table is where an
          // operator looks first.
          const scale =
            proc.declaredInstances > 1
              ? proc.instances === proc.declaredInstances
                ? prism.dim(` \u00d7${proc.instances}`)
                : prism.yellow(` \u00d7${proc.instances}/${proc.declaredInstances}`)
              : '';
          data.push({
            name: `    ${prism.dim('└')} ${proc.name} ${prism.dim(`(${proc.type})`)}${scale}`,
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
      // 'auto' sizes to content. The default is 'full', which fits the table
      // to the terminal by dividing what is left after the widest column —
      // with nine columns and an 80-column terminal that leaves about five
      // characters each, so every value AND every header rendered as an
      // ellipsis. The primary command of the tool was unreadable.
      width: 'auto',
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
