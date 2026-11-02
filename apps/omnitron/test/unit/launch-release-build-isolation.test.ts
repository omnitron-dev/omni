import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ArtifactBuilder } from '../../src/project/artifact-builder.js';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

describe('precompiled release launch', () => {
  it('discards a prior source build and its watcher before selecting the installed executable', async () => {
    const name = 'sample/test/api';
    const unwatchApp = vi.fn().mockResolvedValue(undefined);
    const service = Object.assign(Object.create(OrchestratorService.prototype), {
      devMode: false,
      buildService: { unwatchApp },
      buildResults: new Map([[name, { bootstrapPath: '/old/generated/bootstrap.js' }]]),
      bootstrapSources: new Map([[name, { path: '/old/source/bootstrap.ts' }]]),
    });
    await service.prepareBootstrapBuild({ name, bootstrap: '/installed/dist/bootstrap.js' }, '/installed/dist/bootstrap.js', {
      processes: [{ name: 'server', module: './server.js' }],
    });
    expect(unwatchApp).toHaveBeenCalledWith(name);
    expect(service.buildResults.has(name)).toBe(false);
    expect(service.bootstrapSources.has(name)).toBe(false);
  });
});

it('rejects paths outside the release checkout before cleaning dist or running a package build', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-release-isolation-'));
  try {
    const root = path.join(base, 'checkout');
    const live = path.join(base, 'working');
    const output = path.join(live, 'dist', 'active.txt');
    await fs.mkdir(root);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, 'serving');
    await fs.writeFile(path.join(live, 'package.json'), '{"name":"working","version":"1.0.0"}');
    await fs.symlink(live, path.join(root, 'linked'));
    const builder = new ArtifactBuilder(root);
    for (const cwd of [live, '../working', 'linked']) {
      await expect(builder.buildApp({ name: 'api', cwd, script: 'dist/index.cjs' }, { releaseCheckouts: [root] }))
        .rejects.toThrow(/outside the project checkout/);
    }
    const nested = path.join(root, 'apps/api');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'package.json'), '{"name":"api","version":"1.0.0"}');
    await expect(builder.buildApp({ name: 'api', cwd: 'apps/api', script: 'dist/index.cjs' }, { releaseCheckouts: [root], skipBuild: true }))
      .rejects.toThrow(/No dist/);
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"api","version":"1.0.0"}');
    await fs.symlink(path.dirname(output), path.join(root, 'dist'));
    await expect(builder.buildApp({ name: 'api', script: 'src/main.ts' }, { releaseCheckouts: [root] }))
      .rejects.toThrow(/outside the project checkout/);
    expect(await fs.readFile(output, 'utf8')).toBe('serving');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
