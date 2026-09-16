/**
 * The node had the artifacts and no idea what to do with them.
 *
 * A node's daemon starts apps it knows about, and it learns them from a
 * project directory with an `omnitron.config` in it. Remote deployment never
 * gave it one. Measured on the test node: artifacts at
 * `/opt/omnitron/artifacts/daos/{main,geo,priceverse}/0.0.1`, the daemon's own
 * log saying `No projects registered`, and
 *
 *     omnitron restart main  →  Failed: Unknown app: main
 *
 * So the fleet showed six apps deployed and ran none of them.
 *
 * This renders the master's definitions for the node, with every path pointing
 * at where that app actually is on THAT machine.
 */

import { describe, it, expect } from 'vitest';

import { selectNodeApps, renderNodeAppConfig } from '../../src/project/node-app-config.js';

const base = {
  project: 'daos',
  artifactRoot: '/opt/omnitron/artifacts',
  apps: [
    { name: 'main', bootstrap: './apps/main/src/bootstrap.ts', critical: true, startupTimeout: 180_000, watch: { directory: './apps/main' }, env: { PORT: '3001' } },
    { name: 'geo', bootstrap: './apps/geo/src/bootstrap.ts', dependsOn: ['main'] },
    { name: 'paysys', bootstrap: './apps/paysys/src/bootstrap.ts', dependsOn: ['main'] },
  ] as never,
  artifacts: [
    { app: 'main', version: '0.0.1' },
    { app: 'geo', version: '0.0.2' },
  ],
};

describe('paths are rewritten to where the app is on the node', () => {
  it('points bootstrap at the artifact, at its own version', () => {
    const apps = selectNodeApps(base);
    const main = apps.find((a) => a['name'] === 'main');
    const geo = apps.find((a) => a['name'] === 'geo');

    // Each app carries its OWN version: a deployment that updated one app and
    // not another would otherwise point both at the same directory, and one
    // of them at a directory that does not exist.
    expect(main!['bootstrap']).toBe('/opt/omnitron/artifacts/daos/main/0.0.1/dist/bootstrap.js');
    expect(geo!['bootstrap']).toBe('/opt/omnitron/artifacts/daos/geo/0.0.2/dist/bootstrap.js');
  });

  it('sets cwd to the artifact root so node_modules resolves', () => {
    // The artifact is `pnpm deploy` output: `dist/` beside a real
    // `node_modules`. Running with the wrong cwd finds neither.
    expect(selectNodeApps(base).find((a) => a['name'] === 'main')!['cwd']).toBe(
      '/opt/omnitron/artifacts/daos/main/0.0.1',
    );
  });

  it('drops what describes a developer’s machine', () => {
    // `watch` names a source directory to rebuild from. A node has no
    // sources, and a watcher following a path that does not exist — or one
    // that does and belongs to something else — is worse than no watcher.
    const main = selectNodeApps(base).find((a) => a['name'] === 'main')!;
    expect(main['watch']).toBeUndefined();
    expect(main['script']).toBeUndefined();
  });

  it('keeps what the supervisor needs', () => {
    const main = selectNodeApps(base).find((a) => a['name'] === 'main')!;
    expect(main['critical']).toBe(true);
    expect(main['startupTimeout']).toBe(180_000);
    expect(main['env']).toEqual({ PORT: '3001' });
  });
});

describe('an app with no artifact is not written into the config', () => {
  it('omits it entirely', () => {
    // Writing it with a path that is not there produces an app that fails at
    // startup for a reason the operator has to work out. Not listing it is
    // how the node already says "not deployed here".
    expect(selectNodeApps(base).map((a) => a['name'])).toEqual(['main', 'geo']);
  });

  it('drops a dependency on an app this node does not have', () => {
    // `geo` depends on `main`, which IS here — kept.
    expect(selectNodeApps(base).find((a) => a['name'] === 'geo')!['dependsOn']).toEqual(['main']);

    // With `main` absent, a dependency on it would make the supervisor wait
    // for something that is never going to start: the app never starts and
    // never fails either. Starting in a possibly-wrong order is recoverable
    // and visible; waiting forever is neither.
    const withoutMain = selectNodeApps({ ...base, artifacts: [{ app: 'geo', version: '0.0.2' }] });
    expect(withoutMain.find((a) => a['name'] === 'geo')!['dependsOn']).toBeUndefined();
  });

  it('produces an empty app list rather than a broken one', () => {
    expect(selectNodeApps({ ...base, artifacts: [] })).toEqual([]);
  });
});

describe('the file the node reads', () => {
  it('is valid JavaScript with a default export', () => {
    const out = renderNodeAppConfig(base);
    expect(out).toMatch(/^\/\//);
    expect(out).toContain('export default {');
    expect(() => JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))).not.toThrow();
  });

  it('says who wrote it and that editing is pointless', () => {
    // It will be read on a machine with no repository, by someone who did not
    // write it. "Where does this come from" is the first question, and a
    // generated file that does not answer it invites a local edit that the
    // next deployment silently discards.
    const out = renderNodeAppConfig(base);
    expect(out).toMatch(/Generated by omnitron/);
    expect(out).toMatch(/Do not edit/);
    expect(out).toMatch(/lost at the next one/);
  });

  it('names the apps it carries, including when there are none', () => {
    expect(renderNodeAppConfig(base)).toMatch(/Apps:\s+main, geo/);
    expect(renderNodeAppConfig({ ...base, artifacts: [] })).toMatch(/\(none deployed\)/);
  });
});

describe('the config carries a stack, because that is what starts apps', () => {
  it('declares one containing exactly the deployed apps', async () => {
    const { NODE_STACK } = await import('../../src/project/node-app-config.js');
    const rendered = renderNodeAppConfig(base);
    const parsed = JSON.parse(rendered.slice(rendered.indexOf('{'), rendered.lastIndexOf('}') + 1));

    // Registering a project does not start it: measured on the node,
    // `appsTotal: 0` with all six apps listed in the config it had just been
    // given. `startStack` refuses a name it cannot find, so the name has to
    // exist in the file.
    expect(parsed.stacks[NODE_STACK]).toBeDefined();
    expect(parsed.stacks[NODE_STACK].type).toBe('local');
    expect(parsed.stacks[NODE_STACK].apps).toEqual(['main', 'geo']);
  });

  it('lists in the stack only what it listed as apps', async () => {
    // Two lists that must agree. A stack naming an app the config does not
    // define fails at start with a name the reader will look for in the
    // wrong place.
    const { NODE_STACK } = await import('../../src/project/node-app-config.js');
    const rendered = renderNodeAppConfig({ ...base, artifacts: [{ app: 'geo', version: '1' }] });
    const parsed = JSON.parse(rendered.slice(rendered.indexOf('{'), rendered.lastIndexOf('}') + 1));

    expect(parsed.stacks[NODE_STACK].apps).toEqual(parsed.apps.map((a: { name: string }) => a.name));
  });
});
