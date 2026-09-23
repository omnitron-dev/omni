/**
 * A template read once for the daemon's life.
 *
 * The project service took an app's `omnitron` section from its
 * `config/default.json` «if not already set» — and set it by writing onto the
 * definition `loadBootstrapConfig` returned, which is the loader's cache
 * entry. The first read became the only read until the daemon restarted.
 *
 * Measured on daos/test, 2026-09-23: the master restarted at 15:45 and read
 * paysys's bitcoind unit with `Type=notify`; the template was fixed to
 * `Type=exec` at 15:53; the deployment at 16:48 — admitted because the tree
 * was exactly the release's commit — wrote the 15:45 unit to the node, and it
 * hung in `activating (start)` with bitcoind running inside it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';
import { loadBootstrapConfig } from '../../src/orchestrator/bootstrap-loader.js';
import { readDeclaredConfig, withDeclaredConfig } from '../../src/project/declared-config.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project with one app whose bootstrap is plain JS and whose template says `type`. */
function projectWith(unitType: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-config-'));
  made.push(root);
  const app = path.join(root, 'apps', 'paysys');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.mkdirSync(path.join(app, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(app, 'src', 'bootstrap.mjs'),
    "export default { name: 'paysys', processes: [{ name: 'http', type: 'server' }] };\n",
  );
  const writeTemplate = (type: string) =>
    fs.writeFileSync(
      path.join(app, 'config', 'default.json'),
      JSON.stringify({ omnitron: { infrastructure: { bitcoin: { bareMetal: { unitTemplate: `[Service]\nType=${type}\n` } } } } }),
    );
  writeTemplate(unitType);

  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registry: { get: () => ({ name: 'daos', path: root }), list: () => [] },
    resolveStackApps: () => [{ name: 'paysys', bootstrap: 'apps/paysys/src/bootstrap.mjs' }],
  });
  const templateOf = async () => {
    const defs = (await svc.loadAppDefinitions('daos', { type: 'remote', apps: 'all' }, {})) as Map<string, any>;
    return defs.get('paysys')?.omnitronConfig?.infrastructure?.bitcoin?.bareMetal?.unitTemplate as string | undefined;
  };
  return { root, bootstrap: path.join(app, 'src', 'bootstrap.mjs'), writeTemplate, templateOf };
}

describe('a deployment reads the template as it is now, not as it was at the daemon\'s start', () => {
  it('sees the fix committed after the first read', async () => {
    const p = projectWith('notify');
    expect(await p.templateOf()).toContain('Type=notify');

    p.writeTemplate('exec');

    expect(await p.templateOf()).toContain('Type=exec');
  });

  it('leaves the loader\'s cached definition as the bootstrap made it', async () => {
    const p = projectWith('notify');
    await p.templateOf();

    const cached = await loadBootstrapConfig(p.bootstrap, { devMode: false });
    expect(cached.omnitronConfig, 'written onto the cache entry').toBeUndefined();
  });
});

describe('the declared config, read now', () => {
  it('says absent and malformed apart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'declared-config-'));
    made.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    const bootstrap = path.join(root, 'src', 'bootstrap.mjs');

    expect(readDeclaredConfig(bootstrap)).toEqual({ configPath: path.join(root, 'config', 'default.json') });

    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'default.json'), '{ "omnitron": ');
    expect(readDeclaredConfig(bootstrap).malformed).toBeTruthy();

    fs.writeFileSync(path.join(root, 'config', 'default.json'), JSON.stringify({ logger: { level: 'debug' } }));
    expect(readDeclaredConfig(bootstrap)).toMatchObject({ loggerLevel: 'debug' });
  });

  it('lets a section the bootstrap declares in code win over the file', () => {
    const own = { name: 'x', processes: [], omnitronConfig: { infrastructure: { a: 1 } } } as never;
    expect(withDeclaredConfig(own, { configPath: 'p', omnitron: { infrastructure: { b: 2 } } as never })).toBe(own);
  });
});
