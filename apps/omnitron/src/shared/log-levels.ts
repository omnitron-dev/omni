/** Pino's numbers for the levels it names — the file and the filters speak these. */
export const LEVEL_RANK = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type KnownLevel = keyof typeof LEVEL_RANK;
export const RANKED_LOG_LEVELS: readonly KnownLevel[] = Object.keys(LEVEL_RANK) as KnownLevel[];

/** The level of a line that says nothing about its level. */
export const UNKNOWN_LEVEL = 'unknown';

/** The rank of a level, or `undefined` for one that has no place in the order. */
export function levelRank(level: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? LEVEL_RANK[level as KnownLevel] : undefined;
}

/** Bounds on exact level predicates accepted from CLI, Console and RPC clients. */
export const MAX_QUERY_LEVELS = 64;

export function isQueryLogLevel(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' && value.length <= 256 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}
