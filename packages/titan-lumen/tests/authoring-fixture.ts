import { afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseManager } from '@omnitron-dev/titan-database';
import { MigrationRunner } from '@omnitron-dev/titan-database/migration';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { LiveEditService } from '../src/live/live-edit.service.js';
import { lumenAuthoringMigration } from '../src/live/migration.js';
import type { LumenAuthoringDatabase } from '../src/live/schema.js';
import type { LiveEditActor, LiveEditServiceOptions } from '../src/types.js';

const managers: DatabaseManager[] = [];
const directories: string[] = [];
export const admin: LiveEditActor = { userId: 'verified-admin', roles: ['admin'] };
export const writer: LiveEditActor = { userId: 'verified-public-writer', roles: ['anonymous'] };
export const hash = (content: string) => createHash('sha256').update(content).digest('hex');

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.closeAll();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

export async function openAuthoringDatabase(filename?: string, migrate = true): Promise<{ manager: DatabaseManager; filename: string }> {
  if (!filename) {
    const directory = await mkdtemp(join(tmpdir(), 'lumen-authoring-')); directories.push(directory);
    filename = join(directory, 'documents.sqlite');
  }
  const manager = new DatabaseManager({ connection: { dialect: 'sqlite', connection: filename } }, createNullLogger());
  managers.push(manager);
  await manager.init();
  if (migrate) await new MigrationRunner(await manager.getConnection<LumenAuthoringDatabase>(), [lumenAuthoringMigration], {
    useTransactions: true, advisoryLock: false, enforceChecksums: true,
  }).up();
  return { manager, filename };
}

export async function createAuthoringFixture(options: Partial<LiveEditServiceOptions> = {}) {
  const { manager, filename } = await openAuthoringDatabase();
  const configuration = { corpusId: 'test-corpus', ...options };
  return { live: new LiveEditService(configuration, manager), manager, filename, options: configuration };
}
