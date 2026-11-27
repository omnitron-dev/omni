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
import { metricsStorageReading } from '../shared/metrics-storage-reading.js';
import type { IOmnitronMetricsService } from '../shared/dto/services.js';

export async function metricsCommand(appName?: string, options: { localPostgresWaits?: boolean } = {}): Promise<void> {
  const client = createDaemonClient();

  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    if (options.localPostgresWaits) {
      if (appName) throw Error('--local-postgres-waits applies to the control-plane database for all applications');
      const service = await client.service<IOmnitronMetricsService>('OmnitronMetrics');
      const storage = await service.getStorageStatus();
      if (storage.type !== 'postgres') throw Error('The running daemon uses a different metrics storage type: ' + storage.type);
      const { createOmnitronDb } = await import('../database/connection.js');
      const { readMetricsWaits } = await import('../database/metrics-waits.js');
      const db = await createOmnitronDb({ max: 1, connectionTimeoutMillis: 3000, statement_timeout: 3000,
        options: '-c default_transaction_read_only=on', application_name: 'omnitron-metrics-inspection' });
      try {
        const postgres = await readMetricsWaits(db);
        if (!emitJson({ storage, postgres })) {
          log.info(`Metrics storage has ${storage.pendingSamples} samples queued and ${storage.writtenSamples} writes confirmed`);
          log.info(`PostgreSQL estimates ${postgres.table.live} live and ${postgres.table.dead} dead rows in metrics_samples`);
          if (postgres.waits.length) table({
            width: 'auto',
            data: postgres.waits.map(group => ({
              state: group.state, wait: [group.waitType, group.waitEvent].filter(Boolean).join(' / ') || 'No wait reported',
              metrics: group.holdsMetricsLock ? 'yes' : 'no', blocked: group.blocked ? 'yes' : 'no', sessions: String(group.sessions),
            })),
            columns: [{ key: 'state', header: 'STATE' }, { key: 'wait', header: 'WAIT' }, { key: 'metrics', header: 'METRICS TABLE LOCK' },
              { key: 'blocked', header: 'BLOCKED' }, { key: 'sessions', header: 'SESSIONS', align: 'right' }],
          });
          else log.info('No other non-idle sessions visible in this database');
        }
      } finally { await db.destroy(); }
      return;
    }
    const metrics = await client.getMetrics(appName ? { name: appName } : {});
    const storageResult = await client.service<IOmnitronMetricsService>('OmnitronMetrics')
      .then(service => service.getStorageStatus()).then(status => ({ status, error: null }))
      .catch((error: unknown) => ({ status: null, error: error instanceof Error ? error.message : String(error) }));
    const storageReading = metricsStorageReading(storageResult.status);

    if (emitJson({ totals: metrics.totals, apps: metrics.apps, storage: { ...storageResult, ...storageReading } })) {
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
        // A long poll's wait is not in the latency columns; this says how
        // many requests were such waits. `-`: the runtime does not count them.
        held: !measured ? NOT_REPORTED : m.held !== undefined ? String(m.held) : prism.dim('-'),
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
        { key: 'held', header: 'HELD', align: 'right' },
        { key: 'errors', header: 'ERRORS', align: 'right' },
        { key: 'mean', header: 'MEAN', align: 'right' },
        { key: 'p95', header: 'P95', align: 'right' },
        { key: 'p99', header: 'P99', align: 'right' },
      ],
    });

    console.log();
    log.info(`Totals: CPU ${formatCpu(metrics.totals.cpu)}, Memory ${formatMemory(metrics.totals.memory)}`);
    log.info(`${storageReading.summary}. ${storageReading.detail}${storageResult.error ? `. ${storageResult.error}` : ''}`);
    log.info(
      prism.dim(
        `REQUESTS and ERRORS (5xx) since each process started, probes excluded; HELD = of REQUESTS, long polls, whose wait is kept out of the latency; latency over the last minute${
          anyNotReported ? '; n/r = the app did not report traffic (no server process, or an older runtime)' : ''
        }`,
      ),
    );
  } catch (err) {
    emitError((err as Error).message, appName ? { app: appName } : undefined);
    process.exitCode = 1;
  } finally { await client.disconnect(); }
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
