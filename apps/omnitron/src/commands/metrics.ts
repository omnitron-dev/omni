/**
 * omnitron metrics [app] — CPU/memory/latency performance metrics
 *
 * Shows per-app resource usage with color-coded thresholds.
 */

import { table, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { formatMemoryColored, formatCpu, formatMemory } from '../shared/format.js';

export async function metricsCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const metrics = await client.getMetrics(appName ? { name: appName } : {});

    const data = Object.entries(metrics.apps).map(([name, m]) => ({
      name,
      cpu: formatCpu(m.cpu),
      memory: formatMemoryColored(m.memory),
      requests: m.requests != null && m.requests > 0 ? String(m.requests) : prism.dim('-'),
      errors: formatErrors(m.errors),
      mean: m.latency ? formatLatency(m.latency.mean) : prism.dim('-'),
      p95: m.latency ? formatLatency(m.latency.p95) : prism.dim('-'),
      p99: m.latency ? formatLatency(m.latency.p99) : prism.dim('-'),
    }));

    table({
      data,
      columns: [
        { key: 'name', header: 'NAME' },
        { key: 'cpu', header: 'CPU', align: 'right' },
        { key: 'memory', header: 'MEMORY', align: 'right' },
        { key: 'requests', header: 'REQUESTS', align: 'right' },
        { key: 'errors', header: 'ERRORS', align: 'right' },
        { key: 'mean', header: 'MEAN', align: 'right' },
        { key: 'p95', header: 'P95', align: 'right' },
        { key: 'p99', header: 'P99', align: 'right' },
      ],
    });

    console.log();
    log.info(`Totals: CPU ${formatCpu(metrics.totals.cpu)}, Memory ${formatMemory(metrics.totals.memory)}`);
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}

function formatLatency(ms: number): string {
  const text = `${ms.toFixed(1)}ms`;
  if (ms >= 1000) return prism.red(text);
  if (ms >= 500) return prism.yellow(text);
  return text;
}

function formatErrors(errors?: number): string {
  if (errors == null || errors === 0) return prism.dim('-');
  if (errors >= 10) return prism.red(String(errors));
  return prism.yellow(String(errors));
}
