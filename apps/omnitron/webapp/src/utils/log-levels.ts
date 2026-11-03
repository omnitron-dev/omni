import { RANKED_LOG_LEVELS, UNKNOWN_LEVEL } from '../../../src/shared/log-levels';

export const DEFAULT_LOG_LEVELS: readonly string[] = [...RANKED_LOG_LEVELS, UNKNOWN_LEVEL];

const shortLabels = new Map(Object.entries({
  trace: 'TRC', debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR', fatal: 'FTL', unknown: 'UNK',
}));

export function shortLogLevel(level: string): string {
  return shortLabels.get(level) ?? level.slice(0, 3).toUpperCase();
}
