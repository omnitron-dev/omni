/**
 * One app's traffic, from what each of its processes reported.
 *
 * Counts add up across processes; latency is the busiest process's — the
 * percentiles of two windows cannot be combined without their samples, and
 * an app's latency is, in practice, its server process's.
 *
 * `undefined` when no process reported traffic: the app has no server
 * process, or its processes run a runtime that does not report it. That is
 * «not reported», and the daemon says so instead of printing zero.
 */

import type { IProcessTraffic } from '@omnitron-dev/titan-pm';

export function combineProcessTraffic(reports: ReadonlyArray<IProcessTraffic | undefined>): IProcessTraffic | undefined {
  let total: IProcessTraffic | undefined;
  for (const report of reports) {
    if (!report) continue;
    if (!total) {
      total = { ...report };
      continue;
    }
    total.requests += report.requests;
    total.serverErrors += report.serverErrors;
    total.clientErrors += report.clientErrors;
    total.probes += report.probes;
    total.active += report.active;
    if ((report.latency?.count ?? 0) > (total.latency?.count ?? 0)) total.latency = report.latency;
  }
  return total;
}
