import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('stamps clean sources while tsup loads a generated config, but detects real source edits', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-build-stamp-'));
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const pkg = path.join(directory, 'packages/netron-react');
  const marker = path.join(pkg, 'node_modules/loaded');
  const release = path.join(pkg, 'node_modules/release');
  const config = path.join(pkg, 'tsup.config.ts');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  let pending: Promise<unknown> | undefined;
  try {
    await fs.mkdir(path.join(pkg, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(directory, 'dist'));
    await fs.copyFile(path.join(root, '.gitignore'), path.join(directory, '.gitignore'));
    await fs.writeFile(path.join(pkg, 'package.json'), '{"type":"module"}');
    const source = `import { writeFile, access } from 'node:fs/promises';
      import { setTimeout } from 'node:timers/promises';
      await writeFile(${JSON.stringify(marker)}, 'ready');
      const deadline = Date.now() + 15000;
      while (true) {
        try { await access(${JSON.stringify(release)}); break; } catch {}
        if (Date.now() > deadline) throw Error('Qualification did not release the config loader');
        await setTimeout(10);
      }
      export default {};`;
    await fs.writeFile(config, source);
    git('init', '--quiet'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture');
    const require = createRequire(path.join(root, 'packages/netron-react/package.json'));
    const loader = createRequire(require.resolve('tsup')).resolve('bundle-require');
    const { bundleRequire } = await import(loader);
    pending = bundleRequire({ filepath: config });
    const deadline = Date.now() + 10000;
    while (true) {
      try { await fs.access(marker); break; } catch {}
      if (Date.now() > deadline) throw Error('tsup config loader did not reach the fixture');
      await delay(10);
    }
    expect((await fs.readdir(pkg)).some(name => /^tsup\.config\.bundled_.+\.mjs$/.test(name))).toBe(true);
    const stamp = async () => {
      execFileSync(process.execPath, [path.join(root, 'apps/omnitron/scripts/stamp-build.mjs'), 'dist'],
        { cwd: directory, stdio: 'pipe' });
      return JSON.parse(await fs.readFile(path.join(directory, 'dist/BUILD.json'), 'utf8'));
    };
    expect((await stamp()).dirty, git('status', '--porcelain')).toBe(false);
    await fs.writeFile(config, source + '\n// changed source\n');
    expect((await stamp()).dirty).toBe(true);
    await fs.writeFile(config, source);
    await fs.writeFile(path.join(pkg, 'source.ts'), 'export const changed = true;');
    expect((await stamp()).dirty).toBe(true);
    await fs.unlink(path.join(pkg, 'source.ts'));
    expect((await stamp()).dirty).toBe(false);
  } finally {
    await fs.writeFile(release, 'done').catch(() => {});
    try { await pending; } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}, 25000);
