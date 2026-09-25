/**
 * A mount that existed only on the master.
 *
 * A stack service that names a directory to ship had it sent to every node
 * that runs it (`readStackConfigFiles` → `writeStackConfigs`), and only the
 * gateway then mounted the node's copy — and only a preset could name one
 * (`config.configDir`). Every other service kept its bind mounts as the
 * project declared them — absolute paths on the master — so on a node docker
 * made an empty directory in their place. daos declares Nominatim as a stack
 * service with its import scripts bind-mounted from `infra/nominatim`, and
 * its entrypoint IS one of them; on daos/test it could only be declared
 * disabled, and geocoding there did not work (2026-09-25).
 *
 * Held here: a service names its directory itself (`configDir`), wherever it
 * is declared; the master points its mounts inside that directory at
 * `configroot:<service>/…`, in the stack's own services and in the ones its
 * apps require; the node writes its copy BEFORE it resolves either, resolves
 * `configroot:` to that copy and never outside it; what the copy holds is in
 * the container's spec hash; and a mount the node cannot resolve stays
 * visibly unresolved rather than becoming an empty directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { pointMountsAtShippedConfig, shippedMountPath } from '../../src/infrastructure/shipped-config.js';
import { resolveAppInfrastructure } from '../../src/infrastructure/service-resolver.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
import { InfrastructureRpcService } from '../../src/services/infrastructure.rpc-service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-mount-')));
afterAll(() => {
  resetEnvCache();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const PROJECT = '/Users/someone/projects/dao/daos';

/** Nominatim as daos declares it — data volumes docker keeps, and the scripts it mounts from the repository. */
const nominatim = (project = PROJECT) => {
  const tools = `${project}/infra/nominatim`;
  return {
    type: 'daemon' as const,
    ports: { http: 8080 },
    env: {},
    docker: {
      image: 'mediagis/nominatim:4.4',
      portMappings: { http: 8090 },
      entrypoint: ['/opt/nominatim-tools/cis-entrypoint.sh'],
      volumes: {
        data: { source: '', target: '/var/lib/postgresql/14/main' },
        pbf: { source: `${project}/var/pbf`, target: '/pbf' },
        tools: { source: tools, target: '/opt/nominatim-tools', readonly: true },
        hooks: { source: './infra/nominatim/hooks', target: '/hooks', readonly: true },
      },
      variants: { mainnet: { volumes: { extra: { source: `${tools}/extra`, target: '/extra' } } } },
    },
  };
};

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => quiet() }) as never;

describe('the master names the node\'s copy', () => {
  const TOOLS = `${PROJECT}/infra/nominatim`;
  const out = pointMountsAtShippedConfig(
    { nominatim: nominatim(), redis: { docker: { volumes: { x: { source: TOOLS, target: '/x' } } } } },
    new Map([['nominatim', TOOLS]]),
    PROJECT,
  );
  const v = (out.nominatim as ReturnType<typeof nominatim>).docker.volumes;

  it('points a mount inside the service\'s shipped directory at configroot:, relative ones included', () => {
    expect(v.tools.source).toBe('configroot:nominatim');
    expect(v.hooks.source).toBe('configroot:nominatim/hooks');
    expect((out.nominatim as ReturnType<typeof nominatim>).docker.variants.mainnet.volumes.extra.source).toBe('configroot:nominatim/extra');
    expect(v.tools.readonly).toBe(true);
  });

  it('leaves docker\'s own volumes, paths outside the directory, and other services alone', () => {
    expect(v.data.source).toBe('');
    expect(v.pbf.source).toBe(`${PROJECT}/var/pbf`);
    expect((out.redis as { docker: { volumes: { x: { source: string } } } }).docker.volumes.x.source).toBe(TOOLS);
  });
});

