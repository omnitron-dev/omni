/**
 * A port the network could reach.
 *
 * `createContainer` published every port as `-p <host>:<container>`, which
 * docker binds on 0.0.0.0 — and docker's forwarding sits in front of the host
 * firewall, so a test Postgres or Redis with its default credentials was a
 * service the LAN could log into for as long as the suite ran. Measured on
 * this machine in daos on 2026-09-16: its test Postgres answered a login from
 * another address on the network. omni's own `docker-compose.test.yml`
 * published `0.0.0.0:15432` (test/test) the same way until 2026-09-29.
 *
 * Held here, on a real container: what the manager publishes is bound to the
 * loopback, which is also the address `isPortAvailable` probes. The compose
 * files are held by `scripts/a-port-the-network-could-reach.mjs`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';

import { DockerTestManager } from './docker-test-manager.js';

/** Docker's time, not the behaviour's — see docker-port-collision.spec.ts. */
const DOCKER_BUDGET_MS = 300_000;

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function dockerAvailable(): boolean {
  try {
    docker('version', '--format', '{{.Server.Version}}');
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = dockerAvailable() ? describe : describe.skip;
if (!dockerAvailable()) {
  console.log('⏭️  Skipping a-port-the-network-could-reach.spec.ts - requires Docker');
}

describeOrSkip('DockerTestManager publishes on the loopback only', () => {
  const manager = new DockerTestManager();
  const name = `loopback-probe-${process.pid}`;

  afterAll(() => {
    try {
      docker('rm', '-f', name);
    } catch {
      // already gone
    }
  });

  it('binds an auto port to 127.0.0.1, not to every interface', async () => {
    await manager.createContainer({ name, image: 'redis:7-alpine', ports: { 6379: 'auto' } });

    const bindings = JSON.parse(docker('inspect', '-f', '{{json .HostConfig.PortBindings}}', name)) as Record<
      string,
      Array<{ HostIp: string; HostPort: string }>
    >;
    expect(bindings['6379/tcp']?.map((b) => b.HostIp)).toEqual(['127.0.0.1']);
    // What docker actually listens on, not only what it was asked for.
    const published = docker('port', name, '6379/tcp').split('\n');
    expect(published.every((line) => line.startsWith('127.0.0.1:'))).toBe(true);
  }, DOCKER_BUDGET_MS);
});
