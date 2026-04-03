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
