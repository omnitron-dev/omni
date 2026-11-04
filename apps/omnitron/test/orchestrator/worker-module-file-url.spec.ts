import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-worker-url-'));
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
beforeAll(async () => {
  await fs.symlink(path.join(packageRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await build({ entryPoints: ['bootstrap-process', 'module-worker-process'].map(name =>
    path.join(packageRoot, 'src/orchestrator', name + '.ts')), outdir: root,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
  });
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe('worker entry filesystem paths', () => {
  it.each(['bootstrap-process', 'module-worker-process'])('imports the exact %s module with URL-reserved characters', async (kind) => {
    const directory = path.join(root, kind + ' #1%?');
    await fs.mkdir(directory);
    const bootstrapPath = path.join(directory, 'bootstrap.mjs');
    await fs.writeFile(bootstrapPath, 'export default ' + JSON.stringify({
      name: 'file-url-probe', processes: [{ name: 'worker', module: './worker #2%?.mjs' }],
    }));
    // An observable module evaluation, before Titan starts any application.
    // A truncated or percent-decoded path instead fails module resolution.
    await fs.writeFile(path.join(directory, 'worker #2%?.mjs'), 'throw new Error("exact-worker-file-evaluated");');
    const script = `import assert from 'node:assert/strict';
      import Worker from ${JSON.stringify(pathToFileURL(path.join(root, kind + '.js')).href)};
      await assert.rejects(new Worker().init(${JSON.stringify({ bootstrapPath, processName: 'worker' })}),
        { message: 'exact-worker-file-evaluated' });`;
    const env = { ...process.env }; delete env['NODE_OPTIONS'];
    // Plain Node exercises URL parsing without the test runner's module resolver.
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });
});
