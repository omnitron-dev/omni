/**
 * Vitest Global Setup
 * Runs once before all test suites
 *
 * Redis connection strategies (in order of priority):
 * 1. USE_MOCK_REDIS=true - Use in-memory MockRedis (CI environments)
 * 2. Native redis-server - If available locally
 * 3. Docker Redis - Start container with random port
 * 4. Fallback to localhost:6379 - Assume Redis is running externally
 * 5. Mock mode - If all else fails
 */

import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

let nativeRedisProcess: ChildProcess | null = null;

interface RedisInfo {
  url: string;
  port: number;
  isMock?: boolean;
  isDocker?: boolean;
  isNative?: boolean;
  isExternal?: boolean;
  containerId?: string;
  pid?: number;
}

function findDockerPath(): string {
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where' : 'which';
  const dockerBinary = isWindows ? 'docker.exe' : 'docker';

  try {
    const result = execSync(`${whichCommand} ${dockerBinary}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const dockerPath = result.split('\n')[0]?.trim();
    if (dockerPath) return dockerPath;
  } catch {}

  const fallbackPaths =
    process.platform === 'darwin'
      ? ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker']
      : process.platform === 'win32'
        ? ['docker.exe', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe']
        : ['/usr/bin/docker', '/usr/local/bin/docker', '/snap/bin/docker'];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      try {
        execFileSync(path, ['--version'], { stdio: 'pipe', timeout: 5000 });
        return path;
      } catch {
        continue;
      }
    }
  }

  return dockerBinary;
}

function findRedisServerPath(): string | null {
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where' : 'which';
  const redisBinary = isWindows ? 'redis-server.exe' : 'redis-server';

  try {
    const result = execSync(`${whichCommand} ${redisBinary}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const redisPath = result.split('\n')[0]?.trim();
    if (redisPath) {
      execFileSync(redisPath, ['--version'], { stdio: 'pipe', timeout: 5000 });
      return redisPath;
    }
  } catch {}

  const fallbackPaths =
    process.platform === 'darwin'
      ? ['/usr/local/bin/redis-server', '/opt/homebrew/bin/redis-server']
      : ['/usr/bin/redis-server', '/usr/local/bin/redis-server'];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      try {
        execFileSync(path, ['--version'], { stdio: 'pipe', timeout: 5000 });
        return path;
      } catch {
        continue;
      }
    }
  }

  return null;
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForRedis(port: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
          socket.write('*1\r\n$4\r\nPING\r\n');
        });
        socket.on('data', (data) => {
          socket.end();
          if (data.toString().includes('PONG')) resolve();
          else reject(new Error('Unexpected Redis response'));
        });
        socket.on('error', reject);
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error('Connection timeout'));
        });
      });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function startNativeRedis(redisPath: string, port: number): Promise<void> {
  const dataDir = join(tmpdir(), `redis-test-global-${process.pid}`);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  nativeRedisProcess = spawn(
    redisPath,
    [
      '--port',
      port.toString(),
      '--bind',
      '127.0.0.1',
      '--dir',
      dataDir,
      '--save',
      '',
      '--appendonly',
      'no',
      '--loglevel',
      'warning',
    ],
    { stdio: 'pipe', detached: false }
  );

  (nativeRedisProcess as any).dataDir = dataDir;

  return new Promise((resolve, reject) => {
    nativeRedisProcess!.on('error', reject);
    nativeRedisProcess!.on('exit', (code) => {
      if (code !== 0) reject(new Error(`redis-server exited with code ${code}`));
    });
    setTimeout(async () => {
      const ready = await waitForRedis(port, 20);
      if (ready) resolve();
      else {
        nativeRedisProcess!.kill();
        reject(new Error('Native redis-server failed to start'));
      }
    }, 500);
  });
}

/**
 * Container name, per package rather than per monorepo.
 *
 * It was the constant `test-redis-global`, and the first thing `startDockerRedis`
 * does is `docker rm -f` it — so two package suites running at once removed
 * each other's Redis mid-test. Now that borrowing 6379 is no longer automatic,
 * far more runs reach this path at the same time.
 */
