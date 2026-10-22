import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildService } from '../../src/orchestrator/build-service.js';
import type { IAppDefinition } from '../../src/config/types.js';

const roots: string[] = [];
const builders: BuildService[] = [];
afterEach(async () => {
  for (const service of builders.splice(0)) await service.dispose();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-entry-graph-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['first', 'second'])
    fs.writeFileSync(path.join(root, name + '.ts'), `export default ${JSON.stringify(name)};`);
  const bootstrap = path.join(root, 'bootstrap.ts');
  const definition: IAppDefinition = {
    name: 'probe',
    version: '1',
    processes: [{ name: 'one', module: './first.ts' }],
  };
  fs.writeFileSync(bootstrap, 'export default ' + JSON.stringify(definition));
  const service = new BuildService(true);
  builders.push(service);
  return { root, bootstrap, definition, service };
}
describe('entry graph validity across watched restarts', () => {
  it('reuses only an intact build for exactly the same entries', async () => {
    const f = fixture(),
      result = await f.service.buildApp('probe', f.bootstrap, f.definition);
    expect(f.service.canReuseBuild(result, f.bootstrap, f.definition)).toBe(true);
    const two = { ...f.definition, processes: [...f.definition.processes, { name: 'two', module: './second.ts' }] };
    expect(f.service.canReuseBuild(result, f.bootstrap, two)).toBe(false);
    fs.writeFileSync(f.bootstrap, 'export default ' + JSON.stringify(two));
    const rebuilt = await f.service.buildApp('probe', f.bootstrap, two);
    expect(f.service.canReuseBuild(rebuilt, f.bootstrap, two)).toBe(true);
    expect((await import(pathToFileURL(rebuilt.modulePaths.get('two')!).href)).default).toBe('second');
    expect(f.service.canReuseBuild(rebuilt, f.bootstrap, f.definition)).toBe(false);
  });
  it('rejects a changed source even when the process name is unchanged', async () => {
    const f = fixture(),
      result = await f.service.buildApp('probe', f.bootstrap, f.definition);
    expect(
      f.service.canReuseBuild(result, f.bootstrap, {
        ...f.definition,
        processes: [{ name: 'one', module: './second.ts' }],
      })
    ).toBe(false);
  });
  it('does not reuse a missing module merely because bootstrap.js survives', async () => {
    const f = fixture(),
      result = await f.service.buildApp('probe', f.bootstrap, f.definition);
    fs.unlinkSync(result.modulePaths.get('one')!);
    expect(fs.existsSync(result.bootstrapPath)).toBe(true);
    expect(f.service.canReuseBuild(result, f.bootstrap, f.definition)).toBe(false);
  });
  it('rejects a missing bootstrap and legacy caches without an entry identity', async () => {
    const f = fixture(),
      result = await f.service.buildApp('probe', f.bootstrap, f.definition);
    expect(f.service.canReuseBuild({ ...result, sourceSignature: undefined }, f.bootstrap, f.definition)).toBe(false);
    fs.unlinkSync(result.bootstrapPath);
    expect(f.service.canReuseBuild(result, f.bootstrap, f.definition)).toBe(false);
  });
});
