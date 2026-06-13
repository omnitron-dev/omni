import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore, type PersistedState } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';

// T-7: StateStore was migrated from an atomically-renamed JSON file to a
// SQLite-backed DaemonStateStore (kvGet/kvSet/kvDelete). These tests exercise
// the new backing store directly — `save()` is now fire-and-forget (the write
// lands on an internal promise chain), so durability is asserted after
// `flush()` via a fresh StateStore over the same db. The torn-write/temp-file
// rename invariants are gone (SQLite WAL owns atomicity) — see
// state-store-torn-write.spec.ts.

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

describe('StateStore', () => {
  let tmpDir: string;
  let backing: DaemonStateStore;
  let store: StateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-test-'));
    backing = new DaemonStateStore(silentLogger, path.join(tmpDir, 'daemon-state.db'));
    store = new StateStore(backing);
  });

  afterEach(async () => {
    // save()/clear() are fire-and-forget: they lazily open the SQLite db on a
    // background promise. Flush before removing the temp dir, otherwise that
    // deferred open races rmSync and surfaces as an unhandled rejection
    // ("Cannot open database because the directory does not exist").
    await store.flush();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleState: PersistedState = {
    version: '0.1.0',
    updatedAt: Date.now(),
    apps: [
      { name: 'main', pid: 12345, status: 'online', mode: 'bootstrap', startedAt: Date.now() - 60_000, restarts: 0, port: 3001 },
      { name: 'storage', pid: 12346, status: 'online', mode: 'bootstrap', startedAt: Date.now() - 30_000, restarts: 1, port: 3002 },
    ],
  };

  describe('save / load (in-memory cache)', () => {
    it('round-trips the saved snapshot via the synchronous cache', () => {
      store.save(sampleState);
      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe('0.1.0');
      expect(loaded!.apps).toHaveLength(2);
      expect(loaded!.apps[0]!.name).toBe('main');
      expect(loaded!.apps[1]!.name).toBe('storage');
    });

    it('overwrites existing state', () => {
      store.save(sampleState);
      store.save({ ...sampleState, version: '0.2.0', apps: [] });
      const loaded = store.load();
      expect(loaded!.version).toBe('0.2.0');
      expect(loaded!.apps).toHaveLength(0);
    });

    it('load() returns null before anything is saved or init()-ed', () => {
      expect(store.load()).toBeNull();
    });
  });

  describe('SQLite durability', () => {
    it('persists across flush() so a fresh StateStore recovers the full payload', async () => {
      store.save(sampleState);
      await store.flush(); // block until the queued SQLite write reaches disk

      const reopened = new StateStore(backing);
      const recovered = await reopened.init();
      expect(recovered).not.toBeNull();
      expect(recovered!.apps).toHaveLength(2); // whole payload, not a torn prefix
      expect(reopened.load()!.version).toBe('0.1.0');
    });

    it('clear() drops the persisted snapshot', async () => {
      store.save(sampleState);
      await store.flush();
      store.clear();
      await store.flush();

      const reopened = new StateStore(backing);
      expect(await reopened.init()).toBeNull();
    });

    it('does not throw when clearing an empty store', () => {
      expect(() => store.clear()).not.toThrow();
    });
  });

  describe('legacy JSON migration', () => {
    it('imports a pre-SQLite state.json on first init() and unlinks it', async () => {
      const legacyPath = path.join(tmpDir, 'state.json');
      fs.writeFileSync(legacyPath, JSON.stringify(sampleState), 'utf-8');

      const migrating = new StateStore(backing, legacyPath);
      const migrated = await migrating.init();
      expect(migrated).not.toBeNull();
      expect(migrated!.apps).toHaveLength(2);
      // The legacy file is consumed after a successful migration.
      expect(fs.existsSync(legacyPath)).toBe(false);

      // And it now lives in SQLite — a fresh store recovers it without the JSON file.
      const after = new StateStore(backing);
      expect((await after.init())!.apps).toHaveLength(2);
    });

    it('init() returns null when there is neither a SQLite row nor a legacy file', async () => {
      expect(await store.init()).toBeNull();
    });
  });
});