function dockerRedisName(): string {
  const pkg = process.cwd().split('/').filter(Boolean).pop() ?? 'unknown';
  return `test-redis-${pkg.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
}

async function startDockerRedis(dockerPath: string, port: number): Promise<string> {
  const name = dockerRedisName();
  try {
    execFileSync(dockerPath, ['rm', '-f', name], { stdio: 'pipe', timeout: 5000 });
  } catch {}

  const containerId = execFileSync(
    dockerPath,
    [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `${port}:6379`,
      '--health-cmd',
      'redis-cli ping',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '5',
      '--health-start-period',
      '2s',
      'redis:7-alpine',
    ],
    { encoding: 'utf-8' }
  ).trim();

  for (let i = 0; i < 30; i++) {
    try {
      const health = execFileSync(dockerPath, ['inspect', '--format={{.State.Health.Status}}', name], {
        encoding: 'utf-8',
      }).trim();
      if (health === 'healthy') return containerId;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Redis container failed to become healthy within 30 seconds');
}

/**
 * Where the handoff file lives.
 *
 * The WRITER used `__dirname` and every READER uses `process.cwd()` —
 * `getTestRedisConfig` in each package looks for
 * `join(process.cwd(), '.redis-test-info.json')`. Those coincide only while
 * this file is used by the package it sits in; the moment another package
 * points its `globalSetup` here, the setup writes beside THIS file and the
 * workers look beside THEIRS, so every strategy but the last fallback goes
 * silently unread. Vitest runs with cwd at the package root, which is what
 * the readers have always assumed.
 */
function redisInfoPath(): string {
  return join(process.cwd(), '.redis-test-info.json');
}

function writeRedisInfo(info: RedisInfo): void {
  writeFileSync(redisInfoPath(), JSON.stringify(info, null, 2));
  (globalThis as any).__REDIS_INFO__ = info;
}

export async function setup(): Promise<void> {
  console.log('[Global Setup] Initializing Redis for tests...');

  // Strategy 1: Mock Redis
  if (process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true') {
    console.log('[Global Setup] Using MockRedis (USE_MOCK_REDIS or CI mode)');
    writeRedisInfo({ url: 'mock://localhost', port: 0, isMock: true, isDocker: false });
    return;
  }

  // Strategy 2: Try existing Redis from docker-compose.test.yml (non-default port)
  const externalPort = Number(process.env.TEST_REDIS_PORT ?? 16379);
  try {
    const ready = await waitForRedis(externalPort, 3);
    if (ready) {
      console.log(`[Global Setup] Using existing Redis at localhost:${externalPort}`);
      writeRedisInfo({ url: `redis://localhost:${externalPort}`, port: externalPort, isDocker: false, isExternal: true });
      return;
    }
  } catch {}

  // Strategy 2b: the DEFAULT port, and only when asked for by name.
  //
  // This used to be automatic, and that is a loaded gun. A Redis answering on
  // 6379 is whatever the developer happens to be running — on this machine it
  // is the downstream dev stand, holding db0..db5 (main, storage, messaging,
  // pricing, payments, geo). These suites are not read-only: the rotif specs
  // in titan-notifications resolve `getTestRedisConfig(0)` and call
  // `flushdb()`, and `notifications-service.docker.spec.ts` calls `flushall`.
  // Borrowing 6379 therefore means erasing main's session database, and the
  // suite would report a clean run while doing it.
  //
  // titan-discovery already carries a regression test that says the endpoint
  // must never fall back to 6379. It was right, and this is the other half of
  // it: the isolated instance below costs a few seconds; the wrong answer
  // costs the stand.
  if (externalPort !== 6379 && process.env.TEST_REDIS_ALLOW_DEFAULT_PORT === 'true') {
    try {
      const ready = await waitForRedis(6379, 3);
      if (ready) {
        console.log('[Global Setup] Using existing Redis at localhost:6379 (TEST_REDIS_ALLOW_DEFAULT_PORT)');
        writeRedisInfo({ url: 'redis://localhost:6379', port: 6379, isDocker: false, isExternal: true });
        return;
      }
    } catch {}
  }

  // Strategy 3: Native redis-server
  const redisServerPath = findRedisServerPath();
  if (redisServerPath) {
    console.log(`[Global Setup] Found native redis-server at: ${redisServerPath}`);
    try {
      const port = await findAvailablePort();
      await startNativeRedis(redisServerPath, port);
      console.log(`[Global Setup] Native Redis started on port ${port}`);
      writeRedisInfo({
        url: `redis://localhost:${port}`,
        port,
        isDocker: false,
        isNative: true,
        pid: nativeRedisProcess!.pid!,
      });
      return;
    } catch (error: any) {
      console.warn(`[Global Setup] Failed to start native redis-server: ${error.message}`);
    }
  }

  // Strategy 4: Docker Redis
  try {
    const dockerPath = findDockerPath();
    console.log(`[Global Setup] Trying Docker at: ${dockerPath}`);
    execFileSync(dockerPath, ['version'], { stdio: 'pipe', timeout: 10000 });
    const port = await findAvailablePort();
    const containerId = await startDockerRedis(dockerPath, port);
    console.log(`[Global Setup] Docker Redis started (container ${containerId.substring(0, 12)}) on port ${port}`);
    writeRedisInfo({ url: `redis://localhost:${port}`, port, isDocker: true, containerId });
    return;
  } catch (error: any) {
    console.warn(`[Global Setup] Failed to start Docker Redis: ${error.message}`);
  }

  // Strategy 5: Mock mode fallback
  console.log('[Global Setup] No Redis available, falling back to MockRedis');
  writeRedisInfo({ url: 'mock://localhost', port: 0, isMock: true, isDocker: false });
}

