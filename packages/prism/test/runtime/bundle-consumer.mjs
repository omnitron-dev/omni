/** Exercise the built public API with a consumer bundler, including packed CSS. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const packageRoot = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'prism-bundle-consumer-'));
const target = (subpath) => {
  const entry = manifest.exports[subpath];
  assert.ok(entry, `Missing public export ${subpath}`);
  return JSON.stringify(path.resolve(packageRoot, typeof entry === 'string' ? entry : entry.import));
};

async function bundle(source, { app = false } = {}) {
  const entry = path.join(temporary, 'consumer.mjs');
  await writeFile(entry, source);
  const result = await build({
    root: temporary,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      ...(app ? {} : { lib: { entry, formats: ['es'], fileName: 'consumer' } }),
      // Measure Prism's contribution and retained JavaScript peer imports
      // independently. CSS @imports use the package's installed stylesheet peers.
      rolldownOptions: {
        ...(app ? { input: entry, preserveEntrySignatures: 'strict' } : {}),
        external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const chunks = output.filter((item) => item.type === 'chunk');
  return {
    bytes: chunks.reduce((size, chunk) => size + Buffer.byteLength(chunk.code), 0),
    imports: [...new Set(chunks.flatMap((chunk) => chunk.imports))].sort(),
    assets: output.filter((item) => item.type === 'asset'),
    css: output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')),
  };
}

try {
  const direct = await bundle(`export { Card } from ${target('./components/card')};`);
  const results = [];
  for (const entry of ['.', './components']) {
    const result = await bundle(`export { Card } from ${target(entry)};`);
    assert.deepEqual(result.imports, direct.imports, `${entry} retains peers unused by Card`);
    assert.ok(result.bytes <= direct.bytes + 512, `${entry} retains unrelated component code`);
    assert.equal(result.css.length, 0, 'Card must not load optional component styles');
    results.push({ entry, bytes: result.bytes });
  }
  const calendar = await bundle(`export { PrismDatePicker } from ${target('./ui')};`);
  assert.ok(calendar.imports.includes('dayjs/locale/ru.js'), 'Calendar locale registration was removed');
  assert.ok(calendar.imports.includes('dayjs/plugin/utc.js'), 'Calendar wall-clock support was removed');
  const mathParser = await bundle(`export { parseResearchMarkdown } from ${target('./components/research')};`);
  assert.ok(!mathParser.imports.includes('micromark-extension-math'), 'The syntax parser must not install the upstream HTML renderer');
  assert.ok(!mathParser.imports.includes('katex'), 'Parsing must not load the equation renderer');
  const reader = await bundle(`export { ResearchDocument } from ${target('./components/research')};`);
  assert.ok(reader.imports.includes('katex'), 'The research reader must use the declared equation renderer');
  const map = await bundle(`export { Map } from ${target('./components/map')};`);
  assert.ok(map.imports.includes('maplibre-gl'), 'Selected map engine was removed');
  assert.ok(map.imports.includes('pmtiles'), 'Selected map protocol was removed');
  const mapApp = await bundle(`export { MapPointPicker } from ${target('./components/map')};`, { app: true });
  const engineWorker = await readFile(new URL(import.meta.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')));
  assert.ok(mapApp.assets.some(asset => asset.fileName.endsWith('.mjs') && Buffer.from(asset.source).equals(engineWorker)),
    'Map consumers must emit the complete module worker from the installed engine');
  const styles = Object.keys(manifest.exports).filter((entry) => entry.endsWith('.css'));
  assert.ok(styles.length > 0, 'No public stylesheets were packed');
  for (const entry of styles) {
    const styled = await bundle(`import ${target(entry)}; export const loaded = true;`);
    assert.ok(styled.css.some((asset) => asset.source.length > 0), `${entry} was removed`);
    if (entry === './components/map/styles.css') {
      assert.ok(styled.css.some((asset) => String(asset.source).includes('.maplibregl-map')),
        'Map engine styles were removed');
    }
  }
  console.log(JSON.stringify({ check: 'prism-consumer-bundles', passed: true, card: results }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
