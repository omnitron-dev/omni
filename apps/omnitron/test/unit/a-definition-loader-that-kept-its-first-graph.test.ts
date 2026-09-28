/**
 * A definition loader that kept its first graph.
 *
 * In dev the daemon imported each app's definition (`apps/<app>/src/bootstrap.ts`)
 * into its own process. The `?t=` on the URL imports the definition FILE again,
 * but Node keeps every PACKAGE the definition imports in the process's module
 * graph as it was at its first import — for the daemon's life. Measured
 * 2026-09-27 on the dev master: `@daos/auth-utils`, whose exports point at its
 * TypeScript source, gained `refuseOwedLegalAcceptance`; storage's definition
 * began importing it, and dev storage would not start — «The requested module
 * '@daos/auth-utils' does not provide an export named
 * 'refuseOwedLegalAcceptance'» — through a package rebuild and a `stack
 * start`, until the daemon itself was restarted.
 *
 * The daemon now reads a dev definition in a process of its own
 * (`freshModuleGraph`). This court builds the situation for real: a workspace
 * package whose entry is TypeScript source, linked into `node_modules` as pnpm
 * links one, an ESM app whose definition imports it, and two reads with the
 * package changed in between — a new export, and the definition using it. The
 * second read has to see the new value. It is asked for at each door the
 * daemon reads through: the loader, in a process started as the daemon is;
 * the orchestrator's start; the requirements scanner.
 */
import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBootstrapConfig } from '../../src/orchestrator/bootstrap-loader.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { scanRequirements } from '../../src/project/requirements-scanner.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loaderUrl = pathToFileURL(path.join(packageRoot, 'src/orchestrator/bootstrap-loader.ts')).href;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A project as the daemon finds one: `packages/kit` — entry `./src/index.ts`,
 * linked as `node_modules/@probe/kit` — and `apps/probe`, an ESM app whose
 * definition imports it.
 */
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-fresh-graph-'));
  made.push(root);
  const kitDir = path.join(root, 'packages', 'kit');
  const app = path.join(root, 'apps', 'probe');
  fs.mkdirSync(path.join(kitDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', '@probe'), { recursive: true });
  fs.writeFileSync(
    path.join(kitDir, 'package.json'),
    JSON.stringify({ name: '@probe/kit', version: '1.0.0', type: 'module', exports: { '.': './src/index.ts' } }),
  );
  fs.symlinkSync(kitDir, path.join(root, 'node_modules', '@probe', 'kit'), 'dir');
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: '@probe/app', version: '1.0.0', type: 'module' }));
  const kit = path.join(kitDir, 'src', 'index.ts');
  const definition = path.join(app, 'src', 'bootstrap.ts');
  return {
    root,
    app,
    kit,
    definition,
    writeKit: (source: string) => fs.writeFileSync(kit, source),
    writeDefinition: (source: string) => fs.writeFileSync(definition, source),
    file: (name: string) => path.join(root, name),
  };
}

/** A definition whose one process is named by what `names` evaluates to. */
const definitionNaming = (imports: string, names: string) =>
  `import { ${imports} } from '@probe/kit';\n` +
  `export default { name: 'probe', version: '1.0.0', processes: [{ name: ${names}, module: './app.module.js' }] };\n`;

const KIT_BEFORE = `export const a: string = 'a1';\n`;
const KIT_AFTER = `export const a: string = 'a2';\nexport const b: string = 'b2';\n`;
const DEFINITION_BEFORE = definitionNaming('a', 'a');
const DEFINITION_AFTER = definitionNaming('a, b', "a + '+' + b");

const freshRead = (definition: string, timeoutMs?: number) =>
  loadBootstrapConfig(definition, {
    devMode: true,
    freshModuleGraph: timeoutMs === undefined ? true : { timeoutMs },
  });

