/**
 * omnitron logs [app] [-n N] [-f] [--file] [--level LEVEL] [--grep PATTERN]
 *
 * Reads logs from the daemon (live) or from log files on disk.
 * When daemon is offline, automatically falls back to reading log files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { LogEntryDto } from '../config/types.js';
import { emitJson, emitError, isJsonMode } from './output.js';

const LOG_DIR = path.join(OMNITRON_HOME, 'logs');

/** Pino numeric levels in ascending severity order */
const LEVEL_PRIORITY: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogsOptions {
  lines?: number;
  follow?: boolean;
  file?: boolean;
  /** Minimum log level to display (e.g. 'warn' shows warn + error + fatal) */
  level?: string;
  /** Grep pattern — only show entries whose message matches */
  grep?: string;
}

export async function logsCommand(appName?: string, options: LogsOptions = {}): Promise<void> {
  const lines = options.lines ?? 50;
  const filter = buildFilter(options);

  // --file flag or daemon offline → read from disk.
  // In JSON mode, --follow is unsupported (no streaming JSON contract);
  // fail fast with a structured error.
  if (options.follow && isJsonMode()) {
    emitError('logs --follow is not supported in --json mode (use file-tail or jq instead)');
    return;
  }

  if (options.file) {
    readLogsFromFile(appName, lines, filter);
    return;
  }

  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    await client.disconnect();
    if (!isJsonMode()) log.info('Daemon is not running — reading from log files');
    readLogsFromFile(appName, lines, filter);
    return;
  }

  const query = appName ? { name: appName, lines } : { lines };

  try {

    if (options.follow) {
      let lastTimestamp = 0;

      const poll = async () => {
        try {
          const pollQuery = appName ? { name: appName, lines: 50 } : { lines: 50 };
          const entries = await client.getLogs(pollQuery);
          const newEntries = entries.filter((e) => e.timestamp > lastTimestamp).filter(filter);

          for (const entry of newEntries) {
            printLogEntry(entry);
            lastTimestamp = Math.max(lastTimestamp, entry.timestamp);
          }
        } catch {
          // Connection lost
        }
      };

      // Initial fetch
      const entries = await client.getLogs(query);
      const filtered = entries.filter(filter);
      for (const entry of filtered) {
        printLogEntry(entry);
        lastTimestamp = Math.max(lastTimestamp, entry.timestamp);
      }

      // Continuous polling
      const interval = setInterval(poll, 1000);

      process.on('SIGINT', () => {
        clearInterval(interval);
        client.disconnect();
        process.exit(0);
      });

      await new Promise(() => {});
    } else {
      const entries = await client.getLogs(query);
      const filtered = entries.filter(filter);

      if (emitJson({ app: appName, count: filtered.length, entries: filtered })) {
        await client.disconnect();
        return;
      }

      if (filtered.length === 0) {
        log.info('No logs available');
      } else {
        for (const entry of filtered) {
          printLogEntry(entry);
        }
      }
    }
  } catch (err) {
    emitError((err as Error).message, appName ? { app: appName } : undefined);
  }

  await client.disconnect();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function buildFilter(options: LogsOptions): (entry: LogEntryDto) => boolean {
  const minLevel = options.level ? (LEVEL_PRIORITY[options.level.toLowerCase()] ?? 0) : 0;
  const grepPattern = options.grep ? new RegExp(options.grep, 'i') : null;

  return (entry: LogEntryDto): boolean => {
    // Level filter
    if (minLevel > 0) {
      const entryLevel = LEVEL_PRIORITY[entry.level] ?? 30;
      if (entryLevel < minLevel) return false;
    }
    // Grep filter
    if (grepPattern && !grepPattern.test(entry.message)) {
      return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// File-based log reading (offline mode)
// ---------------------------------------------------------------------------

/** Test-only — exposes the path resolver for unit tests. */
export const __test = { resolveCandidateLogPaths };

/**
 * Resolve candidate log file paths for an app, probing both the
 * standalone and project-mode layouts produced by LogManager
 * (`apps/omnitron/src/monitoring/log-manager.ts:getLogDir`).
 *
 *   - standalone app `messaging`:
 *       ~/.omnitron/logs/messaging/app.log              ← directory layout
 *       ~/.omnitron/logs/messaging.log                  ← legacy flat layout
 *   - project-mode app `omni/dev/messaging`:
 *       ~/.omnitron/projects/omni/dev/logs/messaging/app.log
 *
 * T#76 — pre-fix, the offline fallback only checked the legacy
 * flat `<app>.log`. Project-mode apps and modern standalone apps
 * silently fell through to "no logs found" even when the files
 * were sitting right there on disk.
 */
function resolveCandidateLogPaths(appName: string): string[] {
  const candidates: string[] = [];

  // Project-mode: `omni/dev/messaging` →
  // ~/.omnitron/projects/omni/dev/logs/messaging/app.log
  const parts = appName.split('/');
  if (parts.length >= 3) {
    const [project, stack, ...rest] = parts;
    const app = rest.join('/');
    candidates.push(
      path.join(OMNITRON_HOME, 'projects', project!, stack!, 'logs', app, 'app.log'),
    );
  }

  // Standalone: directory layout used by current LogManager.
  candidates.push(path.join(LOG_DIR, appName, 'app.log'));

  // Legacy: flat <app>.log file layout. Kept for compatibility
  // with pre-LogManager-refactor deployments.
  candidates.push(path.join(LOG_DIR, `${appName}.log`));

  // Last resort: the daemon's own log — operators often expect
  // app activity to surface here too.
  candidates.push(path.join(LOG_DIR, 'omnitron.log'));

  return candidates;
}

/**
 * Read logs from ~/.omnitron/logs/ on disk.
 * Uses reverse reading for large files to avoid loading everything into memory.
 */
function readLogsFromFile(appName?: string, lines = 50, filter: (e: LogEntryDto) => boolean = () => true): void {
  if (!fs.existsSync(LOG_DIR)) {
    log.info(`No log directory found at ${LOG_DIR}`);
    return;
  }

  const logFiles: Array<{ app: string; filePath: string }> = [];

  if (appName) {
    // T#76: probe project-mode + standalone-dir + legacy-flat
    // layouts in order; use the FIRST one that exists.
    const candidates = resolveCandidateLogPaths(appName);
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      logFiles.push({ app: appName, filePath: found });
    } else {
      log.info(`No log file found for app "${appName}" — checked: ${candidates.join(', ')}`);
      return;
    }
  } else {
    // No appName — list every standalone log file in LOG_DIR
    // (both the new directory layout and the legacy flat one).
    // Project-mode apps live under ~/.omnitron/projects/ and are
    // not listed in the no-appName case to keep output bounded.
    const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.log')) {
        // Legacy flat layout — strip the .log extension.
        const app = path.basename(ent.name, '.log');
        logFiles.push({ app, filePath: path.join(LOG_DIR, ent.name) });
      } else if (ent.isDirectory()) {
        // Directory layout — app.log inside per-app folder.
        const candidate = path.join(LOG_DIR, ent.name, 'app.log');
        if (fs.existsSync(candidate)) {
          logFiles.push({ app: ent.name, filePath: candidate });
        }
      }
    }
    if (logFiles.length === 0) {
      log.info(`No log files found in ${LOG_DIR}`);
      return;
    }
  }

  // Read and merge entries from all files
  const entries: LogEntryDto[] = [];

  for (const { app, filePath } of logFiles) {
    const fileEntries = readLastLines(filePath, lines * 3, app, appName);
    entries.push(...fileEntries);
  }

  // Sort by timestamp, apply filter, take last N
  entries.sort((a, b) => a.timestamp - b.timestamp);
  const result = entries.filter(filter).slice(-lines);

  if (emitJson({ source: 'file', app: appName, count: result.length, entries: result })) return;

  if (result.length === 0) {
    log.info('No log entries found');
    return;
  }

  for (const entry of result) {
    printLogEntry(entry);
  }
}