describe('two spellings of one project', () => {
  // daos on this master: registered as `…/omni/internal/daos`, a symlink to
  // `…/dao/daos`, where `omnitron.config.ts` computes `infra/nominatim` from
  // its own `__dirname`. Compared as written, the mount was «outside» and
  // Nominatim on daos/test mounted an empty directory (2026-09-25).
  const real = path.join(scratch, 'real-daos');
  fs.mkdirSync(path.join(real, 'infra', 'nominatim'), { recursive: true });
  const linked = path.join(scratch, 'linked-daos');
  fs.symlinkSync(real, linked);

  it('a project registered through a symlink, its mounts computed from the real directory', () => {
    const out = pointMountsAtShippedConfig(
      { nominatim: nominatim(real) },
      new Map([['nominatim', path.join(linked, 'infra', 'nominatim')]]),
      linked,
    );
    const n = out.nominatim as ReturnType<typeof nominatim>;
    expect(n.docker.volumes.tools.source).toBe('configroot:nominatim');
    // Relative, and not on the disk yet: the nearest part that is gives the spelling.
    expect(n.docker.volumes.hooks.source).toBe('configroot:nominatim/hooks');
    expect(n.docker.variants.mainnet.volumes.extra.source).toBe('configroot:nominatim/extra');
  });

  it('and the other way round', () => {
    const out = pointMountsAtShippedConfig(
      { nominatim: nominatim(linked) },
      new Map([['nominatim', path.join(real, 'infra', 'nominatim')]]),
      real,
    );
    expect((out.nominatim as ReturnType<typeof nominatim>).docker.volumes.tools.source).toBe('configroot:nominatim');
  });

  it('a mount outside the directory stays the master\'s, in the spelling it was declared with', () => {
    const out = pointMountsAtShippedConfig(
      { nominatim: nominatim(linked) },
      new Map([['nominatim', path.join(real, 'infra', 'nominatim')]]),
      real,
    );
    expect((out.nominatim as ReturnType<typeof nominatim>).docker.volumes.pbf.source).toBe(`${linked}/var/pbf`);
  });
});

describe('the node resolves it to its own copy', () => {
  const TOOLS = `${PROJECT}/infra/nominatim`;
  const root = path.join(scratch, 'configs', 'nominatim');
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cis-entrypoint.sh'), '#!/bin/sh\nexec /app/start.sh\n', { mode: 0o755 });
  const roots = new Map([['nominatim', root]]);

  it('and never outside it', () => {
    expect(shippedMountPath('configroot:nominatim/hooks', roots)).toEqual({ path: path.join(root, 'hooks'), root });
    expect(shippedMountPath('configroot:nominatim/../../etc', roots)).toBeUndefined();
    expect(shippedMountPath('configroot:tiles', roots)).toBeUndefined();
  });

  it('the container mounts the node\'s directory, and what it holds is in the spec hash', () => {
    const forNode = pointMountsAtShippedConfig({ nominatim: nominatim() }, new Map([['nominatim', TOOLS]]), PROJECT);
    const [container] = resolveAppInfrastructure(forNode as never, undefined, undefined, roots);
    const tools = container!.volumes.find((m) => m.target === '/opt/nominatim-tools');
    expect(tools).toEqual({ source: root, target: '/opt/nominatim-tools', readonly: true });
    expect(container!.volumes.find((m) => m.target === '/hooks')!.source).toBe(path.join(root, 'hooks'));
    const before = container!.configDigest;
    expect(before).toBeTruthy();

    fs.writeFileSync(path.join(root, 'cis-entrypoint.sh'), '#!/bin/sh\nexec /app/start.sh --threads 8\n', { mode: 0o755 });
    const [again] = resolveAppInfrastructure(forNode as never, undefined, undefined, roots);
    expect(again!.configDigest).not.toBe(before);
  });

  it('a mount with no copy on this node stays configroot: — refused by docker by name, not an empty directory', () => {
    const forNode = pointMountsAtShippedConfig({ nominatim: nominatim() }, new Map([['nominatim', TOOLS]]), PROJECT);
    const [container] = resolveAppInfrastructure(forNode as never, undefined, undefined, new Map());
    expect(container!.volumes.find((m) => m.target === '/opt/nominatim-tools')!.source).toBe('configroot:nominatim');
  });
});