export async function teardown(): Promise<void> {
  console.log('[Global Teardown] Cleaning up Redis resources...');

  try {
    let redisInfo: RedisInfo | undefined;
    try {
      const { readFileSync } = await import('node:fs');
      redisInfo = JSON.parse(readFileSync(redisInfoPath(), 'utf-8'));
    } catch {
      redisInfo = (globalThis as any).__REDIS_INFO__;
    }

    if (redisInfo?.isMock) {
      console.log('[Global Teardown] MockRedis mode - no cleanup needed');
    } else if (redisInfo?.isNative && redisInfo.pid) {
      console.log(`[Global Teardown] Stopping native redis-server (PID ${redisInfo.pid})...`);
      try {
        process.kill(redisInfo.pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(redisInfo!.pid!, 0);
            process.kill(redisInfo!.pid!, 'SIGKILL');
          } catch {}
        }, 2000);
      } catch {}

      // Clean temp dirs
      try {
        const baseDir = tmpdir();
        for (const entry of readdirSync(baseDir)) {
          if (entry.startsWith('redis-test-global-')) {
            rmSync(join(baseDir, entry), { recursive: true, force: true });
          }
        }
      } catch {}
      console.log('[Global Teardown] Native Redis stopped');
    } else if (redisInfo?.isDocker) {
      const dockerPath = findDockerPath();
      try {
        execFileSync(dockerPath, ['stop', dockerRedisName()], { stdio: 'pipe', timeout: 30000 });
        execFileSync(dockerPath, ['rm', '-f', dockerRedisName()], { stdio: 'pipe', timeout: 10000 });
        console.log('[Global Teardown] Redis container stopped');
      } catch {
        try {
          execFileSync(dockerPath, ['rm', '-f', dockerRedisName()], { stdio: 'pipe', timeout: 10000 });
        } catch {}
      }
    } else if (redisInfo?.isExternal) {
      console.log('[Global Teardown] External Redis - no cleanup needed');
    }

    // Clean up info file
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(redisInfoPath());
    } catch {}

    // Clean up SQLite temp files
    try {
      const cwd = process.cwd();
      for (const entry of readdirSync(cwd)) {
        if (/^file:/.test(entry)) {
          rmSync(join(cwd, entry), { recursive: true, force: true });
          console.log(`[Global Teardown] Removed SQLite temp: ${entry}`);
        }
      }
    } catch {}

    console.log('[Global Teardown] Cleanup complete');
  } catch (error) {
    console.error('[Global Teardown] Error during cleanup:', error);
  }
}
