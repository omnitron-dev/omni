/**
 * A gateway config that never reached the gateway.
 *
 * A node receives its gateway's files with every provision — nginx.conf, the
 * entrypoint, the Lua modules, the maintenance page — writes them over the
 * previous copies, and bind-mounts them into the container. The reconcile
 * then decides whether the running container matches the desired one by its
 * spec hash, and the spec hash covered the mount PATHS. A path does not
 * change when its file does, and the gateway renders nginx.conf once, at
 * start. So a corrected template reached the node, sat on its disk, and the
 * running gateway went on serving the old one: «noop».
 *
 * `configFilesHash` existed for exactly this — its docblock says it is folded
 * into the spec hash «by the caller» — and had no caller. The test gateway
 * picked up config changes only because a new static bundle moved its
 * `/var/www/portal` mount, which recreated it and carried the config along
 * by accident; a release that changed only nginx.conf would have changed
 * nothing that serves.
 *
 * The rule: what the mounted config files say is part of the spec. And the
 * other half — a container that mounts no config files keeps the hash it
 * was created with, so upgrading omnitron recreates nothing on its account.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { mountedConfigDigest, resolveGateway } from '../../src/infrastructure/service-resolver.js';

const REDIS = { host: 'daos-test-redis', port: 6379, db: 1 };
const dirs: string[] = [];

/** A gateway config directory as a node writes it: four mounts, one of them a directory. */
function configRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-config-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'lua'));
  fs.writeFileSync(path.join(root, 'nginx.conf'), 'http { server { listen 80; } }\n');
  fs.writeFileSync(path.join(root, 'docker-entrypoint.sh'), '#!/bin/sh\nexec openresty\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'lua', 'maintenance_check.lua'), 'return {}\n');
  fs.writeFileSync(path.join(root, 'maintenance.html'), '<h1>maintenance</h1>\n');
  return root;
}

/** Resolved the way a node resolves it: its own copy, `configDir: '.'`. */
function onNode(root: string, staticDir?: string) {
  return resolveGateway({ port: 8080, configDir: '.', ...(staticDir ? { staticDir } : {}) }, REDIS, root);
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('a gateway config that never reached the gateway', () => {
  it('a rewritten nginx.conf changes the spec hash, so the reconcile recreates', () => {
    const root = configRoot();
    const before = containerSpecHash(onNode(root));

    fs.writeFileSync(path.join(root, 'nginx.conf'), 'http { server { listen 80; gzip on; } }\n');
    const after = containerSpecHash(onNode(root));

    expect(after).not.toBe(before);
  });

  it('so does a Lua module inside a mounted directory, and a mode', () => {
    const root = configRoot();
    const first = containerSpecHash(onNode(root));

    fs.writeFileSync(path.join(root, 'lua', 'maintenance_check.lua'), 'return { fixed = true }\n');
    const second = containerSpecHash(onNode(root));
    expect(second).not.toBe(first);

    fs.chmodSync(path.join(root, 'docker-entrypoint.sh'), 0o644);
    expect(containerSpecHash(onNode(root))).not.toBe(second);
  });

  it('the same files give the same hash — a provision that changes nothing recreates nothing', () => {
    const root = configRoot();
    const once = containerSpecHash(onNode(root));
    // Written again, byte for byte, as every provision does.
    fs.writeFileSync(path.join(root, 'nginx.conf'), 'http { server { listen 80; } }\n');

    expect(containerSpecHash(onNode(root))).toBe(once);
  });

  it('reads only what is mounted from the config directory, not the static bundle', () => {
    const root = configRoot();
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-static-'));
    dirs.push(site);
    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html>');
    const spec = onNode(root, site);
    const digest = spec.configDigest;

    // A bundle can be tens of megabytes; its own mount path already moves
    // when a node receives a new one.
    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>new</title>');
    expect(mountedConfigDigest(`${root}/.`, spec.volumes)).toBe(digest);
    // A file beside the mounts is not read by the container either.
    fs.writeFileSync(path.join(root, 'README'), 'notes');
    expect(mountedConfigDigest(`${root}/.`, spec.volumes)).toBe(digest);
  });

  it('a container with no config files keeps the hash it was created with', () => {
    // Pinned from the code before `configDigest` existed. If this moves,
    // every container on every node is recreated by an omnitron upgrade.
    const postgres = {
      name: 'daos-test-postgres',
      image: 'postgis/postgis:17-3.5-alpine',
      ports: [{ host: 5432, container: 5432, bindHost: '127.0.0.1' }],
      environment: { POSTGRES_USER: 'postgres', POSTGRES_DB: 'postgres' },
      volumes: [{ source: 'daos-test-pg-data', target: '/var/lib/postgresql/data' }],
      labels: { 'omnitron.managed': 'true' },
      restart: 'unless-stopped',
      network: 'daos-test_default',
    };

    expect(containerSpecHash(postgres as never)).toBe('90df79926feead89');
  });

  it('a config directory that cannot be read leaves the hash without a digest', () => {
    const spec = onNode(path.join(os.tmpdir(), 'gw-config-that-does-not-exist'));

    expect(spec.configDigest).toBeUndefined();
  });
});
