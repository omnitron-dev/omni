import { describe, it, expect, beforeEach } from 'vitest';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

function makeEntry(name = 'test-app'): IEcosystemAppEntry {
  return { name, bootstrap: `./apps/${name}/src/bootstrap.ts` };
}

describe('AppHandle', () => {
  let handle: AppHandle;

  beforeEach(() => {
    handle = new AppHandle(makeEntry(), 'bootstrap');
  });

  describe('construction', () => {
    it('initializes with correct defaults', () => {
      expect(handle.pid).toBeNull();
      expect(handle.status).toBe('stopped');
      expect(handle.startedAt).toBe(0);
      expect(handle.restarts).toBe(0);
      expect(handle.port).toBeNull();
      expect(handle.lastMetrics).toBeNull();
      expect(handle.lastHealth).toBeNull();
      expect(handle.supervisor).toBeNull();
      expect(handle.childProcess).toBeNull();
      expect(handle.instanceCount).toBe(1);
    });

    it('stores entry and mode', () => {
      expect(handle.entry.name).toBe('test-app');
      expect(handle.mode).toBe('bootstrap');
    });

    it('derives name from entry', () => {
      expect(handle.name).toBe('test-app');
    });
  });

  describe('lifecycle transitions', () => {
    it('markStarting sets status and startedAt', () => {
      const before = Date.now();
      handle.markStarting();
      expect(handle.status).toBe('starting');
      expect(handle.startedAt).toBeGreaterThanOrEqual(before);
    });

    it('markOnline sets status and pid', () => {
      handle.markOnline(12345);
      expect(handle.status).toBe('online');
      expect(handle.pid).toBe(12345);
    });

    it('markStopping sets status', () => {
      handle.markOnline(1);
      handle.markStopping();
      expect(handle.status).toBe('stopping');
    });

    it('markStopped clears pid, childProcess, supervisor', () => {
      handle.markOnline(1);
      handle.markStopped();
      expect(handle.status).toBe('stopped');
      expect(handle.pid).toBeNull();
      expect(handle.childProcess).toBeNull();
      expect(handle.supervisor).toBeNull();
    });

    it('markErrored sets status', () => {
      handle.markErrored();
      expect(handle.status).toBe('errored');
    });

    it('markCrashed sets status and increments restarts', () => {
      handle.markCrashed();
      expect(handle.status).toBe('crashed');
      expect(handle.restarts).toBe(1);

      handle.markCrashed();
      expect(handle.restarts).toBe(2);
    });
  });

  describe('uptime', () => {
    it('returns 0 when not online', () => {
      expect(handle.uptime).toBe(0);
    });

    it('returns 0 when stopped', () => {
      handle.markStarting();
      handle.markStopped();
      expect(handle.uptime).toBe(0);
    });

    it('returns positive value when online', () => {
      handle.markStarting();
      handle.markOnline(1);
      // uptime = Date.now() - startedAt, should be >= 0
      expect(handle.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('metrics accessors', () => {
    it('cpu returns 0 when no metrics', () => {
      expect(handle.cpu).toBe(0);
    });

    it('memory returns 0 when no metrics', () => {
      expect(handle.memory).toBe(0);
    });

    it('cpu returns value from lastMetrics', () => {
      handle.lastMetrics = { cpu: 42.5, memory: 100 };
      expect(handle.cpu).toBe(42.5);
    });

    it('memory returns value from lastMetrics', () => {
      handle.lastMetrics = { cpu: 0, memory: 256_000_000 };
      expect(handle.memory).toBe(256_000_000);
    });
  });

  describe('log buffer', () => {
    it('appends and retrieves logs', () => {
      handle.appendLog('line 1');
      handle.appendLog('line 2');
      expect(handle.getLogs()).toEqual(['line 1', 'line 2']);
    });

    it('returns last N lines', () => {
      for (let i = 0; i < 10; i++) handle.appendLog(`line ${i}`);
      const last3 = handle.getLogs(3);
      expect(last3).toEqual(['line 7', 'line 8', 'line 9']);
    });

    it('returns copy of buffer (not reference)', () => {
      handle.appendLog('test');
      const logs = handle.getLogs();
      logs.push('injected');
      expect(handle.getLogs()).toEqual(['test']);
    });

    it('enforces max log lines (ring buffer)', () => {
      // maxLogLines is 1000 (private)
      for (let i = 0; i < 1010; i++) handle.appendLog(`line ${i}`);
      const logs = handle.getLogs();
      expect(logs).toHaveLength(1000);
      expect(logs[0]).toBe('line 10');
      expect(logs[999]).toBe('line 1009');
    });

    it('returns empty array when no logs', () => {
      expect(handle.getLogs()).toEqual([]);
      expect(handle.getLogs(10)).toEqual([]);
    });
  });

  describe('crash diagnostics — recordExit / lastExit / stderr ring', () => {
    it('starts with no lastExit', () => {
      expect(handle.lastExit).toBeNull();
    });

    it('records exit code + signal + expected + ISO timestamp', () => {
      handle.recordExit({ code: 1, signal: null, expected: false, message: 'boom' });
      expect(handle.lastExit).not.toBeNull();
      expect(handle.lastExit!.code).toBe(1);
      expect(handle.lastExit!.signal).toBeNull();
      expect(handle.lastExit!.expected).toBe(false);
      expect(handle.lastExit!.message).toBe('boom');
      // ISO-8601 with Z suffix
      expect(handle.lastExit!.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('coerces signal to string (NodeJS.Signals is a string union but kept normalized)', () => {
      handle.recordExit({ code: null, signal: 'SIGKILL', expected: false });
      expect(handle.lastExit!.signal).toBe('SIGKILL');
    });

    it('snapshots the current stderr ring into lastExit.stderrTail', () => {
      handle.appendStderr('FATAL: JWT_SECRET missing');
      handle.appendStderr('  at bootstrap (/app/src/index.ts:42)');
      handle.recordExit({ code: 1, signal: null, expected: false });
      expect(handle.lastExit!.stderrTail).toEqual([
        'FATAL: JWT_SECRET missing',
        '  at bootstrap (/app/src/index.ts:42)',
      ]);
    });

    it('stderrTail is a snapshot — later appendStderr does not mutate it', () => {
      handle.appendStderr('a');
      handle.recordExit({ code: 1, signal: null, expected: false });
      handle.appendStderr('b');
      expect(handle.lastExit!.stderrTail).toEqual(['a']);
    });

    it('stderr ring is bounded (default 80)', () => {
      for (let i = 0; i < 100; i++) handle.appendStderr(`err ${i}`);
      handle.recordExit({ code: 1, signal: null, expected: false });
      expect(handle.lastExit!.stderrTail).toHaveLength(80);
      expect(handle.lastExit!.stderrTail[0]).toBe('err 20');
      expect(handle.lastExit!.stderrTail[79]).toBe('err 99');
    });

    it('clearLastExit drops both lastExit AND the stderr ring', () => {
      handle.appendStderr('x');
      handle.recordExit({ code: 1, signal: null, expected: false });
      handle.clearLastExit();
      expect(handle.lastExit).toBeNull();
      // Subsequent recordExit captures an empty tail.
      handle.recordExit({ code: 2, signal: null, expected: false });
      expect(handle.lastExit!.stderrTail).toEqual([]);
    });

    it('omits message when not provided', () => {
      handle.recordExit({ code: 0, signal: null, expected: true });
      expect(handle.lastExit!.message).toBeUndefined();
    });
  });
});
