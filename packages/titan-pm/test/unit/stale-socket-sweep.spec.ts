/**
 * Socket files outlive the processes that made them.
 *
 * `cleanup()` runs on a graceful shutdown and not otherwise, so every crash,
 * SIGKILL and power loss left its sockets behind — 133 of them had accumulated
 * on one development machine over two months. Individually harmless, and still
 * garbage: a directory listing stops telling a human which processes are live,
 * and on a long-running host the pile only grows.
 *
 * The old cleanup had a sharper problem than leaving files behind. It unlinked
 * every `*.sock` in the temp directory — a directory a SECOND spawner (another
 * daemon, a test run beside a running one) is also using. Shutting one down
 * deleted the other's live socket files, and a Unix socket whose file is gone
 * accepts no new connections.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

import { ProcessSpawner } from '../../src/process-spawner.js';
import type { ILogger } from '../../src/types.js';

const silentLogger = (): ILogger => {
  const noop = () => {};
  const logger: Record<string, unknown> = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  };
  logger['child'] = () => logger;
  return logger as unknown as ILogger;
};

const servers: net.Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((r) => server.close(() => r(null)));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const spawnerOn = (dir: string) =>
  new ProcessSpawner(silentLogger(), { advanced: { tempDir: dir } } as never);

const listenAt = async (path: string) => {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return server;
};

describe('stale socket sweep', () => {
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
    dirs.push(dir);
    return dir;
  };

  it('removes a socket file nobody is listening on', async () => {
    const dir = tempDir();
    const dead = join(dir, 'dead.sock');

    // The leftover has to be genuine. Node unlinks the path when a server
    // closes cleanly, so the only way to produce what a crash leaves is to
    // kill a listener: the socket inode stays on disk with nothing bound to
    // it, and connecting to it is refused. That is the exact condition the
    // sweep tests for, and a plain file at a .sock path is not it.
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('net').createServer().listen(process.argv[1], () => console.log('up')); setInterval(() => {}, 1e6);",
        dead,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    await new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    expect(existsSync(dead), 'the killed listener took its socket file with it').toBe(true);

    // The sweep only considers files older than STALE_SOCKET_MIN_AGE_MS, so a
    // socket created by this test is deliberately out of scope — that age gate
    // is what keeps it from deleting a socket that has been bound and is not
    // yet accepting. Backdate it to stand in for a previous run's leftover.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(dead, longAgo, longAgo);

    await (spawnerOn(dir) as unknown as { sweepStaleSockets(): Promise<void> }).sweepStaleSockets();

    expect(existsSync(dead), 'a leftover from a dead process was kept').toBe(false);
  });

  it('leaves a socket someone is listening on', async () => {
    const dir = tempDir();
    const live = join(dir, 'live.sock');
    await listenAt(live);

    await (spawnerOn(dir) as unknown as { sweepStaleSockets(): Promise<void> }).sweepStaleSockets();

    expect(existsSync(live), "another process's live socket was deleted").toBe(true);
  });

  it('cleanup touches only the sockets this spawner made', async () => {
    const dir = tempDir();
    const theirs = join(dir, 'theirs.sock');
    await listenAt(theirs);
    const spawner = spawnerOn(dir);
    const mine = join(dir, 'mine.sock');
    await listenAt(mine);
    (spawner as unknown as { ownSockets: Set<string> }).ownSockets.add(mine);

    await spawner.cleanup();

    expect(existsSync(mine), 'its own socket was left behind').toBe(false);
    expect(existsSync(theirs), "another spawner's socket was deleted").toBe(true);
  });
});

describe('stale socket sweep — the age gate', () => {
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-age-'));
    dirs.push(dir);
    return dir;
  };

  it('leaves a fresh socket alone even when connecting to it is refused', async () => {
    // Between `bind` and `listen` a socket file exists and refuses
    // connections. A sweep that runs while other workers are starting would
    // delete one seconds away from serving, and the parent then cannot reach
    // its own child: `connect ENOENT …/titan-pm/<id>.sock`. That is what the
    // first version of this sweep did, and it took a whole stand down.
    const dir = tempDir();
    const fresh = join(dir, 'starting.sock');

    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('net').createServer().listen(process.argv[1], () => console.log('up')); setInterval(() => {}, 1e6);",
        fresh,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    await new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));

    // Refused, and seconds old — exactly the shape of a worker mid-startup.
    await (spawnerOn(dir) as unknown as { sweepStaleSockets(): Promise<void> }).sweepStaleSockets();

    expect(existsSync(fresh), 'a socket young enough to be starting up was deleted').toBe(true);
  });
});
