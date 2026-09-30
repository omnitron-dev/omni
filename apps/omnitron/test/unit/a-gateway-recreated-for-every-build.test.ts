/**
 * A gateway recreated for every build, and the second of silence that cost.
 *
 * The static volume's SOURCE was the build directory —
 * `/opt/omnitron/stack-static/gateway/<16 hex>` — and every release has a
 * different one. That one field is the only part of the gateway's spec that
 * moves between releases: `mountedConfigDigest` is rooted at the config
 * directory, and a node's config root
 * (`~/.omnitron/stack-config/<project>/<stack>/<service>`) is stable. So the
 * reconciler found a changed spec every time and recreated the container.
 *
 * Measured by omni-3f's outage watcher on release 4, 2026-09-30 20:43:04:
 * **1 s during which the gateway answered 000** — not a 502, not a 503,
 * nothing at all — inside an 81 s deployment. The maintenance lock cannot
 * cover it: the container that would serve the lock's page is the one being
 * replaced.
 *
 * A node now mounts the static ROOT, whose path never changes, and serves
 * `/var/www/portal/current-<project>-<stack>` — a symlink the deployment swaps
 * with `rename(2)`. nginx resolves `root` per request and the gateway config
 * sets no `open_file_cache`, so nothing needs reloading and nothing needs
 * recreating.
 *
 * Only a node. On a master `staticDir` is a path INSIDE the project — daos
 * declares `apps/portal/dist` — and mounting its parent would put `src/`,
 * `node_modules` and `vite.config.ts` under the web root, while
 * `current-…` would not be there at all and the entrypoint would fall back to
 * proxying a Vite that is not running.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { resolveGateway, setContainerPrefix, setStackLabels } from '../../src/infrastructure/service-resolver.js';
import { gatewayStaticLinkName } from '../../src/services/static-carry-forward.js';

const REDIS = { host: 'daos-test-redis', port: 6379, db: 5 };
const ROOT = '/opt/omnitron/stack-static/gateway';

/** What a node resolves for a given build: the root and the link, never the build. */
const onNode = (build: string) =>
  resolveGateway(
    {
      port: 8080,
      configDir: '.',
      staticDir: `${ROOT}/${build}`,
      staticLinkRoot: ROOT,
      staticLinkName: gatewayStaticLinkName('daos', 'test'),
    },
    REDIS,
    '/root/.omnitron/stack-config/daos/test/gateway',
  );

/** What the same call resolves when the node sent no root — today's behaviour. */
const withoutTheField = (build: string) =>
  resolveGateway(
    { port: 8080, configDir: '.', staticDir: `${ROOT}/${build}` },
    REDIS,
    '/root/.omnitron/stack-config/daos/test/gateway',
  );

const portalMount = (spec: ReturnType<typeof resolveGateway>) =>
  spec.volumes.find((v) => v.target === '/var/www/portal');

describe('a gateway serving through its stack’s link', () => {
  beforeEach(() => {
    setContainerPrefix('daos', 'test');
    setStackLabels('daos', 'test');
  });

  it('mounts the root, which does not change with the build', () => {
    const mount = portalMount(onNode('0d98bee79c410715'));
    expect(mount?.source, 'the build directory is still the mount').toBe(ROOT);
    expect(mount?.readonly).toBe(true);
  });

  it('is told to serve from the link, not from the mount', () => {
    expect(onNode('0d98bee79c410715').environment?.['PORTAL_ROOT']).toBe(
      '/var/www/portal/current-daos-test',
    );
  });

  it('resolves to the SAME spec for two different builds — nothing to recreate', () => {
    const a = onNode('0d98bee79c410715');
    const b = onNode('8f1c4e2a9b7d6035');

    // The whole point, stated as the reconciler sees it.
    expect(b.volumes).toEqual(a.volumes);
    expect(b.environment).toEqual(a.environment);
    expect(b.configDigest).toBe(a.configDigest);
  });

  it('names the link per stack, so one deployment cannot repoint another', () => {
    const test = onNode('0d98bee79c410715').environment?.['PORTAL_ROOT'];

    setContainerPrefix('daos', 'prod');
    setStackLabels('daos', 'prod');
    const prod = resolveGateway(
      {
        port: 8080,
        configDir: '.',
        staticDir: `${ROOT}/8f1c4e2a9b7d6035`,
        staticLinkRoot: ROOT,
        staticLinkName: gatewayStaticLinkName('daos', 'prod'),
      },
      REDIS,
      '/root/.omnitron/stack-config/daos/prod/gateway',
    ).environment?.['PORTAL_ROOT'];

    // The ROOT is shared by every stack on the node — the literal handed to
    // `uploadStaticBundle` names no project and no stack — so the link is
    // what keeps them apart.
    expect(prod).not.toBe(test);
    expect(test).toBe('/var/www/portal/current-daos-test');
    expect(prod).toBe('/var/www/portal/current-daos-prod');
  });
});

describe('a payload that carries no root', () => {
  beforeEach(() => {
    setContainerPrefix('daos', 'test');
    setStackLabels('daos', 'test');
  });

  /**
   * The field is ADDITIVE, and this is why it had to be.
   *
   * `staticRoots` travels master → node, and the two ends diverge by design:
   * admission requires a node's omni to equal the RELEASE's, while the
   * master's may legitimately be newer — on 2026-09-29 the master stood at
   * `f9892c17` while the node was on `b523b457`. A changed value type would
   * break both mixing directions. An old node ignores a field it does not
   * know; a new node sent none must do exactly what it did before, and «about
   * the same» is not a thing a reconciler can be told.
   */
  it('resolves byte for byte what it resolved before', () => {
    const before = withoutTheField('0d98bee79c410715');

    expect(portalMount(before)?.source, 'the mount moved for a node that sent no root').toBe(
      `${ROOT}/0d98bee79c410715`,
    );
    expect(before.environment?.['PORTAL_ROOT']).toBe('/var/www/portal');
  });

  it('still changes with the build, because for such a node it must', () => {
    // Without a link there is nothing to swap, so the build directory IS the
    // mount and a new build is a new spec. That is the old cost, and it is
    // the right behaviour for a node that cannot do better.
    const a = portalMount(withoutTheField('0d98bee79c410715'))?.source;
    const b = portalMount(withoutTheField('8f1c4e2a9b7d6035'))?.source;
    expect(a).not.toBe(b);
  });

  it('serves a master’s project-relative build from the build itself', () => {
    // The case that makes the field necessary rather than tidy: here the
    // parent is `apps/portal`, with `src/` and `node_modules` in it.
    const spec = resolveGateway(
      { port: 8080, configDir: 'infra/nginx', staticDir: 'apps/portal/dist' },
      REDIS,
      '/Users/dev/projects/daos',
    );
    expect(portalMount(spec)?.source).toBe('/Users/dev/projects/daos/apps/portal/dist');
    expect(spec.environment?.['PORTAL_ROOT']).toBe('/var/www/portal');
  });
});
