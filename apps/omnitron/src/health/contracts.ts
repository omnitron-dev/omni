import type { AppHealthAnswer } from '../config/types.js';

export type ReadinessProbe =
  | { name: string; type: 'http'; url: string; expectedStatus?: number; expect?: Record<string, string | number | boolean | null> }
  | { name: string; type: 'heartbeat'; file: string; maxAgeMs: number };

/** Explicit external readiness for applications without a Titan process health channel. */
export interface AppReadinessConfig {
  probes: ReadinessProbe[];
  /** Results are reused for this long; concurrent callers share one measurement. Default 5 seconds. */
  intervalMs?: number;
  /** Bound each HTTP probe. Default 3 seconds; maximum 10 seconds. */
  timeoutMs?: number;
}

export interface HealthHeartbeat extends AppHealthAnswer {
  schemaVersion: 1;
  timestamp: number;
  /** Supplied by the supervisor; prevents a previous process's report passing a new launch. */
  runId: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
  !Array.from(value).some(character => character.charCodeAt(0) < 32);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

export function validateReadiness(value: unknown): asserts value is AppReadinessConfig {
  if (!object(value) || !only(value, ['probes', 'intervalMs', 'timeoutMs']) ||
      (value['intervalMs'] !== undefined && !integer(value['intervalMs'], 1000, 300_000)) ||
      (value['timeoutMs'] !== undefined && !integer(value['timeoutMs'], 100, 10_000)) ||
      !Array.isArray(value['probes']) || value['probes'].length < 1 || value['probes'].length > 16) {
    throw new Error('readiness_invalid: declare 1–16 probes, intervalMs 1000–300000 and timeoutMs 100–10000.');
  }
  const names = new Set<string>();
  let heartbeat = false;
  for (const probe of value['probes']) {
    if (!object(probe) || !text(probe['name'], 100) || names.has(probe['name'])) throw new Error('readiness_invalid: probe names must be nonempty and unique.');
    names.add(probe['name']);
    if (probe['type'] === 'http') {
      if (!only(probe, ['name', 'type', 'url', 'expectedStatus', 'expect']) || !text(probe['url'], 2048) ||
          (probe['expectedStatus'] !== undefined && !integer(probe['expectedStatus'], 200, 299))) throw new Error('readiness_invalid: HTTP probes require a URL and a successful expectedStatus.');
      let url: URL;
      try { url = new URL(probe['url']); } catch { throw new Error('readiness_invalid: invalid HTTP URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('readiness_invalid: use HTTP(S) without URL credentials or fragments.');
      if (probe['expect'] !== undefined && (!object(probe['expect']) || Object.keys(probe['expect']).length === 0 || Object.keys(probe['expect']).length > 16 ||
        Object.entries(probe['expect']).some(([key, v]) => !text(key, 100) || !['string', 'number', 'boolean'].includes(typeof v) && v !== null ||
          typeof v === 'number' && !Number.isFinite(v) || typeof v === 'string' && v.length > 1000))) throw new Error('readiness_invalid: expect must contain 1–16 JSON scalar fields.');
    } else if (probe['type'] === 'heartbeat') {
      if (heartbeat) throw new Error('readiness_invalid: declare one heartbeat channel per application; combine worker checks in its report.');
      heartbeat = true;
      if (!only(probe, ['name', 'type', 'file', 'maxAgeMs']) || !text(probe['file'], 2048) || !integer(probe['maxAgeMs'], 1000, 86_400_000)) throw new Error('readiness_invalid: heartbeat requires a file and maxAgeMs 1000–86400000.');
    } else throw new Error('readiness_invalid: supported probe types are http and heartbeat.');
  }
}

export function validateHeartbeat(value: unknown): asserts value is HealthHeartbeat {
  if (!object(value) || value['schemaVersion'] !== 1 || !text(value['runId'], 128) ||
      !integer(value['timestamp'], 0, 8_640_000_000_000_000) || !['healthy', 'degraded', 'unhealthy'].includes(String(value['status'])) ||
      !Array.isArray(value['checks']) || value['checks'].length < 1 || value['checks'].length > 32 ||
      value['checks'].some((check) => !object(check) || !text(check['name'], 100) || !['pass', 'warn', 'fail'].includes(String(check['status'])) ||
        check['message'] !== undefined && !text(check['message'], 1000))) throw new Error('heartbeat_invalid: expected a versioned report with timestamp, runId and named checks.');
}
