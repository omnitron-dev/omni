import type { LogQueryFilter } from '../shared/dto/logs.js';

const levels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
/** Validate before constructing SQL; limits apply to CLI, Console and RPC alike. */
export function validateLogQuery(filter: LogQueryFilter & { tail?: number }): void {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter))
    throw new Error('A log filter object is required');
  for (const [key, max] of [
    ['limit', 1000],
    ['tail', 10000],
    ['offset', 100000],
  ] as const) {
    const value = filter[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (key === 'offset' ? 0 : 1) || value > max))
      throw new Error(`${key} must be an integer between ${key === 'offset' ? 0 : 1} and ${max}`);
  }
  for (const key of ['app', 'nodeId', 'traceId', 'search'] as const) {
    const value = filter[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > (key === 'search' ? 1024 : 256) || value.includes('\0'))
    )
      throw new Error(`Invalid log ${key}`);
  }
  if (filter.level !== undefined) {
    const values = Array.isArray(filter.level) ? filter.level : [filter.level];
    if (!values.length || values.length > levels.size || values.some((value) => !levels.has(value)))
      throw new Error('Invalid log level');
  }
  if (
    filter.labels !== undefined &&
    (!filter.labels ||
      typeof filter.labels !== 'object' ||
      Array.isArray(filter.labels) ||
      Object.keys(filter.labels).length > 32 ||
      Object.entries(filter.labels).some(
        ([key, value]) => !key || key.length > 128 || typeof value !== 'string' || value.length > 256
      ))
  )
    throw new Error('Invalid log labels');
  for (const key of ['from', 'to'] as const) {
    const value = filter[key];
    if (
      value !== undefined &&
      (!(typeof value === 'string' || value instanceof Date) || !Number.isFinite(new Date(value).getTime()))
    )
      throw new Error(`Invalid log ${key} timestamp`);
  }
  if (filter.from && filter.to && new Date(filter.from) > new Date(filter.to))
    throw new Error('Log from must not follow to');
}
