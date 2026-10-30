import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { IHealthCheck, IHealthStatus } from '@omnitron-dev/titan-pm';
import type { IEcosystemAppEntry } from '../config/types.js';
import { worstVerdict } from '../orchestrator/app-health.js';
import { validateReadiness, validateHeartbeat, type AppReadinessConfig, type ReadinessProbe } from './contracts.js';

const MAX_BODY = 64 * 1024;
const verdict = (checks: IHealthCheck[]): IHealthStatus['status'] =>
  checks.some((c) => c.status === 'fail') ? 'unhealthy' : checks.some((c) => c.status === 'warn') ? 'degraded' : 'healthy';

async function httpProbe(probe: Extract<ReadinessProbe, { type: 'http' }>, timeout: number): Promise<IHealthCheck[]> {
  const url = new URL(probe.url);
  const target = url.origin + url.pathname; // Query strings can contain credentials; never return them.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const fail = (message: string): IHealthCheck[] => [{ name: probe.name, status: 'fail', message }];
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    response = await fetch(probe.url, { signal: controller.signal, redirect: 'manual' });
    if (response.status !== (probe.expectedStatus ?? 200)) return fail(`http_status: ${target} returned ${response.status}; expected ${probe.expectedStatus ?? 200}. Inspect the application's health endpoint and logs.`);
    if (probe.expect) {
      reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > MAX_BODY) return fail(`http_body_too_large: ${target} exceeded the 64 KiB diagnostic limit.`);
          chunks.push(part.value);
        }
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return fail(`http_invalid_json: ${target} did not return the declared JSON health contract.`); }
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.entries(probe.expect).some(([key, expected]) => !Object.hasOwn(value as object, key) || (value as Record<string, unknown>)[key] !== expected)) {
        return fail(`http_contract_mismatch: ${target} answered successfully but its declared health fields or build identity differ. Check the application's readiness and deployed artifact.`);
      }
    }
    return [{ name: probe.name, status: 'pass', message: `${target} answered ${response.status}${probe.expect ? ' with the declared health fields' : ''}.` }];
  } catch (error) {
    const code = (error as { cause?: { code?: unknown } })?.cause?.code;
    const cause = typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'connection failed';
    return fail(`http_unavailable: ${target} ${controller.signal.aborted ? `did not answer within ${timeout} ms` : cause}. Check the process, listener and network.`);
  } finally {
    controller.abort();
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
    else await response?.body?.cancel().catch(() => {});
  }
}

async function heartbeatProbe(probe: Extract<ReadinessProbe, { type: 'heartbeat' }>, cwd: string, runId: string | undefined): Promise<IHealthCheck[]> {
  const fail = (message: string): IHealthCheck[] => [{ name: probe.name, status: 'fail', message }];
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Nonblocking + no symlink following: a FIFO or substituted special file cannot hang a health call.
    file = await open(path.resolve(cwd, probe.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BODY) return fail('heartbeat_invalid_file: expected a regular report file no larger than 64 KiB.');
    const buffer = Buffer.alloc(MAX_BODY + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await file.read(buffer, size, buffer.length - size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size > MAX_BODY) return fail('heartbeat_invalid_file: the report exceeded 64 KiB while reading.');
    const value: unknown = JSON.parse(buffer.subarray(0, size).toString('utf8'));
    validateHeartbeat(value);
    if (!runId || value.runId !== runId) return fail('heartbeat_wrong_run: the report does not belong to this process launch. Await its first completed cycle; verify OMNITRON_RUN_ID is propagated to child workers.');
    const now = Date.now();
    if (value.timestamp > now) return fail('heartbeat_future: the report timestamp is in the future. Correct the worker clock; future reports cannot establish freshness.');
    if (now - value.timestamp >= probe.maxAgeMs) return fail(`heartbeat_stale: no completed report within ${probe.maxAgeMs} ms; last report ${new Date(value.timestamp).toISOString()}. Inspect the worker's last cycle and dependency failures.`);
    const checks: IHealthCheck[] = (value.checks ?? []).map((check) => ({ ...check, name: `${probe.name}: ${check.name}` }));
    const status = worstVerdict([value.status, verdict(checks)]);
    if (status !== verdict(checks)) checks.push({ name: probe.name, status: status === 'unhealthy' ? 'fail' : 'warn', message: `The worker reports ${value.status}; inspect its cycle logs.` });
    checks.unshift({ name: `${probe.name}: freshness`, status: 'pass', message: `This launch reported at ${new Date(value.timestamp).toISOString()}; maximum age ${probe.maxAgeMs} ms.` });
    return checks;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return fail(code === 'ENOENT'
      ? 'heartbeat_missing: this worker has not published a cycle report. Configure writeHealthHeartbeat or the versioned heartbeat contract.'
      : 'heartbeat_unreadable: the report is unavailable or invalid. Check file permissions, schema and atomic publication; no successful work is inferred.');
  } finally { await file?.close().catch(() => {}); }
}

/** Exposed for preflight checks. Every measurement is bounded and returns actionable failures. */
export async function checkReadiness(config: AppReadinessConfig | undefined, cwd: string, runId?: string): Promise<IHealthStatus> {
  if (!config) return { timestamp: Date.now(), status: 'degraded', checks: [{ name: 'readiness', status: 'warn', message: 'readiness_not_configured: this classic application has no process health channel. Declare readiness.probes in its ecosystem entry; online alone proves only that the process runs.' }] };
  try { validateReadiness(config); }
  catch { return { timestamp: Date.now(), status: 'unhealthy', checks: [{ name: 'readiness', status: 'fail', message: 'readiness_invalid: correct the application readiness configuration; supported probes are http and heartbeat.' }] }; }
  const checks: IHealthCheck[] = [];
  // Four probes at a time; a large declaration cannot create unbounded socket fan-out.
  for (let offset = 0; offset < config.probes.length; offset += 4) {
    const answers = await Promise.all(config.probes.slice(offset, offset + 4).map((probe) => probe.type === 'http'
      ? httpProbe(probe, config.timeoutMs ?? 3000)
      : heartbeatProbe(probe, cwd, runId)));
    checks.push(...answers.flat());
  }
  return { timestamp: Date.now(), status: verdict(checks), checks };
}

/** Per-launch/config cache with shared in-flight work; a re-read never reuses an old declaration's verdict. */
export class ReadinessMonitor {
  private readonly cache = new WeakMap<object, { key: string; expires: number; result?: IHealthStatus; pending?: Promise<IHealthStatus> }>();

  check(owner: object, entry: IEcosystemAppEntry, runId?: string): Promise<IHealthStatus> {
    const key = JSON.stringify([entry.cwd, entry.readiness, runId]);
    let cached = this.cache.get(owner);
    if (cached?.key === key) {
      if (cached.pending) return cached.pending;
      if (cached.result && Date.now() < cached.expires) return Promise.resolve(cached.result);
    }
    cached = { key, expires: 0 };
    this.cache.set(owner, cached);
    const current = cached;
    const pending = checkReadiness(entry.readiness, entry.cwd ?? process.cwd(), runId).then((result) => {
      current.result = result;
      current.expires = Date.now() + (entry.readiness?.intervalMs ?? 5000);
      return result;
    }).finally(() => { delete current.pending; });
    current.pending = pending;
    return pending;
  }
}
