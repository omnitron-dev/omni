import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore, type PersistedState } from '../../src/daemon/state-store.js';

describe('StateStore', () => {
  let tmpDir: string;
  let stateFile: string;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-test-'));
    stateFile = path.join(tmpDir, 'state.json');
    store = new StateStore(stateFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleState: PersistedState = {
    version: '0.1.0',
    updatedAt: Date.now(),
    apps: [
      {
        name: 'main',
        pid: 12345,
        status: 'online',
        mode: 'bootstrap',
        startedAt: Date.now() - 60_000,
        restarts: 0,
        port: 3001,
      },
      {
        name: 'storage',
        pid: 12346,
        status: 'online',
        mode: 'bootstrap',
        startedAt: Date.now() - 30_000,
        restarts: 1,
        port: 3002,
      },
    ],
  };

  describe('save', () => {
    it('creates state file', () => {
      store.save(sampleState);
      expect(fs.existsSync(stateFile)).toBe(true);
    });

    it('writes valid JSON', () => {
      store.save(sampleState);
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(data.version).toBe('0.1.0');
      expect(data.apps).toHaveLength(2);
    });

    it('creates parent directories', () => {
      const nested = path.join(tmpDir, 'a', 'b', 'c', 'state.json');
      const nestedStore = new StateStore(nested);
      nestedStore.save(sampleState);
      expect(fs.existsSync(nested)).toBe(true);
    });

    it('overwrites existing state', () => {
      store.save(sampleState);
      const updated = { ...sampleState, version: '0.2.0', apps: [] };
      store.save(updated);
      const loaded = store.load();
      expect(loaded!.version).toBe('0.2.0');
      expect(loaded!.apps).toHaveLength(0);
    });

    it('writes atomically — never leaves a torn JSON file (T#55)', () => {
      // Drive a save and then check that NO temp/stale file is left
      // behind (rename consumed it) and the final file contains the
      // FULL payload. Pre-T#55, `writeFileSync(stateFile, ...)` was a
      // direct overwrite; if the process was SIGKILL'd between byte
      // 0 and byte N, the next boot's `load()` saw truncated JSON
      // and returned null, losing the entire registry.
      store.save(sampleState);

      const entries = fs.readdirSync(tmpDir);
      // Only the final state.json should remain — no `.tmp.*` siblings.
      const stray = entries.filter((e) => e.includes('.tmp.'));
      expect(stray).toEqual([]);

      // Round-trip: the on-disk file decodes cleanly to the full
      // sample state, proving the atomic write delivered the whole
      // payload (not just a prefix).
      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.apps).toHaveLength(2);
    });

    it('cleans up the temp file when the rename fails (T#55 error path)', () => {
      // Force the rename target to be a *directory* — `fs.renameSync`
      // can't replace a directory with a file, so the atomic-write
      // path must throw AND clean up its temp sibling.
      const dirAsTarget = path.join(tmpDir, 'state.json');
      fs.mkdirSync(dirAsTarget);
      expect(() => store.save(sampleState)).toThrow();
      // No stray temp file should be left.
      const stray = fs.readdirSync(tmpDir).filter((e) => e.includes('.tmp.'));
      expect(stray).toEqual([]);
    });
  });

  describe('load', () => {
    it('returns saved state', () => {
      store.save(sampleState);
      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(sampleState.version);
      expect(loaded!.apps).toHaveLength(2);
      expect(loaded!.apps[0]!.name).toBe('main');
      expect(loaded!.apps[1]!.name).toBe('storage');
    });

    it('returns null when file does not exist', () => {
      expect(store.load()).toBeNull();
    });

    it('returns null on invalid JSON', () => {
      fs.writeFileSync(stateFile, 'not-json', 'utf-8');
      expect(store.load()).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes state file', () => {
      store.save(sampleState);
      expect(fs.existsSync(stateFile)).toBe(true);
      store.clear();
      expect(fs.existsSync(stateFile)).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      expect(() => store.clear()).not.toThrow();
    });
  });
});
