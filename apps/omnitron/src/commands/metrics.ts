/**
 * omnitron metrics [app] — CPU/memory/latency performance metrics
 *
 * Shows per-app resource usage with color-coded thresholds.
 */

import { table, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { formatMemoryColored, formatCpu, formatMemory } from '../shared/format.js';
import { emitJson, emitError } from './output.js';
import { requireDaemon } from './daemon-required.js';

export async function metricsCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const metrics = await client.getMetrics(appName ? { name: appName } : {});

    if (emitJson({ totals: metrics.totals, apps: metrics.apps })) {
      await client.disconnect();
      return;
    }

    // Three different things were all printed as «-»: an app that reported
    // no traffic, an app with zero requests, and an app idle for the last
    // minute. `n/r` is the first (not reported — no server process, or a
    // daemon/runtime too old to say); `0` is the second; `-` in the latency
    // columns is the third.
    const NOT_REPORTED = prism.dim('n/r');
    let anyNotReported = false;
    const data = Object.entries(metrics.apps).map(([name, m]) => {
      // A daemon on an older build answers without `traffic`: not reported.
      const measured = m.traffic === 'measured';
      if (!measured) anyNotReported = true;
      const latency = measured ? m.latency : undefined;
      return {
        name,
        cpu: formatCpu(m.cpu),
        memory: formatMemoryColored(m.memory),
        requests: measured ? String(m.requests ?? 0) : NOT_REPORTED,
        errors: measured ? formatErrors(m.errors) : NOT_REPORTED,
        mean: !measured ? NOT_REPORTED : latency ? formatLatency(latency.mean) : prism.dim('-'),
        p95: !measured ? NOT_REPORTED : latency ? formatLatency(latency.p95) : prism.dim('-'),
        p99: !measured ? NOT_REPORTED : latency ? formatLatency(latency.p99) : prism.dim('-'),
      };
    });

    table({
      width: 'auto',
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
    log.info(
      prism.dim(
        `REQUESTS and ERRORS (5xx) since each process started, probes excluded; latency over the last minute${
          anyNotReported ? '; n/r = the app did not report traffic (no server process, or an older runtime)' : ''
        }`,
      ),
    );
  } catch (err) {
    emitError((err as Error).message, appName ? { app: appName } : undefined);
    process.exitCode = 1;
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
  if (errors == null || errors === 0) return prism.dim('0');
  if (errors >= 10) return prism.red(String(errors));
  return prism.yellow(String(errors));
}
