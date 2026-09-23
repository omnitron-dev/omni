import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LogManager, type LogManagerConfig } from '../../src/monitoring/log-manager.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

function createMockOrchestrator(logsData: Array<{ app: string; lines: string[] }> = []): OrchestratorService {
  return {
    getLogs: vi.fn().mockReturnValue(logsData),
  } as unknown as OrchestratorService;
}

/**
 * Reads a log file once the async write stream has flushed. appendToFile writes
 * via createWriteStream (flushed by dispose()), so a fixed sleep is flaky under
 * load — poll until the expected content lands instead.
 */
async function readWhenReady(file: string, expected: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      last = fs.readFileSync(file, 'utf-8');
      if (last === expected) return last;
    } catch {
      /* file not created yet */
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  return last;
}

describe('LogManager', () => {
  let tmpDir: string;
  let config: LogManagerConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-logs-'));
    config = {
      directory: tmpDir,
      maxSize: '1kb',
      maxFiles: 3,
      compress: false,
      format: 'json',
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseSize', () => {
    it('parses bytes', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('100b')).toBe(100);
    });

    it('parses kilobytes', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('1kb')).toBe(1024);
    });

    it('parses megabytes', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('50mb')).toBe(50 * 1024 * 1024);
    });

    it('parses gigabytes', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('2gb')).toBe(2 * 1024 * 1024 * 1024);
    });

    it('returns default 10MB for invalid size', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('invalid')).toBe(10 * 1024 * 1024);
    });

    it('handles decimal values', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('1.5mb')).toBe(Math.floor(1.5 * 1024 * 1024));
    });

    it('is case insensitive', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.parseSize('10MB')).toBe(10 * 1024 * 1024);
      expect(lm.parseSize('10Mb')).toBe(10 * 1024 * 1024);
    });
  });

  // Per-app log layout is now {baseDir}/logs/{app}/app.log (was a flat {app}.log).
  //
  // A JSON line is written as the app wrote it. Anything else is written as a
  // JSON line of its own carrying the time it was captured — a raw line in a
  // file carries no time a later reader could recover (`log-line.ts`).
  describe('appendToFile', () => {
    const linesOf = async (file: string, count: number) => {
      const start = Date.now();
      let lines: string[] = [];
      while (Date.now() - start < 2000) {
        try {
          lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
          if (lines.length >= count) break;
        } catch {
          /* not created yet */
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      return lines;
    };

    it('writes a JSON line as written, and a plain one with the time it was captured', async () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      const json = '{"level":30,"time":1790000000000,"msg":"started"}';
      const before = Date.now();
      lm.appendToFile('main', json);
      lm.appendToFile('main', 'hello world');
      lm.dispose(); // seals held records, then flushes and closes the streams

      const [first, second] = await linesOf(path.join(tmpDir, 'logs', 'main', 'app.log'), 2);
      expect(first).toBe(json);
      const envelope = JSON.parse(second!);
      expect(envelope).toMatchObject({ msg: 'hello world', format: 'text' });
      // Nothing in the line says its level, so none is claimed.
      expect(envelope).not.toHaveProperty('level');
      expect(Date.parse(envelope.time)).toBeGreaterThanOrEqual(before - 1);
    });

    it('puts a pino-pretty ERROR in error.log — 95 of them never reached it', async () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('paysys', '[2026-09-23 08:49:07.229] ERROR (paysys/41 on host): Monero chain has not advanced');
      lm.appendToFile('paysys', '[2026-09-23 08:49:08.000] INFO (paysys/41 on host): scanning');
      lm.dispose();

      const errors = await linesOf(path.join(tmpDir, 'logs', 'paysys', 'error.log'), 1);
      expect(errors).toHaveLength(1);
      expect(JSON.parse(errors[0]!)).toMatchObject({ level: 50, msg: 'Monero chain has not advanced', format: 'pretty' });
    });

    it('creates separate files per app', async () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', '{"level":30,"msg":"main log"}');
      lm.appendToFile('storage', '{"level":30,"msg":"storage log"}');
      lm.dispose();

      expect(await linesOf(path.join(tmpDir, 'logs', 'main', 'app.log'), 1)).toEqual(['{"level":30,"msg":"main log"}']);
      expect(await linesOf(path.join(tmpDir, 'logs', 'storage', 'app.log'), 1)).toEqual(['{"level":30,"msg":"storage log"}']);
    });
  });

  describe('getLogFilePath', () => {
    it('returns correct path', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.getLogFilePath('main')).toBe(path.join(tmpDir, 'logs', 'main', 'app.log'));
    });
  });

  describe('rotateLog', () => {
    it('rotates current log to .1', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      const logFile = lm.getLogFilePath('main'); // also creates the logs/main/ dir
      fs.writeFileSync(logFile, 'original content');

      lm.rotateLog('main');

      // The current file is recreated empty (so the write stream can keep going);
      // the content is what moved to .1.
      expect(fs.readFileSync(logFile, 'utf-8')).toBe('');
      expect(fs.readFileSync(`${logFile}.1`, 'utf-8')).toBe('original content');
    });

    it('cascades rotation: .1 -> .2, current -> .1', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      const logFile = lm.getLogFilePath('main');

      fs.writeFileSync(`${logFile}.1`, 'old content');
      fs.writeFileSync(logFile, 'current content');

      lm.rotateLog('main');

      expect(fs.readFileSync(`${logFile}.1`, 'utf-8')).toBe('current content');
      expect(fs.readFileSync(`${logFile}.2`, 'utf-8')).toBe('old content');
    });
  });

  describe('getRotatedFiles', () => {
    it('returns empty for no files', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.getRotatedFiles('nonexistent')).toEqual([]);
    });

    it('returns current and rotated files', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      const logFile = lm.getLogFilePath('main');
      fs.writeFileSync(logFile, 'current');
      fs.writeFileSync(`${logFile}.1`, 'rotated1');

      const files = lm.getRotatedFiles('main');
      expect(files).toHaveLength(2);
      expect(files[0]).toContain('app.log');
    });
  });

  // `getLogs` answers from the records as captured — dated once, when they
  // were captured, never again by the time of the question.
  describe('getLogs', () => {
    it('reads captured records: a JSON one by its own fields, a plain one as unknown', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', '{"time":"2024-01-01T00:00:00Z","level":30,"msg":"json line"}');
      lm.appendToFile('main', 'plain text line');
      lm.dispose();

      const logs = lm.getLogs('main', 10);
      expect(logs.map((l) => `${l.level}:${l.message}`)).toEqual(['info:json line', 'unknown:plain text line']);
      expect(logs[0]!.timestamp).toBe(Date.parse('2024-01-01T00:00:00Z'));
    });

    it('handles pino log levels', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      for (const [level, name] of [[10, 'trace'], [20, 'debug'], [30, 'info'], [40, 'warn'], [50, 'error'], [60, 'fatal']] as const) {
        lm.appendToFile('test', JSON.stringify({ level, msg: name }));
      }
      lm.dispose();

      expect(lm.getLogs('test', 10).map((l) => l.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    });

    it('dates a record once — a second question gets the same time', async () => {
      // `omnitron logs -f` printed 26 lines 304 times in 7 s: every poll
      // re-dated the same non-JSON lines to the moment of the poll.
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('paysys', 'Monero chain has not advanced');
      lm.dispose();
      const first = lm.getLogs('paysys', 10).map((l) => l.timestamp);
      await new Promise((r) => setTimeout(r, 20));
      expect(lm.getLogs('paysys', 10).map((l) => l.timestamp)).toEqual(first);
    });
  });

  /**
   * `inspect` told operators to tail a file nothing writes.
   *
   * LogManager picks its layout by counting slashes in the app name: three or
   * more parts means project mode (`projects/{project}/{stack}/logs/{app}/`),
   * fewer means standalone (`logs/{app}/`). The writer is driven by the
   * fully-qualified handle name, so logs land in the project path — while
   * `DaemonRpcService.inspect` passed the name the OPERATOR typed, and
   * `omnitron inspect main` answered `~/.omnitron/logs/main/app.log`.
   *
   * What made it costly rather than cosmetic: that file EXISTS on a machine
   * old enough to predate project mode, full of genuine log lines from days
   * earlier, so tailing it during an incident reads as an app that has gone
   * quiet. `getLogFilePath` mkdirs its own answer, so asking the wrong
   * question is what created the decoy in the first place.
   */
  describe('name resolution', () => {
    it('puts a qualified app under its project, and a bare name somewhere else', () => {
      const manager = new LogManager(config, createMockOrchestrator());
      const qualified = manager.getLogFilePath('acme/dev/main', 'app');
      const bare = manager.getLogFilePath('main', 'app');

      // The project segment is the app name's own first part — `acme` here,
      // from `acme/dev/main`. This read `downstream`, a name no input to this
      // test produces, so the assertion had never passed: an anonymised
      // project name was substituted into the expectation and not into the
      // call beside it.
      expect(qualified.endsWith(path.join('projects', 'acme', 'dev', 'logs', 'main', 'app.log'))).toBe(true);
      expect(bare.endsWith(path.join('logs', 'main', 'app.log'))).toBe(true);
      expect(bare).not.toContain('projects');
      // The difference IS the defect. A future layout change that collapses
      // the two should fail here loudly rather than quietly making the
      // caller's mistake harmless.
      expect(qualified).not.toBe(bare);
    });

    it('creates the directory it names, which is why the wrong name leaves a decoy', () => {
      const manager = new LogManager(config, createMockOrchestrator());
      const bare = manager.getLogFilePath('main', 'app');
      expect(fs.existsSync(path.dirname(bare))).toBe(true);
    });
  });

});
