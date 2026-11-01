/** Run with a built runtime's Node: private-storage-locks.mjs <dist> [permission-module]. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] ?? 'dist');
const packageFile = path.join(path.dirname(dist), 'package.json');
const Database = createRequire(packageFile)('better-sqlite3');
const permissionModule = process.argv[3] ?? path.join(dist, 'shared/private-files.js');
const { sealSqliteFiles } = await import(pathToFileURL(path.resolve(permissionModule)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-private-sqlite-'));
const probe = path.join(root, 'probe.mjs');
fs.writeFileSync(probe, `
import { createRequire } from 'node:module';
const Database = createRequire(${JSON.stringify(packageFile)})('better-sqlite3');
const db = new Database(process.argv[2]);
db.pragma('busy_timeout=0');
try {
  if (process.argv[3] === 'write-lock') {
    let acquired = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      acquired = true;
      db.exec('ROLLBACK');
    } catch (error) {
      if (error.code !== 'SQLITE_BUSY') throw error;
    }
    console.log(JSON.stringify({ acquired }));
  } else {
    console.log(JSON.stringify(db.prepare('SELECT value FROM records').get()));
  }
} finally { db.close(); }
`);
const child = (file, operation) => JSON.parse(execFileSync(process.execPath, [probe, file, operation], {
  encoding: 'utf8', timeout: 10_000,
}));
let checks = 0;
let sqliteVersion;
try {
  for (const initialMode of [0o600, 0o644]) {
    const file = path.join(root, `state-${initialMode}.db`);
    const db = new Database(file);
    try {
      sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
      db.pragma('journal_mode=WAL');
      db.exec('CREATE TABLE records (value INTEGER); INSERT INTO records VALUES (0)');
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(file + suffix)) fs.chmodSync(file + suffix, initialMode);
      }
      db.exec('BEGIN IMMEDIATE');
      assert.equal(child(file, 'write-lock').acquired, false, 'Control: live writer must exclude another writer');
      sealSqliteFiles(file);
      assert.equal(child(file, 'write-lock').acquired, false, 'Permission sealing must preserve the live write lock');
      checks++;
      db.exec('COMMIT');
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(file + suffix)) assert.equal(fs.statSync(file + suffix).mode & 0o777, 0o600);
      }
      for (let value = 1; value <= 12; value++) {
        sealSqliteFiles(file);
        db.prepare('UPDATE records SET value=?').run(value);
        assert.equal(child(file, 'read').value, value, 'A closing reader must not detach the writer WAL');
        checks++;
      }
      assert.equal(db.pragma('quick_check(1)', { simple: true }), 'ok');
      checks++;
    } finally { db.close(); }
  }
  const external = path.join(root, 'external');
  const link = path.join(root, 'alias.db');
  fs.writeFileSync(external, 'private', { mode: 0o644 });
  fs.symlinkSync(external, link);
  assert.throws(() => sealSqliteFiles(link), /without aliases/);
  assert.equal(fs.statSync(external).mode & 0o777, 0o644);
  checks++;
  fs.unlinkSync(link);
  fs.linkSync(external, link);
  assert.throws(() => sealSqliteFiles(link), /without aliases/);
  assert.equal(fs.statSync(external).mode & 0o777, 0o644);
  checks++;
  console.log(JSON.stringify({ test: 'private-sqlite-locks', checks, platform: process.platform, sqlite: sqliteVersion }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
