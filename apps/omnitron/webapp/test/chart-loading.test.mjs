import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'vite';

test('opening a Console route defers the chart engine until interactive history is needed', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const { output } = await build({ root, logLevel: 'error', build: { write: false } });
  const chunks = new Map(output.filter(file => file.type === 'chunk').map(chunk => [chunk.fileName, chunk]));
  const engine = new Set([...chunks.values()]
    .filter(chunk => chunk.moduleIds.some(id => /\/node_modules\/(?:apexcharts|react-apexcharts)\//.test(id)))
    .map(chunk => chunk.fileName));
  assert.ok(engine.size > 0, 'the release must contain the interactive chart engine');

  function loadsEngine(route, includeLazy) {
    const visited = new Set();
    const pending = [route.fileName];
    while (pending.length) {
      const name = pending.pop();
      if (engine.has(name)) return true;
      if (visited.has(name)) continue;
      visited.add(name);
      const chunk = chunks.get(name);
      if (chunk) pending.push(...chunk.imports, ...(includeLazy ? chunk.dynamicImports : []));
    }
    return false;
  }

  for (const route of ['dashboard', 'apps/detail', 'dashboard-builder', 'metrics', 'topology']) {
    const entry = [...chunks.values()].find(chunk => chunk.facadeModuleId?.endsWith(`/src/pages/${route}.tsx`));
    assert.ok(entry, `missing route ${route}`);
    assert.equal(loadsEngine(entry, false), false, `${route} eagerly loads ApexCharts`);
    if (route !== 'dashboard') assert.equal(loadsEngine(entry, true), true, `${route} cannot open chart history`);
  }
});
