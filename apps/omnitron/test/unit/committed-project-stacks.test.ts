import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectStacks } from '../../src/config/project-stacks.js';
import { declaredMigrationPrograms } from '../../src/release/migration-programs.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { IEcosystemConfig } from '../../src/config/types.js';

it('uses committed sidecar stacks for release migration discovery and honors explicit ecosystem overrides', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-stacks-'));
  const file = path.join(dir, 'omnitron.stacks.json');
  const config: IEcosystemConfig = { ...DEFAULT_ECOSYSTEM, apps: [{ name: 'api', script: './index.js' }], stacks: { dev: { type: 'local', apps: ['api'] } } };
  try {
    expect(resolveProjectStacks(config, dir)).toEqual(config.stacks);
    await fs.writeFile(file, JSON.stringify({ test: { type: 'remote', apps: ['api'], infrastructure: {
      postgres: { databases: { api: { migrate: true } } },
    } }, dev: { type: 'remote' } }));
    const stacks = resolveProjectStacks(config, dir);
    expect(stacks['dev']).toEqual(config.stacks!['dev']);
    expect(declaredMigrationPrograms({ ...config, stacks }, 'test').get('api')).toEqual([
      { mode: 'script', source: 'src/database/migrate.ts', release: 'dist/database/migrate.js' },
    ]);
    await fs.writeFile(file, '{');
    expect(() => resolveProjectStacks(config, dir)).toThrow('Cannot read stack overrides');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
