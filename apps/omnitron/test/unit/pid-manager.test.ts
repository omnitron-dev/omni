import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PidManager } from '../../src/daemon/pid-manager.js';

describe('PidManager', () => {
  let tmpDir: string;
  let pidFile: string;
  let manager: PidManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-pid-'));
    pidFile = path.join(tmpDir, 'daemon.pid');
    manager = new PidManager(pidFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('write', () => {
    it('creates PID file with current process PID', () => {
      manager.write();
      expect(fs.existsSync(pidFile)).toBe(true);
      const content = fs.readFileSync(pidFile, 'utf-8');
      // T#56: the file now contains pid + signature on separate lines.
      // `parseInt` on the leading line still yields the pid, so both
      // legacy readers (parseInt on the file body) and the new
      // `readPid()` parser keep working.
      expect(parseInt(content, 10)).toBe(process.pid);
    });

    it('writes pid and signature on separate lines (T#56)', () => {
      manager.write();
      const lines = fs.readFileSync(pidFile, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
      expect(lines[0]).toBe(String(process.pid));
      // Signature is argv[1] (the entry-point script path). In the
      // vitest worker that's a vitest internal path, so we just
      // assert non-empty and stable across consecutive writes.
      expect(lines[1]).toBe(PidManager.currentSignature());
    });

    it('creates parent directories', () => {
      const nested = path.join(tmpDir, 'sub', 'dir', 'daemon.pid');
      const nestedManager = new PidManager(nested);
      nestedManager.write();
      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  describe('isRunning', () => {
    it('returns false when no PID file', () => {
      expect(manager.isRunning()).toBe(false);
    });

    it('returns true when PID file contains current process PID', () => {
      manager.write();
      expect(manager.isRunning()).toBe(true);
    });

    it('returns false when PID file contains invalid PID', () => {
      fs.writeFileSync(pidFile, 'not-a-number', 'utf-8');
      expect(manager.isRunning()).toBe(false);
    });

    it('returns false when PID file contains dead process PID', () => {
      // PID 99999999 almost certainly doesn't exist
      fs.writeFileSync(pidFile, '99999999', 'utf-8');
      expect(manager.isRunning()).toBe(false);
    });

    it('returns false when the alive PID is a recycled stranger (T#56)', () => {
      // Simulate a pid-reuse: pid is OUR process pid (so isProcessAlive
      // returns true), but the recorded signature is something else —
      // signalling the original daemon died and the kernel handed our
      // current process the same pid.
      fs.writeFileSync(pidFile, `${process.pid}\n/path/to/some/other/daemon.js\n`, 'utf-8');
      expect(manager.isRunning()).toBe(false);
    });

    it('treats legacy pid-only files as authoritative (back-compat)', () => {
      // Pre-T#56 pidfile format had no signature line. We must keep
      // those readable, otherwise rolling-deploy upgrades would
      // misclassify the previous-version daemon as stale.
      fs.writeFileSync(pidFile, `${process.pid}`, 'utf-8');
      expect(manager.isRunning()).toBe(true);
    });
  });

  describe('getPid', () => {
    it('returns null when no PID file', () => {
      expect(manager.getPid()).toBeNull();
    });

    it('returns PID when process is alive', () => {
      manager.write();
      expect(manager.getPid()).toBe(process.pid);
    });

    it('returns null when PID file is invalid', () => {
      fs.writeFileSync(pidFile, 'garbage', 'utf-8');
      expect(manager.getPid()).toBeNull();
    });

    it('returns null when process is dead', () => {
      fs.writeFileSync(pidFile, '99999999', 'utf-8');
      expect(manager.getPid()).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes PID file', () => {
      manager.write();
      expect(fs.existsSync(pidFile)).toBe(true);
      manager.remove();
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      expect(() => manager.remove()).not.toThrow();
    });
  });
});
