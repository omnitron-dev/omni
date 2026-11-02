/** Black-box regression: compile, pack and inspect two independent clean clones. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const stamp = path.resolve(here, '../../scripts/stamp-build.mjs');
const dist = path.resolve(process.argv[2] ?? 'dist');
const { archiveBundle, buildBundle } = await import(pathToFileURL(path.join(dist, 'services/bundle-builder.js')));
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-repro-'));
const run = (cwd, bin, args) => execFileSync(bin, args, { cwd, stdio: 'pipe', timeout: 60_000 });
try {
  const origin = path.join(tmp, 'source');
  const lib = path.join(origin, 'packages', 'lib'), app = path.join(origin, 'apps', 'api');
  await fs.mkdir(lib, { recursive: true }); await fs.mkdir(app, { recursive: true });
  await fs.writeFile(path.join(origin, '.gitignore'), 'dist/\nnode_modules/\n');
  await fs.writeFile(path.join(origin, 'package.json'), '{"name":"fixture","private":true,"packageManager":"pnpm@12.16.1"}');
  await fs.writeFile(path.join(origin, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n');
  await fs.writeFile(path.join(lib, 'package.json'), '{"name":"@fixture/lib","version":"1.0.0","files":["dist"]}');
  await fs.writeFile(path.join(lib, 'src.ts'), 'export const value: number = 42;\n');
  await fs.writeFile(path.join(app, 'package.json'), '{"name":"@fixture/api","version":"1.0.0","dependencies":{"@fixture/lib":"workspace:*"}}');
  run(origin, 'git', ['init', '-q']); run(origin, 'git', ['add', '.']);
  run(origin, 'git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture']);
  async function build(label) {
    const root = path.join(tmp, label);
    run(tmp, 'git', ['clone', '-q', '--no-local', origin, root]);
    const pkg = path.join(root, 'packages/lib');
    run(pkg, process.execPath, [require.resolve('typescript/lib/tsc.js'), '--ignoreConfig', '--skipLibCheck', '--target', 'ES2022', '--outDir', 'dist', 'src.ts']);
    run(pkg, process.execPath, [stamp, 'dist']);
    const dir = path.join(tmp, 'bundle-' + label);
    await buildBundle({ workspaceRoot: root, rootPackage: '@fixture/api', outDir: dir });
    const archive = await archiveBundle(dir, dir + '.tgz');
    return { archive: await hash(archive), library: await hash(path.join(dir, 'vendor/fixture-lib-1.0.0.tgz')), dir };
  }
  const one = await build('one'), two = await build('two');
  assert.equal(one.library, two.library, 'fresh packed dependency must be identical without sharing a cache');
  assert.equal(one.archive, two.archive, 'clean builds must produce identical archive bytes');
  const extracted = path.join(tmp, 'readback'); await fs.mkdir(extracted);
  run(extracted, 'tar', ['-xf', two.dir + '.tgz']);
  run(extracted, 'tar', ['-xf', 'vendor/fixture-lib-1.0.0.tgz']);
  assert.match(await fs.readFile(path.join(extracted, 'package/dist/src.js'), 'utf8'), /42/);
  assert.equal(JSON.parse(await fs.readFile(path.join(extracted, 'package/dist/BUILD.json'), 'utf8')).timeBasis, 'source');
  const manifest = path.join(two.dir, 'package.json');
  await fs.chmod(manifest, 0o700);
  assert.notEqual(await hash(await archiveBundle(two.dir, path.join(tmp, 'mode.tgz'))), one.archive);
  await fs.chmod(manifest, 0o644); await fs.appendFile(manifest, '\n');
  assert.notEqual(await hash(await archiveBundle(two.dir, path.join(tmp, 'changed.tgz'))), one.archive);
  console.log(JSON.stringify({ cleanBuilds: 2, sameArchive: one.archive, contentAndExecuteChangesDetected: true }));
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
