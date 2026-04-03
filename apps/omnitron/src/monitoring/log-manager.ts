/**
 * LogManager — Project-scoped log routing, error log separation, per-app rotation
 *
 * Directory layout:
 *   ~/.omnitron/logs/omnitron.log          — daemon all-level log
 *   ~/.omnitron/logs/omnitron.error.log    — daemon error+fatal only
 *   ~/.omnitron/projects/{project}/{stack}/logs/{app}/app.log
 *   ~/.omnitron/projects/{project}/{stack}/logs/{app}/error.log
 *   ~/.omnitron/logs/{app}/app.log         — standalone (no project context)
 *   ~/.omnitron/logs/{app}/error.log
 */

import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { LogEntryDto } from '../config/types.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogRotationConfig {
  maxSize: string;
  maxFiles: number;
  compress: boolean;
}

export interface LogManagerConfig {
  baseDir: string;                                       // ~/.omnitron
  defaults: LogRotationConfig;                           // Global defaults
  perApp?: Map<string, Partial<LogRotationConfig>>;      // Per-app overrides (keyed by short name)
}

/** @deprecated Use LogManagerConfig instead */
export type LegacyLogManagerConfig = {
  directory: string;
  maxSize: string;
  maxFiles: number;
  compress: boolean;
};

type LogType = 'app' | 'error';

// ---------------------------------------------------------------------------
// LogManager
// ---------------------------------------------------------------------------

