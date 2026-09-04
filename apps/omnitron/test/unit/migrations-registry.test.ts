/**
 * Migration registry integrity.
 *
 * Three separate hand-maintained migration lists had drifted apart (the
 * daemon knew 001–005, the infrastructure service 001–002, the CLI 001–003),
 * so which tables existed depended on which code path ran. There is now one
 * registry; this test is what keeps it from falling behind the directory
 * again — adding `006_*.ts` without registering it fails here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { OMNITRON_MIGRATIONS } from '../../src/database/migrations/index.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

function migrationFilesOnDisk(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.+\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

describe('OMNITRON_MIGRATIONS registry', () => {
  it('registers every migration file present on disk', () => {
    const onDisk = migrationFilesOnDisk();
    const registered = OMNITRON_MIGRATIONS.map((m) => m.name).sort();

    expect(registered).toEqual(onDisk);
  });

  it('is ordered by its numeric prefix', () => {
    const names = OMNITRON_MIGRATIONS.map((m) => m.name);
    expect(names).toEqual([...names].sort());
  });

  it('has unique names', () => {
    const names = OMNITRON_MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exposes a callable up (and down) for every entry', () => {
    for (const migration of OMNITRON_MIGRATIONS) {
      expect(typeof migration.up, `${migration.name}.up`).toBe('function');
      expect(typeof migration.down, `${migration.name}.down`).toBe('function');
    }
  });
});
