// Run against the actual npm consumers, including the native libraries npm selected for this host.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [lumenRoot, kbRoot] = process.argv.slice(2);
const loader = root => createRequire(path.resolve(root, 'package.json'));
const from = (require, name) => createRequire(require.resolve(name));
const vite = from(from(loader(lumenRoot), '@omnitron-dev/lumen'), 'vite');
const kb = loader(kbRoot);
const common = from(from(from(kb, '@omnitron-dev/kb'), 'ts-morph'), '@ts-morph/common');
const fixture = await mkdtemp(path.join(os.tmpdir(), 'omni-glob-consumer-'));
try {
  await mkdir(path.join(fixture, 'src/nested'), { recursive: true });
  await writeFile(path.join(fixture, 'src/nested/greet.ts'), 'export const greeting = 42;');
  await writeFile(path.join(fixture, 'src/nested/info.txt'), 'example');
  const pattern = 'src/**/*.{ts,tsx}';
  for (const require of [vite, common]) {
    const tiny = from(require, 'tinyglobby');
    assert.deepEqual(tiny('tinyglobby').globSync(pattern, { cwd: fixture }), ['src/nested/greet.ts']);
    for (const importer of [tiny, from(tiny, 'fdir'), ...(require === vite ? [vite] : [])]) {
      const matches = importer('picomatch')(pattern);
      assert.equal(matches('src/nested/greet.ts'), true);
      assert.equal(matches('src/nested/info.txt'), false);
      assert.equal(matches('src/.ignored/generated.ts'), false);
      assert.ok(importer('picomatch')('src/@(nested|shared)/gr??t.ts')('src/nested/greet.ts'));
    }
  }
  const { build } = await import(pathToFileURL(vite.resolve('vite')));
  const output = await build({ root: fixture, configFile: false, logLevel: 'silent', build: { write: false,
    lib: { entry: 'src/nested/greet.ts', formats: ['es'], fileName: 'example' } } });
  assert.ok(output[0].output.some(chunk => chunk.type === 'chunk' && chunk.code.includes('42')));
  assert.ok(vite('lightningcss').transform({ filename: 'example.css', code: Buffer.from('.example { color: red }') }).code.length);

  await writeFile(path.join(fixture, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
  const { TsMorphExtractor } = await import(pathToFileURL(kb.resolve('@omnitron-dev/kb/extractors')));
  const result = await new TsMorphExtractor().extract({ packageRoot: fixture, packageName: 'example', packageVersion: '1.0.0',
    config: { name: 'Example', module: 'example', extract: { decorators: [] } } });
  assert.deepEqual(Object.keys(result.manifest.files), ['src/nested/greet.ts']);
  assert.ok(result.symbols.some(symbol => symbol.name === 'greeting'));
  console.log(process.platform, process.arch, process.version, 'Lumen Vite build, native CSS, KB extraction and glob contracts passed');
} finally {
  await rm(fixture, { recursive: true, force: true });
}
