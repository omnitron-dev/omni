/**
 * The backup directory held the .onion identity at 0644.
 *
 * Measured on a working host, 2026-09-12: `~/.omnitron/backups` was 0755 and
 * all 493 files in it were 0644 — readable by every account on the machine.
 * Among them 40 `tor-keys` archives (whoever holds one can BE the hidden
 * service), 48 `main` dumps (every user row, password hash, TOTP secret, PGP
 * key), 48 `payments` dumps, and the live `~/.omnitron/data/daemon-state.db`.
 *
 * The rule already existed one directory away — `config.json` is written 0600
 * and `daemon.sock` is bound 0600 — and the reason it had not reached these
 * files is ordinary: those two go through `fs.writeFileSync`, which takes a
 * mode, while a backup is produced by `pg_dump > file`, `tar czf` or
 * `sqlite3 .backup`, where the mode falls out of the process umask and nobody
 * chose it. So the mode is applied after creation instead of hoped for.
 *
 * These tests exercise the real filesystem, because the whole subject is what
 * the filesystem ends up holding.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensurePrivateDir,
  sealFile,
  sealDirContents,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
} from '../../src/shared/private-files.js';

const made: string[] = [];
function tmpdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-perm-'));
  made.push(dir);
  return dir;
}
const modeOf = (p: string): number => fs.statSync(p).mode & 0o777;

afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe.runIf(process.platform !== 'win32')('files only the daemon may read', () => {
  it('tightens a directory that already exists', () => {
    // The case that matters: every host that has run the daemon before has
    // this directory already, and `mkdirSync(dir, { mode })` applies a mode
    // only to directories it actually creates.
    const root = tmpdir();
    const dir = path.join(root, 'backups');
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    expect(modeOf(dir)).toBe(0o755);

    ensurePrivateDir(dir);

    expect(modeOf(dir)).toBe(PRIVATE_DIR_MODE);
  });

  it('creates a missing directory private from the start', () => {
    const dir = path.join(tmpdir(), 'nested', 'backups');

    ensurePrivateDir(dir);

    expect(modeOf(dir)).toBe(PRIVATE_DIR_MODE);
  });

  it('seals a file and the SQLite sidecars beside it', () => {
    // `daemon-state_*.db` backups sit next to `-shm` and `-wal` files that
    // carry the same rows; sealing only the one named file leaves the data
    // readable through its neighbours.
    const dir = tmpdir();
    const db = path.join(dir, 'daemon-state.db');
    for (const suffix of ['', '-shm', '-wal']) {
      fs.writeFileSync(db + suffix, 'x', { mode: 0o644 });
      fs.chmodSync(db + suffix, 0o644);
    }

    sealFile(db);

    for (const suffix of ['', '-shm', '-wal']) {
      expect(modeOf(db + suffix), `${suffix || '(the file)'} stayed loose`).toBe(PRIVATE_FILE_MODE);
    }
  });

  it('does not throw for a sidecar that is not there', () => {
    const file = path.join(tmpdir(), 'main.sql.gz');
    fs.writeFileSync(file, 'x', { mode: 0o644 });
    fs.chmodSync(file, 0o644);

    expect(() => sealFile(file)).not.toThrow();
    expect(modeOf(file)).toBe(PRIVATE_FILE_MODE);
  });

  it('reaches backwards over what is already on disk, and counts it', () => {
    // A fix that only protects future backups protects nothing that matters:
    // the files written before it landed have been exposed the longest.
    const dir = tmpdir();
    const loose = ['tor-keys.tar.gz', 'main.sql.gz', 'payments.sql.gz'];
    for (const name of loose) {
      fs.writeFileSync(path.join(dir, name), 'x');
      fs.chmodSync(path.join(dir, name), 0o644);
    }
    const already = path.join(dir, 'already-private.sql.gz');
    fs.writeFileSync(already, 'x');
    fs.chmodSync(already, PRIVATE_FILE_MODE);
    fs.mkdirSync(path.join(dir, 'a-subdirectory'));

    const tightened = sealDirContents(dir);

    expect(tightened, 'counts only what it had to change').toBe(loose.length);
    for (const name of loose) expect(modeOf(path.join(dir, name))).toBe(PRIVATE_FILE_MODE);
    // A second pass finds nothing, so a quiet boot stays quiet.
    expect(sealDirContents(dir)).toBe(0);
  });

  it('leaves a directory it cannot read alone rather than throwing', () => {
    expect(sealDirContents(path.join(tmpdir(), 'does-not-exist'))).toBe(0);
  });
});

describe('the paths that produce these files seal them', () => {
  const read = (rel: string): string => {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    // The comments explain the fix using the words being searched for.
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
  };

  it('every backup is sealed before it is indexed', () => {
    const src = read('../../src/services/backup.service.ts');

    // `createBackup` writes its own index row; every other target goes
    // through `indexBackupFile`. Both must seal first.
    for (const fn of ['async createBackup(', 'private indexBackupFile(']) {
      const at = src.indexOf(fn);
      expect(at, `${fn} is gone — re-point this test`).toBeGreaterThan(0);
      const body = src.slice(at, at + 2500);
      const sealAt = body.indexOf('sealFile(');
      const statAt = body.indexOf('statSync(');
      expect(sealAt, `${fn} does not seal its file`).toBeGreaterThan(0);
      expect(sealAt, `${fn} stats before it seals`).toBeLessThan(statAt);
    }

    expect(src).toContain('ensurePrivateDir(this.backupDir)');
    expect(src).toContain('sealDirContents(this.backupDir)');
  });

  it('application log files are created private', () => {
    // Not speculative: `main`'s error.log on this host held a user's plaintext
    // password, put there by netron's rejected-request path. That path is
    // fixed, but a log holds whatever the application writes, so the mode has
    // to stand on its own.
    const src = read('../../src/monitoring/log-manager.ts');

    expect(src).toContain("createWriteStream(filePath, { flags: 'a', encoding: 'utf-8', mode: PRIVATE_FILE_MODE })");
    expect(src).toContain('createWriteStream(gzPath, { mode: PRIVATE_FILE_MODE })');
    expect(src, 'a rotation must not recreate the file at the umask default')
      .toContain("fs.writeFileSync(basePath, '', { encoding: 'utf-8', mode: PRIVATE_FILE_MODE })");
    // Every directory this manager makes goes through the same helper.
    expect(/fs\.mkdirSync\([^)]*logs/.test(src), 'a log directory bypassed ensurePrivateDir').toBe(false);
  });

  it('the daemon state database is sealed on both open paths', () => {
    const src = read('../../src/daemon/daemon-state-store.service.ts');

    // Sealing must follow the WAL pragma — that is what creates the sidecars.
    const opens = [...src.matchAll(/journal_mode = WAL/g)];
    expect(opens.length, 'expected both the sync and async opens').toBe(2);
    for (const open of opens) {
      const after = src.slice(open.index ?? 0, (open.index ?? 0) + 600);
      expect(after).toContain('sealFile(this.dbPath)');
    }
    expect(src).not.toContain("fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })");
  });
});