describe('the master ships what a service names, wherever it is declared', () => {
  it('a stack service\'s own `configDir`, a preset\'s `config.configDir`, and an app requirement\'s', async () => {
    const project = path.join(scratch, 'project');
    for (const [dir, file] of [['infra/nominatim', 'cis-entrypoint.sh'], ['infra/nginx', 'nginx.conf.template'], ['infra/tiles', 'style.json']] as const) {
      fs.mkdirSync(path.join(project, dir), { recursive: true });
      fs.writeFileSync(path.join(project, dir, file), 'x\n');
    }
    const master: any = Object.create(ProjectService.prototype);
    Object.assign(master, { logger: quiet() });
    const shipped = new Map<string, string>();
    const payload = await master.readStackConfigFiles(
      {
        services: {
          nominatim: { ...nominatim(project), configDir: './infra/nominatim' },
          gateway: { preset: 'openresty', config: { configDir: './infra/nginx' } },
        },
      },
      project,
      shipped,
      { tiles: { ports: { http: 80 }, env: {}, configDir: './infra/tiles' } },
    );
    expect(Object.keys(payload).sort()).toEqual(['gateway', 'nominatim', 'tiles']);
    expect(payload.nominatim.map((f: { path: string }) => f.path)).toEqual(['cis-entrypoint.sh']);
    expect([...shipped.entries()].sort()).toEqual([
      ['gateway', path.join(project, 'infra', 'nginx')],
      ['nominatim', path.join(project, 'infra', 'nominatim')],
      ['tiles', path.join(project, 'infra', 'tiles')],
    ]);
  });
});