/**
 * Read the last N lines from a log file.
 * For large files (>10MB), reads only from the tail to avoid OOM.
 */
function readLastLines(filePath: string, maxLines: number, app: string, filterApp?: string): LogEntryDto[] {
  try {
    const stat = fs.statSync(filePath);
    const MAX_READ = 10 * 1024 * 1024; // Read at most 10MB from tail

    let content: string;
    if (stat.size > MAX_READ) {
      // Read only the tail of the file
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(MAX_READ);
      fs.readSync(fd, buffer, 0, MAX_READ, stat.size - MAX_READ);
      fs.closeSync(fd);
      content = buffer.toString('utf-8');
      // Skip first partial line
      const firstNewline = content.indexOf('\n');
      if (firstNewline > 0) content = content.slice(firstNewline + 1);
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    const allLines = content.trim().split('\n');
    const tail = allLines.slice(-maxLines);

    const entries: LogEntryDto[] = [];
    for (const line of tail) {
      if (!line.trim()) continue;
      const entry = parseLine(app, line);
      // When filtering by app name in omnitron.log, check the data fields
      if (filterApp && entry.data) {
        const entryApp = entry.data['app'] ?? entry.data['childProcess'];
        if (entryApp && !String(entryApp).toLowerCase().includes(filterApp.toLowerCase())) {
          continue;
        }
      }
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

function parseLine(app: string, line: string): LogEntryDto {
  try {
    const parsed = JSON.parse(line);
    return {
      timestamp: parsed.time ? new Date(parsed.time).getTime() : Date.now(),
      app: parsed.childProcess ?? app,
      level: pinoLevelToString(parsed.level ?? 30),
      message: parsed.msg ?? line,
      data: parsed,
    };
  } catch {
    return {
      timestamp: Date.now(),
      app,
      level: 'info',
      message: line,
    };
  }
}

function pinoLevelToString(level: number): string {
  if (level <= 10) return 'trace';
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  if (level <= 50) return 'error';
  return 'fatal';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function printLogEntry(entry: LogEntryDto): void {
  const time = new Date(entry.timestamp).toISOString().slice(11, 23);
  const level = formatLevel(entry.level);
  const app = prism.cyan(`[${entry.app}]`);

  // Show relevant data fields inline for richer context
  let extra = '';
  if (entry.data) {
    const d = entry.data;
    const fields: string[] = [];
    if (d['module']) fields.push(`module=${d['module']}`);
    if (d['serviceName']) fields.push(`service=${d['serviceName']}`);
    const err = d['err'] as Record<string, unknown> | undefined;
    if (err?.['message']) fields.push(`err=${err['message']}`);
    if (d['error'] && typeof d['error'] === 'string') fields.push(`err=${d['error']}`);
    if (fields.length > 0) extra = ` ${prism.dim(fields.join(' '))}`;
  }

  console.log(`${prism.dim(time)} ${level} ${app} ${entry.message}${extra}`);
}

function formatLevel(level: string): string {
  switch (level) {
    case 'fatal':
    case 'error':
      return prism.red(level.toUpperCase().padEnd(5));
    case 'warn':
      return prism.yellow(level.toUpperCase().padEnd(5));
    case 'info':
      return prism.green(level.toUpperCase().padEnd(5));
    case 'debug':
    case 'trace':
      return prism.dim(level.toUpperCase().padEnd(5));
    default:
      return level.toUpperCase().padEnd(5);
  }
}
