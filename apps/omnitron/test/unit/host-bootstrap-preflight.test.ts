import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapPreflightCommand, type HostUpgradePlan } from '../../src/services/host-upgrade.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-reader-'))); made.push(root);
  const candidate = root + '/candidate', previous = root + '/previous', proc = root + '/proc/100';
  const operator = root + '/operator';
  for (const dir of [candidate + '/dist/orchestrator', previous + '/dist/daemon', proc, operator]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(previous + '/dist/daemon/daemon-entry.js', '');
  fs.writeFileSync(candidate + '/package.json', '{"type":"module"}');
  fs.symlinkSync(packageRoot + '/node_modules', candidate + '/node_modules', 'dir');
  fs.writeFileSync(candidate + '/dist/orchestrator/bootstrap-loader.js',
    `export {loadBootstrapConfig} from ${JSON.stringify(pathToFileURL(packageRoot + '/src/orchestrator/bootstrap-loader.ts').href)};`);
  const bootstrap = root + '/bootstrap.mjs';
  fs.writeFileSync(bootstrap, `if(process.cwd()!==${JSON.stringify(operator)}||process.env.PREFLIGHT_VALUE!=='a=b') throw Error('Wrong daemon cwd or environment');
    export default {name:'probe',processes:[{name:'api',module:'./module.js'}]};`);
  fs.symlinkSync(fs.realpathSync(process.execPath), proc + '/exe');
  fs.symlinkSync(operator, proc + '/cwd');
  fs.writeFileSync(proc + '/cmdline', [process.execPath, '--import', 'tsx/esm', previous + '/dist/daemon/daemon-entry.js', ''].join('\0'));
  fs.writeFileSync(proc + '/environ', 'PREFLIGHT_VALUE=a=b\0');
  const plan: HostUpgradePlan = {
    previous: { root: previous, version: 'old', commit: 'a'.repeat(40) },
    candidate: { root: candidate, version: 'new', commit: 'b'.repeat(40) }, apps: [], online: ['p/prod/api', 'p/prod/worker', 'p/prod/classic'], offline: ['p/idle/api'],
    inventory: {
      runtime: { kind: 'fork', cwd: operator, executable: fs.realpathSync(process.execPath), execArgv: ['--import', 'tsx/esm'] },
      status: { version: 'old', pid: 100, build: { commit: 'a'.repeat(40), dirty: false }, apps: [] }, projects: [], stacks: [], contracts: [],
      launches: [
        { name: 'p/prod/api', bootstrap }, { name: 'p/prod/worker', bootstrap },
        { name: 'p/prod/classic', bootstrap: null }, { name: 'p/idle/api', bootstrap: root + '/offline-do-not-import.mjs' },
      ],
    },
  };
  const run = () => execSync(bootstrapPreflightCommand(plan, root + '/proc'), { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return { root, plan, run, bootstrap, proc };
}

describe('candidate bootstrap preflight before a maintenance window', () => {
  it('uses the captured cwd and private environment, deduplicates readers and leaves offline apps alone', () => {
    const f = fixture();
    expect(JSON.parse(f.run())).toEqual({ checked: ['p/prod/api'], classic: 1, total: 3 });
    expect(JSON.stringify(f.plan)).not.toContain('a=b');
  });
  it('reports the specific application and import failure without starting an application', () => {
    const f = fixture(); fs.writeFileSync(f.bootstrap, "throw Error('incompatible module export');");
    expect(f.run).toThrow(/Candidate bootstrap preflight failed for p\/prod\/api.*incompatible module export/s);
  });
  it('refuses a stale process identity and incomplete boot inventory', () => {
    const f = fixture(); fs.writeFileSync(f.proc + '/cmdline', 'another-program\0');
    expect(f.run).toThrow();
    f.plan.inventory.launches!.pop();
    expect(() => bootstrapPreflightCommand(f.plan)).toThrow('bootstrap launch inventory');
  });
});