describe('from the master\'s call to the node\'s container, through the calls that carry it', () => {
  it('Nominatim as daos declares it — a stack service, beside a shipped gateway — mounts the copy the node wrote', async () => {
    const project = path.join(scratch, 'daos');
    fs.mkdirSync(path.join(project, 'infra', 'nginx'), { recursive: true });
    fs.writeFileSync(path.join(project, 'infra', 'nginx', 'nginx.conf.template'), 'events {}\n');
    fs.mkdirSync(path.join(project, 'infra', 'nominatim', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(project, 'infra', 'nominatim', 'cis-entrypoint.sh'), '#!/bin/sh\nexec /app/start.sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(project, 'infra', 'nominatim', 'hooks', 'after-import.sh'), '#!/bin/sh\n', { mode: 0o755 });

    // The master: what it sends to the node for a stack that declares it.
    const sent: Array<Record<string, any>> = [];
    const connector = {
      addSlave: vi.fn(async () => undefined),
      waitUntilConnected: vi.fn(async () => true),
      invokeOnSlave: vi.fn(async (_host: string, _port: number, _svc: string, _method: string, args: unknown[]) => {
        sent.push(args[0] as Record<string, any>);
        return { ready: true, detail: 'provisioned' };
      }),
    };
    const master: any = Object.create(ProjectService.prototype);
    Object.assign(master, { logger: quiet(), shipStackStatics: vi.fn(async () => ({})) });
    await master.provisionNodeInfrastructure(
      connector,
      { host: '10.0.0.7', port: 9700 },
      {
        services: {
          // The gateway takes the resolver's other road on the node
          // (`resolveGateway`), and Nominatim must still get its copy there.
          gateway: { preset: 'openresty', config: { configDir: './infra/nginx' }, ports: { http: 8080 } },
          nominatim: { ...nominatim(project), configDir: './infra/nominatim' },
        },
      },
      undefined,
      { project: 'daos', stack: 'test' },
      project,
    );
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!['configFiles']).sort()).toEqual(['gateway', 'nominatim']);
    expect(sent[0]!['config'].services.nominatim.docker.volumes.tools.source).toBe('configroot:nominatim');
    expect(sent[0]!['config'].services.nominatim.docker.volumes.pbf.source).toBe(`${project}/var/pbf`);

    // The node: that payload as it crosses the wire, into `provisionStack`,
    // hosted by a real InfrastructureService — only its docker pass stubbed.
    const nodeHome = path.join(scratch, 'node-home');
    fs.mkdirSync(nodeHome);
    setEnvOverride({ HOME: nodeHome });
    let hosted: InfrastructureService | null = null;
    const node = new InfrastructureRpcService(
      () => hosted,
      ((config: never, declared: never, registry: never, overrides: never) => {
        hosted = new InfrastructureService(quiet(), config, declared, registry, overrides, false);
        vi.spyOn(hosted, 'provision').mockResolvedValue({ services: {}, ready: true } as never);
        return hosted;
      }) as never,
    );
    await node.provisionStack(JSON.parse(JSON.stringify(sent[0])));

    const copy = path.join(nodeHome, '.omnitron', 'stack-config', 'daos', 'test', 'nominatim');
    expect(fs.readFileSync(path.join(copy, 'cis-entrypoint.sh'), 'utf8')).toContain('exec /app/start.sh');
    // What `provision()` reconciles.
    const desired = (hosted as unknown as { desiredContainers: ResolvedContainer[] }).desiredContainers;
    expect(desired.find((c) => c.name === 'daos-test-gateway')!.volumes.length).toBeGreaterThan(0);
    const container = desired.find((c) => c.name === 'daos-test-nominatim');
    expect(container!.volumes.find((m) => m.target === '/opt/nominatim-tools')).toEqual({
      source: copy,
      target: '/opt/nominatim-tools',
      readonly: true,
    });
    expect(container!.volumes.find((m) => m.target === '/hooks')!.source).toBe(path.join(copy, 'hooks'));
    expect(container!.configDigest).toBeTruthy();
  });

  it('a service an app requires is resolved against the copy too — written before it is resolved', async () => {
    const project = path.join(scratch, 'app-project');
    fs.mkdirSync(path.join(project, 'infra', 'tiles'), { recursive: true });
    fs.writeFileSync(path.join(project, 'infra', 'tiles', 'style.json'), '{}\n');
    const tiles = {
      ports: { http: 80 },
      env: {},
      configDir: './infra/tiles',
      docker: { image: 'tileserver:1', volumes: { style: { source: `${project}/infra/tiles`, target: '/style', readonly: true } } },
    };

    const sent: Array<Record<string, any>> = [];
    const connector = {
      addSlave: vi.fn(async () => undefined),
      waitUntilConnected: vi.fn(async () => true),
      invokeOnSlave: vi.fn(async (_h: string, _p: number, _s: string, _m: string, args: unknown[]) => {
        sent.push(args[0] as Record<string, any>);
        return { ready: true };
      }),
    };
    const master: any = Object.create(ProjectService.prototype);
    Object.assign(master, { logger: quiet(), shipStackStatics: vi.fn(async () => ({})) });
    await master.provisionNodeInfrastructure(
      connector,
      { host: '10.0.0.8', port: 9700 },
      { services: {} },
      { tiles },
      { project: 'daos', stack: 'test' },
      project,
    );
    expect(sent[0]!['services'].tiles.docker.volumes.style.source).toBe('configroot:tiles');

    const nodeHome = path.join(scratch, 'node-home-apps');
    fs.mkdirSync(nodeHome);
    setEnvOverride({ HOME: nodeHome });
    // A node that already hosts this stack: the service is reused, and only
    // the applications' containers are added to it.
    const added: ResolvedContainer[] = [];
    const reused = {
      redefine: vi.fn(),
      addAppContainers: (cs: ResolvedContainer[]) => added.push(...cs),
      setConfigRoots: vi.fn(),
      provision: vi.fn(async () => ({ services: {}, ready: true })),
      getDesiredServices: () => [],
    };
    const node = new InfrastructureRpcService(() => reused as never, (() => reused) as never);
    await node.provisionStack(JSON.parse(JSON.stringify(sent[0])));

    const copy = path.join(nodeHome, '.omnitron', 'stack-config', 'daos', 'test', 'tiles');
    expect(added.find((c) => c.name.endsWith('-tiles'))!.volumes).toEqual([{ source: copy, target: '/style', readonly: true }]);
  });
});