/** Whether a pid names a live process (a zombie still does: this is asked after the reap). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('a definition read after a package it imports gained an export', () => {
  it('is read against the package as it is now, by a reader started as the daemon is', () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(DEFINITION_BEFORE);

    // The reader stands where spawn-daemon puts the daemon — the package root,
    // `--import tsx/esm` — and reads twice with the package changed between.
    const script = [
      `const { loadBootstrapConfig } = await import(${JSON.stringify(loaderUrl)});`,
      `const fs = await import('node:fs');`,
      `const read = () => loadBootstrapConfig(${JSON.stringify(p.definition)}, { devMode: true, freshModuleGraph: true });`,
      `console.log('FIRST=' + (await read()).processes[0].name);`,
      `fs.writeFileSync(${JSON.stringify(p.kit)}, ${JSON.stringify(KIT_AFTER)});`,
      `fs.writeFileSync(${JSON.stringify(p.definition)}, ${JSON.stringify(DEFINITION_AFTER)});`,
      `try { console.log('SECOND=' + (await read()).processes[0].name); }`,
      `catch (err) { console.log('SECOND FAILED: ' + err.message); }`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 120_000,
    });

    expect(r.stdout, r.stderr).toContain('FIRST=a1');
    expect(r.stdout, r.stderr).toContain('SECOND=a2+b2');
  }, 150_000);

  it('starts the app with the topology the package gives now, not the one it gave first', async () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(DEFINITION_BEFORE);

    // `launchBootstrapMode` as a dev daemon runs it, up to the build that
    // follows the read: the build service is where the definition is handed
    // on, so that is where it is looked at, and where the start stops.
    const seen: Array<{ processes: Array<{ name: string }> }> = [];
    const self = {
      devMode: true,
      cwd: p.root,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      buildResults: new Map(),
      buildService: {
        isWatching: () => false,
        buildApp: async (_app: string, _bootstrap: string, definition: { processes: Array<{ name: string }> }) => {
          seen.push(definition);
          throw new Error('stopped once the definition was read');
        },
      },
    };
    const launch = (OrchestratorService.prototype as any).launchBootstrapMode;
    const start = () => launch.call(self, { name: 'probe', bootstrap: p.definition }, { markStarting: vi.fn() }, {});

    await expect(start()).rejects.toThrow('stopped once the definition was read');
    p.writeKit(KIT_AFTER);
    p.writeDefinition(DEFINITION_AFTER);
    await expect(start()).rejects.toThrow('stopped once the definition was read');

    expect(seen.map((d) => d.processes[0]!.name)).toEqual(['a1', 'a2+b2']);
  }, 60_000);

  it('is scanned for its jwt flag as the package sets it now', async () => {
    const p = project();
    fs.mkdirSync(path.join(p.app, 'config'));
    fs.writeFileSync(path.join(p.app, 'config', 'default.json'), JSON.stringify({ omnitron: { database: true } }));
    const definitionWithJwt = (flag: string) =>
      `import { ${flag} } from '@probe/kit';\n` +
      `export default {\n` +
      `  name: 'probe', version: '1.0.0',\n` +
      `  processes: [{ name: 'http', module: './app.module.js' }],\n` +
      // A wrapper cannot be carried out of the reading process; the flag beside it must be.
      `  auth: { jwt: { enabled: ${flag} }, invocationWrapper: async (_m: unknown, fn: () => Promise<unknown>) => fn() },\n` +
      `};\n`;
    p.writeKit(`export const jwtOff: boolean = false;\n`);
    p.writeDefinition(definitionWithJwt('jwtOff'));
    const scan = () => scanRequirements([{ name: 'probe', bootstrap: 'apps/probe/src/bootstrap.ts' }], p.root);

    expect((await scan()).needsAuth).toBe(false);
    p.writeKit(`export const jwtOff: boolean = false;\nexport const jwtOn: boolean = true;\n`);
    p.writeDefinition(definitionWithJwt('jwtOn'));
    const second = await scan();

    expect(second.needsAuth).toBe(true);
    expect(second.databases).toEqual([{ app: 'probe', database: 'probe', pool: undefined, extensions: undefined }]);
  }, 60_000);
});

describe('what the daemon gets back', () => {
  it('is the data it reads, without what only the app can use, and a cycle does not stop it', async () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(`import { a } from '@probe/kit';
class Client {
  readonly socket = { fd: 7 };
  readonly self: Client;
  constructor() { this.self = this; }
  query(): void {}
}
const jwt = { enabled: true, tokenCacheTtl: 60_000 };
const logging: { level: string; self?: unknown } = { level: 'info' };
logging.self = logging;
export default {
  name: 'probe-' + a,
  version: '1.0.0',
  processes: [
    {
      name: 'http',
      module: './app.module.js',
      critical: true,
      transports: { http: { port: 3002, host: '0.0.0.0', cors: true } },
      topology: { access: ['Worker'] },
      hooks: { afterCreate: async () => {} },
      customRoutes: [{ method: 'GET', pattern: '/object/*', handler: async () => null }],
      auth: { jwt },
    },
    { name: 'worker', module: './worker.module.js', instances: 2, topology: { expose: true }, auth: { jwt } },
  ],
  requires: { postgres: { pool: { min: 1, max: 5 } }, redis: { prefix: 'probe:' } },
  auth: {
    jwt,
    rls: (ctx: unknown) => ctx,
    invocationWrapper: async (_meta: Map<string, unknown>, fn: () => Promise<unknown>) => fn(),
    manager: new Client(),
  },
  config: { sources: [{ type: 'file', path: 'apps/probe/config/default.json', optional: true }], envPrefix: 'PROBE_' },
  shutdown: { priority: 10, timeout: 15_000, drainConnections: true },
  observability: { logging },
};
`);

    const definition = await freshRead(p.definition);

    expect(definition).toStrictEqual({
      name: 'probe-a1',
      version: '1.0.0',
      processes: [
        {
          name: 'http',
          module: './app.module.js',
          critical: true,
          transports: { http: { port: 3002, host: '0.0.0.0', cors: true } },
          topology: { access: ['Worker'] },
          hooks: {},
          customRoutes: [{ method: 'GET', pattern: '/object/*' }],
          auth: { jwt: { enabled: true, tokenCacheTtl: 60_000 } },
        },
        // The same `jwt` object, reached a second time without a cycle: kept.
        {
          name: 'worker',
          module: './worker.module.js',
          instances: 2,
          topology: { expose: true },
          auth: { jwt: { enabled: true, tokenCacheTtl: 60_000 } },
        },
      ],
      requires: { postgres: { pool: { min: 1, max: 5 } }, redis: { prefix: 'probe:' } },
      auth: { jwt: { enabled: true, tokenCacheTtl: 60_000 } },
      config: { sources: [{ type: 'file', path: 'apps/probe/config/default.json', optional: true }], envPrefix: 'PROBE_' },
      shutdown: { priority: 10, timeout: 15_000, drainConnections: true },
      observability: { logging: { level: 'info' } },
    });
  }, 60_000);

  it('leaves the functions to a load that runs the app', async () => {
    // bootstrap-process and module-worker-process load without
    // `freshModuleGraph`: the hooks and the wrapper are what they run.
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(`import { a } from '@probe/kit';
export default {
  name: 'probe', version: '1.0.0',
  processes: [{ name: a, module: './app.module.js', hooks: { afterCreate: async () => {} } }],
  auth: { jwt: { enabled: true }, invocationWrapper: async (_m: unknown, fn: () => Promise<unknown>) => fn() },
};
`);

    const definition = await loadBootstrapConfig(p.definition, { devMode: true });

    expect(typeof definition.auth?.invocationWrapper).toBe('function');
    expect(typeof definition.processes[0]!.hooks?.afterCreate).toBe('function');
  }, 60_000);
});

describe('a definition that does not load', () => {
  it('is refused in its own words, after the app\'s name and path', async () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(`import { a } from '@probe/kit';\nvoid a;\nthrow new Error('the probe will not be read');\n`);
    const self = { devMode: true, cwd: p.root, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
    const launch = (OrchestratorService.prototype as any).launchBootstrapMode;

    await expect(
      launch.call(self, { name: 'probe', bootstrap: p.definition }, { markStarting: vi.fn() }, {}),
    ).rejects.toThrow(`Could not load probe's definition from ${p.definition}: the probe will not be read`);
  }, 60_000);

  it('names the export its package does not have', async () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(definitionNaming('a, b', "a + '+' + b"));

    await expect(freshRead(p.definition)).rejects.toThrow(
      "The requested module '@probe/kit' does not provide an export named 'b'",
    );
  }, 60_000);
});

describe('the process that reads it', () => {
  it('is gone when the read is over, though the definition left a timer running', async () => {
    const p = project();
    const pidFile = p.file('reader.pid');
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(`import { writeFileSync } from 'node:fs';
import { a } from '@probe/kit';
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1_000);
export default { name: 'probe', version: '1.0.0', processes: [{ name: a, module: './app.module.js' }] };
`);

    const started = Date.now();
    const definition = await freshRead(p.definition, 120_000);
    const took = Date.now() - started;

    expect(definition.processes[0]!.name).toBe('a1');
    // Far inside the deadline: it exited, it was not killed there.
    expect(took).toBeLessThan(60_000);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(pid).not.toBe(process.pid);
    expect(isAlive(pid)).toBe(false);
  }, 180_000);

  it('is killed at the deadline when the definition never finishes loading', async () => {
    const p = project();
    const pidFile = p.file('reader.pid');
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(`import { writeFileSync } from 'node:fs';
import { a } from '@probe/kit';
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1_000);
await new Promise(() => {});
export default { name: 'probe', version: '1.0.0', processes: [{ name: a, module: './app.module.js' }] };
`);

    const started = Date.now();
    await expect(freshRead(p.definition, 3_000)).rejects.toThrow(
      'the process reading the definition did not answer within 3 s and was killed',
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(pid).not.toBe(process.pid);
    expect(isAlive(pid)).toBe(false);
  }, 60_000);

  it('does not start another from inside a reading process', async () => {
    const p = project();
    p.writeKit(KIT_BEFORE);
    p.writeDefinition(DEFINITION_BEFORE);
    process.env['OMNITRON_BOOTSTRAP_LOADER_CHILD'] = '1';
    try {
      await expect(freshRead(p.definition)).rejects.toThrow('a process reading a definition does not start another');
    } finally {
      delete process.env['OMNITRON_BOOTSTRAP_LOADER_CHILD'];
    }
  });
});
