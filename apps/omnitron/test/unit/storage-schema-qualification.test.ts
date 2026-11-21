import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { masterExpansionPolicies } from '../../src/database/schema-expansion-policy.js';
import { hasStorageRollbackWriter, STORAGE_EXPANSION } from '../../src/database/storage-schema-compatibility.js';
import { assertBackendMigrationsCompatible } from '../../src/daemon/backend-candidate.js';

describe('admission of the storage alert registries', () => {
  it('withholds 018 from a legacy coordinator and from an unqualified rollback writer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'omni-storage-policy-'));
    try {
      for (const rollback of [undefined, root]) {
        const policies = await masterExpansionPolicies(root, rollback);
        expect(policies.map(p => p.name)).toContain('017_pipeline_admission');
        expect(policies.map(p => p.name)).not.toContain(STORAGE_EXPANSION.masterName);
      }
      await mkdir(path.join(root, 'database/alert-bridge'), { recursive: true });
      await writeFile(path.join(root, 'database/alert-bridge/layout.js'), 'export const protocol = 1;');
      expect(await hasStorageRollbackWriter(root)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects an invented SQLite expansion even with the reviewed filename, in both directions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'omni-storage-tree-'));
    try {
      const before = path.join(root, 'before'), after = path.join(root, 'after');
      for (const dir of [before, after]) {
        await mkdir(path.join(dir, 'database/slave-migrations'), { recursive: true });
        await writeFile(path.join(dir, 'database/slave-migrations/index.js'), 'export const migrations = [];');
        await writeFile(path.join(dir, 'database/slave-migrations/001_replication_evidence.js'), 'export const up = () => {};');
      }
      await writeFile(path.join(after, 'database/slave-migrations/002_host_storage_alert.js'), 'export const up = () => {};');
      await expect(assertBackendMigrationsCompatible(before, after, 'node')).rejects.toThrow('changes database migrations');
      await expect(assertBackendMigrationsCompatible(after, before, 'node')).rejects.toThrow('changes database migrations');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
