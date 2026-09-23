/**
 * An app definition read with the importer's tsconfig.
 *
 * The daemon runs with `--import tsx/esm` from apps/omnitron, and tsx
 * transforms a .ts file with the tsconfig of the process's WORKING DIRECTORY.
 * A project's bootstrap.ts is not included by that tsconfig, so it — and
 * everything it imports — was transformed without `experimentalDecorators`.
 * Measured on the master 2026-09-23: once paysys' and messaging's bootstraps
 * imported a file with a constructor `@Inject`, both definitions failed with
 * «Parameter decorators only work when experimental decorators are enabled»,
 * both apps fell into single-process mode, and both crashed there. Children
 * run from their app's directory and never saw it.
 *
 * This court reproduces the daemon's situation in a real child process: tsx
 * loaded, standing in a directory whose tsconfig does not cover the app.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = path.join(here, '../../src/orchestrator/bootstrap-loader.ts');
const tsxEsm = createRequire(path.join(here, '../../package.json')).resolve('tsx/esm');

describe('reading an app definition from a directory whose tsconfig does not cover it', () => {
  it('loads a bootstrap that imports a parameter decorator', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'omni-loader-'));
    try {
      mkdirSync(path.join(dir, 'app'));
      mkdirSync(path.join(dir, 'cwd', 'src'), { recursive: true });
      writeFileSync(
        path.join(dir, 'app', 'svc.ts'),
        `export const TOKEN = 'tok';
function Inject(_t: string) { return (_target: unknown, _key: unknown, _index: number) => {}; }
export class Svc { constructor(@Inject('x') readonly x: unknown) {} }
`,
      );
      writeFileSync(
        path.join(dir, 'app', 'bootstrap.ts'),
        `import { TOKEN, Svc } from './svc.js';
void Svc;
export default { name: 'probe-' + TOKEN, version: '0.0.0', processes: [{ name: 'http', type: 'server' }] };
`,
      );
      // Where the importer stands: a tsconfig that does not include the app,
      // exactly as apps/omnitron's does not include a project's sources.
      writeFileSync(path.join(dir, 'cwd', 'tsconfig.json'), JSON.stringify({ include: ['src/**/*'] }));

      const script =
        `const { loadBootstrapConfig } = await import(${JSON.stringify(pathToFileURL(loader).href)});` +
        `const d = await loadBootstrapConfig(${JSON.stringify(path.join(dir, 'app', 'bootstrap.ts'))}, { devMode: true });` +
        `console.log('NAME=' + d.name);`;
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(tsxEsm).href, '--input-type=module', '-e', script], {
        cwd: path.join(dir, 'cwd'),
        encoding: 'utf8',
        timeout: 60_000,
      });

      expect(`${r.stdout}${r.stderr}`).toContain('NAME=probe-tok');
      expect(`${r.stdout}${r.stderr}`).not.toMatch(/Parameter decorators only work/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
