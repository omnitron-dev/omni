import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, 'Pure policy must not acquire runtime dependencies');
assert.equal(manifest.sideEffects, false);
const fixtures = {
  permissions: "export { createPermissionChecker } from '@omnitron-dev/access/permissions'",
  rootPermissions: "export { createPermissionChecker } from '@omnitron-dev/access'",
  roles: "export { createRoleHierarchy } from '@omnitron-dev/access/roles'",
  platform: "export * from '@omnitron-dev/access/platform'",
};
for (const [name, contents] of Object.entries(fixtures)) {
  const result = await build({
    absWorkingDir: root,
    stdin: { contents, resolveDir: root, sourcefile: `${name}.js` },
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    minify: true, write: false, metafile: true,
  });
  const output = result.outputFiles[0];
  const contributing = Object.values(result.metafile.outputs).flatMap(item =>
    Object.entries(item.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path));
  assert(contributing.every(path => path === `${name}.js` || path.startsWith('dist/')), 'Unexpected external module in browser bundle');
  if (name !== 'platform') assert(!contributing.some(path => path.includes('platform-roles')), 'Preset leaked into core import');
  if (name.includes('ermissions')) assert(!contributing.some(path => path.includes('role-hierarchy')), 'Role factory leaked into permission-only import');
  // Small enough to catch accidental adapter/framework imports, without timing-sensitive tests.
  assert(output.contents.length < 8_192, `${name} exceeded the 8 KiB minified policy budget`);
  console.log(`${name}: ${output.contents.length} bytes minified; ${gzipSync(output.contents).length} bytes gzip`);
}
