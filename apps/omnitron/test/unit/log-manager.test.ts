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
  describe('appendToFile', () => {
    it('creates and appends to log file', async () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', 'hello world');
      lm.appendToFile('main', 'second line');
      lm.dispose(); // flush + close the async write streams before reading

      const content = await readWhenReady(path.join(tmpDir, 'logs', 'main', 'app.log'), 'hello world\nsecond line\n');
      expect(content).toBe('hello world\nsecond line\n');
    });

    it('creates separate files per app', async () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', 'main log');
      lm.appendToFile('storage', 'storage log');
      lm.dispose();

      expect(await readWhenReady(path.join(tmpDir, 'logs', 'main', 'app.log'), 'main log\n')).toBe('main log\n');
      expect(await readWhenReady(path.join(tmpDir, 'logs', 'storage', 'app.log'), 'storage log\n')).toBe('storage log\n');
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

  describe('getLogs', () => {
    it('delegates to orchestrator and parses lines', () => {
      const orch = createMockOrchestrator([
        { app: 'main', lines: ['plain text line', '{"time":"2024-01-01T00:00:00Z","level":30,"msg":"json line"}'] },
      ]);
      const lm = new LogManager(config, orch);

      const logs = lm.getLogs('main', 10);
      expect(logs).toHaveLength(2);
      // Both lines are from 'main'
      expect(logs.every((l) => l.app === 'main')).toBe(true);
      // One is plain text, one is parsed JSON
      const jsonLog = logs.find((l) => l.message === 'json line');
      expect(jsonLog).toBeDefined();
      expect(jsonLog!.level).toBe('info');
    });

    it('handles pino log levels', () => {
      const orch = createMockOrchestrator([
        {
          app: 'test',
          lines: [
            '{"level":10,"msg":"trace"}',
            '{"level":20,"msg":"debug"}',
            '{"level":30,"msg":"info"}',
            '{"level":40,"msg":"warn"}',
            '{"level":50,"msg":"error"}',
            '{"level":60,"msg":"fatal"}',
          ],
        },
      ]);
      const lm = new LogManager(config, orch);
      const logs = lm.getLogs('test', 10);

      expect(logs.map((l) => l.level)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
    });
  });
});
