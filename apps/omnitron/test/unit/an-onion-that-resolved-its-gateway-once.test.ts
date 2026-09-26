/**
 * An onion that resolved its gateway once.
 *
 * daos/test's torrc said `HiddenServicePort 80 daos-test-gateway:80`, and Tor
 * resolves a target's name when it starts. On 2026-09-26 a deploy recreated
 * Nominatim 0.26 s before the gateway; Nominatim took 172.19.0.4, the address
 * the old gateway had just released, and the new gateway got .7. Tor, up since
 * 2026-09-22, went on forwarding to .4: for ~10 minutes the onion served
 * Nominatim's Apache — `/auth/sign-in` 404, nobody could sign in.
 *
 * The owner's decision: the onion reaches the gateway through a unix socket
 * on a volume both containers mount — no name to resolve, no address to go
 * stale. Three things stood in the way, and each is held here:
 *
 *   - a named volume was always its service's (`<prefix>-<service>-<key>`,
 *     whatever `source` said), so no declaration gave two containers one
 *     volume — `source: 'shared:<name>'` now does, in services and gateway;
 *   - a stack's `docker.volumes` REPLACED a preset's: giving Tor the socket
 *     would have taken `/var/lib/tor`, its onion keys and so its address —
 *     now they merge by key, in the preset expansion and in the override;
 *   - the stack manager handed the gateway two fields of its block, so its
 *     `env` (declared «passed to the gateway container») reached nothing and
 *     `volumes` would not have either — `gatewayConfigOf` hands all of them.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { renderTorrc } from '../../src/infrastructure/presets/torrc.js';
import {
  gatewayConfigOf,
  resolveGateway,
  resolveInfrastructure,
  resolveServiceRequirement,
  setContainerPrefix,
} from '../../src/infrastructure/service-resolver.js';

const REDIS = { host: 'daos-test-redis', port: 6379, db: 1 };
const SOCKET_DIR = '/run/gateway';
const SOCKET = `${SOCKET_DIR}/http.sock`;
const SHARED = { source: 'shared:gateway-socket', target: SOCKET_DIR };
const dirs: string[] = [];

/** A gateway config directory as a node writes it. */
function configRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onion-gw-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'lua'));
  fs.writeFileSync(path.join(root, 'nginx.conf'), 'http { server { listen 80; } }\n');
  fs.writeFileSync(path.join(root, 'docker-entrypoint.sh'), '#!/bin/sh\nexec openresty\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'maintenance.html'), '<h1>maintenance</h1>\n');
  return root;
}

/** The Tor service of daos/test's stack, with the socket it reaches the gateway by. */
function torOfTheStack(volumes: Record<string, { source: string; target: string }> = { socket: SHARED }) {
  const requirement = createDefaultRegistry().expand('tor', {
    preset: 'tor',
    config: { hiddenServices: [{ name: 'portal', virtualPort: 80, target: `unix:${SOCKET}` }] },
    docker: { volumes },
  });
  const container = resolveServiceRequirement('tor', requirement);
  if (!container) throw new Error('the tor service resolved to no container');
  return container;
}

