/**
 * Health DTOs — wire shapes shared with the Omnitron Console.
 *
 * Declared away from the service implementation for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators and
 * the server's dependency graph into the console's build.
 */

export interface HealthCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string | undefined;
  duration?: number | undefined;
}

export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  timestamp: string;
  duration: number;
}

export interface PlatformHealthReport {
  apps: HealthReport;
  infra: HealthReport;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
}

export interface HealthCheckRow {
  nodeId: string;
  checkedAt: string;
  checkDurationMs: number;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError: string | null;
  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError: string | null;
  /** `null` when the check measured nothing about omnitron — see migration 009. */
  omnitronConnected: boolean | null;
  omnitronVersion: string | null;
  omnitronPid: number | null;
  omnitronUptime: number | null;
  omnitronRole: string | null;
  omnitronError: string | null;
  os: { platform: string; arch: string; hostname: string; release: string } | null;
}

/**
 * Uptime bar bucket — aggregated over `intervalMs`.
 *
 * `uptimePct`: 0.0 = fully down, 1.0 = fully up during this bucket.
 * Frontend maps this to a green→red color gradient.
 */
export interface UptimeBucket {
  /** Bucket start (ISO) */
  t: string;
  /** PING uptime 0.0–1.0 */
  ping: number;
  /**
   * OMNITRON uptime over the checks that could measure it, or -1 when none
   * could.
   *
   * Not every check is a measurement. One that found no omnitron installed is
   * not evidence of downtime — there is nothing there to be down — one whose
   * SSH was refused did not get far enough to look, and one that looked and
   * could not read the answer (a timeout, output that was not JSON) learnt
   * nothing either. Both used to sit in
   * the denominator, where they pulled the figure towards zero in proportion
   * to how many of them there were, and the console painted the result red.
   * Observed: a node with 60 "not installed" checks and 13 SSH failures in one
   * day, summarised as "OMNITRON 0%" — which reads as an outage, of software
   * that was never installed.
   */
  omnitron: number;
  /** Total checks in this bucket, measurements or not. */
  checks: number;
  /**
   * When `omnitron` is -1 and checks ran, what those checks actually found:
   * no omnitron installed, no way in, or a way in and nothing read.
   */
  omnitronUnmeasured?: 'absent' | 'unreachable' | 'unread';
}