export class LogManager {
  private readonly baseDir: string;
  private readonly defaults: LogRotationConfig;
  private readonly perApp: Map<string, Partial<LogRotationConfig>>;
  private rotationCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    config: LogManagerConfig | LegacyLogManagerConfig,
    private readonly orchestrator: OrchestratorService,
  ) {
    // Support both new and legacy config shapes
    if ('baseDir' in config) {
      this.baseDir = config.baseDir.replace('~', process.env['HOME'] ?? '');
      this.defaults = config.defaults;
      this.perApp = config.perApp ?? new Map();
    } else {
      // Legacy compat: directory pointed to ~/.omnitron/logs
      this.baseDir = config.directory.replace('~', process.env['HOME'] ?? '').replace(/\/logs\/?$/, '');
      this.defaults = { maxSize: config.maxSize, maxFiles: config.maxFiles, compress: config.compress };
      this.perApp = new Map();
    }

    // Ensure base log dir exists
    fs.mkdirSync(path.join(this.baseDir, 'logs'), { recursive: true });

    // Periodic rotation check for daemon's own log files (every 60s)
    this.rotationCheckTimer = setInterval(() => {
      this.checkRotation('omnitron', 'app');
      this.checkRotation('omnitron', 'error');
    }, 60_000);
    this.rotationCheckTimer.unref();
  }

  dispose(): void {
    if (this.rotationCheckTimer) {
      clearInterval(this.rotationCheckTimer);
      this.rotationCheckTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Path resolution — project-scoped directories
  // -------------------------------------------------------------------------

  /**
   * Resolve the log directory for an app.
   *
   * - `"omnitron"` → `~/.omnitron/logs/`
   * - `"project/stack/app"` → `~/.omnitron/projects/{project}/{stack}/logs/{app}/`
   * - `"app"` (standalone) → `~/.omnitron/logs/{app}/`
   */
  getLogDir(appName: string): string {
    if (appName === 'omnitron') {
      return path.join(this.baseDir, 'logs');
    }

    const parts = appName.split('/');
    if (parts.length >= 3) {
      const [project, stack, ...rest] = parts;
      const app = rest.join('/');
      return path.join(this.baseDir, 'projects', project!, stack!, 'logs', app);
    }

    // Standalone app
    return path.join(this.baseDir, 'logs', appName);
  }

  /**
   * Full file path for a log type.
   *
   * - Daemon: `omnitron.log` / `omnitron.error.log`
   * - Apps: `app.log` / `error.log`
   */
  getLogFilePath(appName: string, type: LogType = 'app'): string {
    const dir = this.getLogDir(appName);
    fs.mkdirSync(dir, { recursive: true });

    if (appName === 'omnitron') {
      return path.join(dir, type === 'error' ? 'omnitron.error.log' : 'omnitron.log');
    }
    return path.join(dir, type === 'error' ? 'error.log' : 'app.log');
  }

  // -------------------------------------------------------------------------
  // Per-app rotation config
  // -------------------------------------------------------------------------

  private getRotationConfig(appName: string): LogRotationConfig {
    const shortName = appName.includes('/') ? appName.split('/').pop()! : appName;
    const override = this.perApp.get(shortName) ?? this.perApp.get(appName);
    return {
      maxSize: override?.maxSize ?? this.defaults.maxSize,
      maxFiles: override?.maxFiles ?? this.defaults.maxFiles,
      compress: override?.compress ?? this.defaults.compress,
    };
  }

  private getMaxSizeBytes(appName: string): number {
    return this.parseSize(this.getRotationConfig(appName).maxSize);
  }

  // -------------------------------------------------------------------------
  // Write + dual-file routing
  // -------------------------------------------------------------------------

  /**
   * Append a log line to the app's log files.
   *
   * - Always writes to `app.log` (all levels).
   * - If the line is error or fatal, also writes to `error.log`.
   */
  appendToFile(appName: string, line: string): void {
    // All levels → app.log
    const appPath = this.getLogFilePath(appName, 'app');
    fs.appendFileSync(appPath, line + '\n', 'utf-8');
    this.checkAndRotate(appName, 'app', appPath);

    // error + fatal → error.log
    if (this.isErrorOrFatal(line)) {
      const errorPath = this.getLogFilePath(appName, 'error');
      fs.appendFileSync(errorPath, line + '\n', 'utf-8');
      this.checkAndRotate(appName, 'error', errorPath);
    }
  }

  /**
   * Fast level extraction from pino JSON without full parse.
   * Pino levels: 50=error, 60=fatal.
   */
  private isErrorOrFatal(line: string): boolean {
    // Fast path: look for "level":50 or "level":60 in raw JSON
    const idx = line.indexOf('"level":');
    if (idx === -1) return false;
    const numStart = idx + 8;
    // Skip whitespace
    let i = numStart;
    while (i < line.length && line[i] === ' ') i++;
    const num = parseInt(line.slice(i), 10);
    return num >= 50;
  }

  // -------------------------------------------------------------------------
  // Rotation
  // -------------------------------------------------------------------------

  checkRotation(appName: string, type: LogType = 'app'): void {
    const filePath = this.getLogFilePath(appName, type);
    const maxBytes = this.getMaxSizeBytes(appName);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= maxBytes) {
        this.rotateLog(appName, type);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private checkAndRotate(appName: string, type: LogType, filePath: string): void {
    const maxBytes = this.getMaxSizeBytes(appName);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= maxBytes) {
        this.rotateLog(appName, type);
      }
    } catch {
      // File may not exist yet
    }
  }

  /** Callbacks invoked after a log file is rotated — used to reopen pino streams */
  private readonly onRotateCallbacks: Array<(appName: string, filePath: string) => void> = [];

  onRotate(callback: (appName: string, filePath: string) => void): void {
    this.onRotateCallbacks.push(callback);
  }

  /**
   * Rotate log file: rename current → .1, .1 → .2, etc.
   * Remove files beyond maxFiles. Compress rotated files when enabled.
   */
  rotateLog(appName: string, type: LogType = 'app'): void {
    const basePath = this.getLogFilePath(appName, type);
    const config = this.getRotationConfig(appName);
    const ext = config.compress ? '.gz' : '';

    // Shift rotated files: .{maxFiles-1} removed, .{i-1} → .{i}
    for (let i = config.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? basePath : `${basePath}.${i - 1}${ext}`;
      const to = `${basePath}.${i}${ext}`;

      try {
        if (i === config.maxFiles - 1) {
          try { fs.unlinkSync(to); } catch { /* doesn't exist */ }
        }
        fs.renameSync(from, to);
      } catch {
        // Source doesn't exist — skip
      }
    }

    // Rename current → .1
    try { fs.renameSync(basePath, `${basePath}.1`); } catch { /* no current file */ }

    // Create fresh empty log file
    try { fs.writeFileSync(basePath, '', 'utf-8'); } catch { /* non-critical */ }

    // Notify listeners (pino stream reopening)
    for (const cb of this.onRotateCallbacks) {
      try { cb(appName, basePath); } catch { /* non-critical */ }
    }

    // Compress the .1 file asynchronously
    if (config.compress) {
      const rotatedPath = `${basePath}.1`;
      if (fs.existsSync(rotatedPath)) {
        this.compressFile(rotatedPath).catch(() => {
          // Compression failed — rotated file remains uncompressed
        });
      }
    }
  }

  async compressFile(filePath: string): Promise<void> {
    const gzPath = filePath + '.gz';
    await pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzPath));
    fs.unlinkSync(filePath);
  }

  // -------------------------------------------------------------------------
  // Query helpers (from ring buffer via orchestrator)
  // -------------------------------------------------------------------------

  getLogs(appName?: string, lines = 100): LogEntryDto[] {
    const rawLogs = this.orchestrator.getLogs(appName, lines);
    const entries: LogEntryDto[] = [];

    for (const { app, lines: logLines } of rawLogs) {
      for (const line of logLines) {
        entries.push(this.parseLine(app, line));
      }
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries.slice(-lines);
  }

  // -------------------------------------------------------------------------
  // File listing
  // -------------------------------------------------------------------------

  getRotatedFiles(appName: string, type: LogType = 'app'): string[] {
    const basePath = this.getLogFilePath(appName, type);
    const config = this.getRotationConfig(appName);
    const files: string[] = [];

    if (fs.existsSync(basePath)) files.push(basePath);

    for (let i = 1; i < config.maxFiles; i++) {
      const rotatedGz = `${basePath}.${i}.gz`;
      const rotated = `${basePath}.${i}`;
      if (fs.existsSync(rotatedGz)) {
        files.push(rotatedGz);
      } else if (fs.existsSync(rotated)) {
        files.push(rotated);
      }
    }

    return files;
  }

  listLogApps(): string[] {
    const apps: string[] = [];

    // Check flat logs dir (daemon + standalone apps)
    const logsDir = path.join(this.baseDir, 'logs');
    try {
      for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // Standalone app directories
          const appLog = path.join(logsDir, entry.name, 'app.log');
          if (fs.existsSync(appLog)) apps.push(entry.name);
        } else if (entry.name === 'omnitron.log') {
          apps.push('omnitron');
        }
      }
    } catch { /* dir may not exist */ }

    // Check project-scoped dirs
    const projectsDir = path.join(this.baseDir, 'projects');
    try {
      for (const project of fs.readdirSync(projectsDir)) {
        const projectPath = path.join(projectsDir, project);
        if (!fs.statSync(projectPath).isDirectory()) continue;
        for (const stack of fs.readdirSync(projectPath)) {
          const logsPath = path.join(projectPath, stack, 'logs');
          if (!fs.existsSync(logsPath)) continue;
          for (const app of fs.readdirSync(logsPath)) {
            const appLog = path.join(logsPath, app, 'app.log');
            if (fs.existsSync(appLog)) apps.push(`${project}/${stack}/${app}`);
          }
        }
      }
    } catch { /* dir may not exist */ }

    return apps;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  parseSize(size: string): number {
    const match = size.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/i);
    if (!match) return 10 * 1024 * 1024;
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024, tb: 1024 * 1024 * 1024 * 1024,
    };
    return Math.floor(value * (multipliers[unit] ?? 1024 * 1024));
  }

  private parseLine(app: string, line: string): LogEntryDto {
    try {
      const parsed = JSON.parse(line);
      return {
        timestamp: parsed.time ? new Date(parsed.time).getTime() : Date.now(),
        app,
        level: this.pinoLevelToString(parsed.level ?? 30),
        message: parsed.msg ?? line,
        data: parsed,
      };
    } catch {
      return { timestamp: Date.now(), app, level: 'info', message: line };
    }
  }

  private pinoLevelToString(level: number): string {
    if (level <= 10) return 'trace';
    if (level <= 20) return 'debug';
    if (level <= 30) return 'info';
    if (level <= 40) return 'warn';
    if (level <= 50) return 'error';
    return 'fatal';
  }
}