beforeEach(() => setContainerPrefix('daos', 'test'));
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('an onion that resolved its gateway once', () => {
  it('a `shared:` volume is ONE docker volume in Tor and in the gateway, at the declared path', () => {
    const tor = torOfTheStack();
    const gateway = resolveGateway(
      gatewayConfigOf({ configDir: '.', volumes: { socket: SHARED } }, undefined, 8080, 1),
      REDIS,
      configRoot(),
    );

    const inTor = tor.volumes.find((v) => v.target === SOCKET_DIR);
    const inGateway = gateway.volumes.find((v) => v.target === SOCKET_DIR);
    expect(inTor?.source).toBe('daos-test-gateway-socket');
    expect(inGateway?.source).toBe('daos-test-gateway-socket');
  });

  it("Tor keeps `/var/lib/tor` — its onion keys, its address — when the stack adds the socket", () => {
    const tor = torOfTheStack();
    expect(tor.volumes).toContainEqual({ source: 'daos-test-tor-data', target: '/var/lib/tor' });
    expect(tor.volumes).toHaveLength(2);
  });

  it('a stack override that adds a volume keeps the requirement’s own (`serviceOverrides.docker.volumes`)', () => {
    const requirement = createDefaultRegistry().expand('tor', {
      preset: 'tor',
      config: { hiddenServices: [{ name: 'portal', virtualPort: 80, target: `unix:${SOCKET}` }] },
    });
    const container = resolveServiceRequirement('tor', requirement, { docker: { volumes: { socket: SHARED } } });
    expect(container?.volumes).toContainEqual({ source: 'daos-test-tor-data', target: '/var/lib/tor' });
    expect(container?.volumes).toContainEqual({ source: 'daos-test-gateway-socket', target: SOCKET_DIR });
  });

  it('a named volume without `shared:` stays its own service’s — the same key in two services is two volumes', () => {
    const tor = torOfTheStack({ socket: { source: 'gateway-socket', target: SOCKET_DIR } });
    const gateway = resolveGateway(
      gatewayConfigOf({ configDir: '.', volumes: { socket: { source: 'gateway-socket', target: SOCKET_DIR } } }, undefined, 8080, 1),
      REDIS,
      configRoot(),
    );
    expect(tor.volumes.find((v) => v.target === SOCKET_DIR)?.source).toBe('daos-test-tor-socket');
    expect(gateway.volumes.find((v) => v.target === SOCKET_DIR)?.source).toBe('daos-test-gateway-socket');
  });

  it('a shared name docker could not take is refused, naming the declaration', () => {
    expect(() => torOfTheStack({ socket: { source: 'shared:Gateway Socket', target: SOCKET_DIR } })).toThrow(
      /Volume "socket" of tor: "shared:Gateway Socket" does not name a shared volume/,
    );
  });

  it('the gateway gets every field of its block — `env` and `volumes` too, not only `configDir` and `staticDir`', () => {
    const config = gatewayConfigOf(
      {
        configDir: './infra/nginx',
        staticDir: 'apps/portal/dist',
        env: { GATEWAY_UNIX_SOCKET: SOCKET },
        volumes: { socket: SHARED },
      },
      undefined,
      8080,
      3,
    );
    expect(config).toEqual({
      port: 8080,
      configDir: './infra/nginx',
      redisDb: 3,
      staticDir: 'apps/portal/dist',
      env: { GATEWAY_UNIX_SOCKET: SOCKET },
      volumes: { socket: SHARED },
    });

    const root = configRoot();
    const gateway = resolveGateway(gatewayConfigOf({ configDir: '.', env: { GATEWAY_UNIX_SOCKET: SOCKET } }, undefined, 8080, 1), REDIS, root);
    expect(gateway.environment?.['GATEWAY_UNIX_SOCKET']).toBe(SOCKET);
  });

  /**
   * The node's road. A node does not run the stack manager's resolution; it
   * re-resolves its infrastructure once the master's files arrive
   * (`InfrastructureService.setConfigRoots` → `resolveInfrastructure`), and
   * that road handed the gateway port, configDir and staticDir only. On
   * daos/test, 2026-09-26, with f0e19089 on the node, the gateway came up
   * with no GATEWAY_UNIX_SOCKET and no socket volume while Tor, resolved on
   * the generic road, pointed at the socket: the onion was down ~11 minutes.
   */
  it('on a node, the gateway gets its socket volume and env too — the road a node takes', () => {
    const root = configRoot();
    const services = normalizeInfraConfig(
      {
        services: {
          gateway: {
            preset: 'openresty',
            config: {
              configDir: './infra/nginx',
              staticDir: 'apps/portal/dist',
              env: { GATEWAY_UNIX_SOCKET: SOCKET },
              volumes: { socket: SHARED },
            },
            ports: { http: 8080 },
          },
          tor: {
            preset: 'tor',
            config: { hiddenServices: [{ name: 'portal', virtualPort: 80, target: `unix:${SOCKET}` }] },
            docker: { volumes: { socket: SHARED } },
          },
        },
      } as never,
      createDefaultRegistry(),
    );

    const containers = resolveInfrastructure({} as never, services, undefined, new Map([['gateway', root]]), {
      redis: REDIS,
      staticRoots: new Map([['gateway', '/root/.omnitron/static/daos/test/gateway']]),
    });
    const gateway = containers.find((c) => c.name === 'daos-test-gateway');
    const tor = containers.find((c) => c.name === 'daos-test-tor');

    expect(gateway?.environment?.['GATEWAY_UNIX_SOCKET']).toBe(SOCKET);
    expect(gateway?.volumes).toContainEqual({ source: 'daos-test-gateway-socket', target: SOCKET_DIR });
    expect(tor?.volumes).toContainEqual({ source: 'daos-test-gateway-socket', target: SOCKET_DIR });
    expect(tor?.volumes).toContainEqual({ source: 'daos-test-tor-data', target: '/var/lib/tor' });
    // The frontend is the node's copy, never the project-relative path the
    // stack declared.
    expect(gateway?.volumes).toContainEqual({
      source: '/root/.omnitron/static/daos/test/gateway',
      target: '/var/www/portal',
      readonly: true,
    });
    expect(gateway?.volumes.some((v) => v.source.includes('apps/portal/dist'))).toBe(false);
  });

  it('both roads give the gateway the same socket and env — a master’s and a node’s', () => {
    const block = {
      configDir: '.',
      env: { GATEWAY_UNIX_SOCKET: SOCKET },
      volumes: { socket: SHARED },
    };
    const root = configRoot();
    const onMaster = resolveGateway(gatewayConfigOf(block, undefined, 8080, 1), REDIS, root);
    const services = normalizeInfraConfig(
      { services: { gateway: { preset: 'openresty', config: block, ports: { http: 8080 } } } } as never,
      createDefaultRegistry(),
    );
    const onNode = resolveInfrastructure({} as never, services, undefined, new Map([['gateway', root]]), {
      redis: REDIS,
    }).find((c) => c.name === 'daos-test-gateway');

    const socketOf = (c: { volumes: Array<{ source: string; target: string }> } | undefined) =>
      c?.volumes.filter((v) => v.target === SOCKET_DIR);
    expect(socketOf(onNode)).toEqual(socketOf(onMaster));
    expect(onNode?.environment?.['GATEWAY_UNIX_SOCKET']).toBe(onMaster.environment?.['GATEWAY_UNIX_SOCKET']);
  });

  it('Tor is pointed at the socket as written — no name, no address', () => {
    const torrc = renderTorrc({ services: [{ name: 'portal', virtualPort: 80, target: `unix:${SOCKET}` }] });
    expect(torrc).toContain(`HiddenServicePort 80 unix:${SOCKET}`);
  });
});
