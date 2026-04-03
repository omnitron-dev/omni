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

  describe('appendToFile', () => {
    it('creates and appends to log file', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', 'hello world');
      lm.appendToFile('main', 'second line');

      const content = fs.readFileSync(path.join(tmpDir, 'main.log'), 'utf-8');
      expect(content).toBe('hello world\nsecond line\n');
    });

    it('creates separate files per app', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      lm.appendToFile('main', 'main log');
      lm.appendToFile('storage', 'storage log');

      expect(fs.existsSync(path.join(tmpDir, 'main.log'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'storage.log'))).toBe(true);
    });
  });

  describe('getLogFilePath', () => {
    it('returns correct path', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.getLogFilePath('main')).toBe(path.join(tmpDir, 'main.log'));
    });
  });

  describe('rotateLog', () => {
    it('rotates current log to .1', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      const logFile = path.join(tmpDir, 'main.log');
      fs.writeFileSync(logFile, 'original content');

      lm.rotateLog('main');

      expect(fs.existsSync(logFile)).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, 'main.log.1'), 'utf-8')).toBe('original content');
    });

    it('cascades rotation: .1 -> .2, current -> .1', () => {
      const lm = new LogManager({ ...config, maxSize: '10mb' }, createMockOrchestrator());
      const logFile = path.join(tmpDir, 'main.log');

      // Create .1 file
      fs.writeFileSync(path.join(tmpDir, 'main.log.1'), 'old content');
      fs.writeFileSync(logFile, 'current content');

      lm.rotateLog('main');

      expect(fs.readFileSync(path.join(tmpDir, 'main.log.1'), 'utf-8')).toBe('current content');
      expect(fs.readFileSync(path.join(tmpDir, 'main.log.2'), 'utf-8')).toBe('old content');
    });
  });

  describe('getRotatedFiles', () => {
    it('returns empty for no files', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      expect(lm.getRotatedFiles('nonexistent')).toEqual([]);
    });

    it('returns current and rotated files', () => {
      const lm = new LogManager(config, createMockOrchestrator());
      fs.writeFileSync(path.join(tmpDir, 'main.log'), 'current');
      fs.writeFileSync(path.join(tmpDir, 'main.log.1'), 'rotated1');

      const files = lm.getRotatedFiles('main');
      expect(files).toHaveLength(2);
      expect(files[0]).toContain('main.log');
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
