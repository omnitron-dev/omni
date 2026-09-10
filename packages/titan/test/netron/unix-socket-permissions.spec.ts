/**
 * A Unix-domain socket IS the trust boundary.
 *
 * A peer that can connect to one speaks the full Netron protocol to whatever
 * is exposed on it, with no further check — that is the whole premise of using
 * one for a management channel. Node binds with the process umask, which on a
 * normal account produces `srwxr-xr-x`, and titan-pm puts its per-worker
 * sockets under `os.tmpdir()`. On a stock deployment every worker's management
 * surface — health, the dependency graph, `shutdown()` — was therefore
 * reachable by any local account. The daemon's own socket passed an explicit
 * mode and was `srw-------`; nothing else did.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { statSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UnixSocketTransport } from '../../src/netron/transport/unix-transport.js';

describe('Unix socket permissions', () => {
  const created: Array<{ close: () => Promise<void> }> = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const server of created.splice(0)) await server.close().catch(() => undefined);
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const socketIn = () => {
    const dir = mkdtempSync(join(tmpdir(), 'unix-perm-'));
    dirs.push(dir);
    return join(dir, 'test.sock');
  };

  it('binds owner-only by default', async () => {
    const path = socketIn();
    const transport = new UnixSocketTransport();

    const server = await transport.createServer({ path });
    created.push(server as unknown as { close: () => Promise<void> });

    // 0o777 masks off the file-type bits; what is left is the permission set.
    expect(statSync(path).mode & 0o777, 'anyone on the box could connect').toBe(0o600);
  });

  it('still honours an explicit mode', async () => {
    const path = socketIn();
    const transport = new UnixSocketTransport();

    const server = await transport.createServer({ path, mode: 0o660 } as never);
    created.push(server as unknown as { close: () => Promise<void> });

    expect(statSync(path).mode & 0o777).toBe(0o660);
  });
});
