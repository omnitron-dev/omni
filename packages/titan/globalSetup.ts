/**
 * Vitest Global Setup
 * Runs once before all test suites
 *
 * Redis connection strategies (in order of priority):
 * 1. USE_MOCK_REDIS=true - Explicit in-memory unit-test mode
 * 2. Explicitly selected external Redis
 * 3. Native redis-server, when installed
 * 4. Isolated Docker Redis on a loopback port
 * Missing infrastructure fails setup; CI does not select a different test mode.
 */

import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';

let nativeRedisProcess: ChildProcess | null = null;
let runDir: string | undefined;
let ownedContainerId: string | undefined;


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
  const dataDir = mkdtempSync(join(runDir!, 'native-'));

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

async function startDockerRedis(dockerPath: string, port: number): Promise<string> {
  const cidfile = join(runDir!, 'redis.cid');
  try {
    const containerId = execFileSync(
      dockerPath,
      [
        'run',
        '-d',
        '--cidfile',
        cidfile,
        '--rm',
        '-p',
        `127.0.0.1:${port}:6379`,
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
      { encoding: 'utf-8', timeout: 120_000 }
    ).trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Invalid Redis container ID');
    ownedContainerId = containerId;

    for (let i = 0; i < 30; i++) {
      try {
        const health = execFileSync(dockerPath, ['inspect', '--format={{.State.Health.Status}}', containerId], {
          encoding: 'utf-8',
        }).trim();
        if (health === 'healthy') return containerId;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error('Redis container failed to become healthy within 30 seconds');
  } catch (error) {
    if (!ownedContainerId && existsSync(cidfile)) ownedContainerId = readFileSync(cidfile, 'utf8').trim();
    removeOwnedContainer(dockerPath);
    throw error;
  }
}

function removeOwnedContainer(dockerPath: string) {
  if (ownedContainerId && /^[a-f0-9]{64}$/.test(ownedContainerId)) {
    try {
      execFileSync(dockerPath, ['rm', '-f', '-v', ownedContainerId], { stdio: 'pipe', timeout: 30_000 });
    } catch (error) {
      if (!String((error as { stderr?: Buffer }).stderr).includes('No such container')) throw error;
    }
    ownedContainerId = undefined;
  }
}

function redisInfoPath() {
  return join(runDir!, 'redis-info.json');
}

function writeRedisInfo(info: RedisInfo): void {
  writeFileSync(redisInfoPath(), JSON.stringify(info, null, 2));
  (globalThis as any).__REDIS_INFO__ = info;
}

export async function setup(): Promise<void> {
  runDir = mkdtempSync(join(tmpdir(), 'titan-test-redis-'));
  process.env['TITAN_TEST_REDIS_INFO'] = redisInfoPath();
  console.log('[Global Setup] Initializing Redis for tests...');

  // Strategy 1: Mock Redis
  if (process.env.USE_MOCK_REDIS === 'true') {
    console.log('[Global Setup] Using explicitly requested MockRedis');
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

  await teardown();
  throw new Error('Test Redis unavailable. Run pnpm test:up, or explicitly select USE_MOCK_REDIS=true for unit-only checks.');
}

export async function teardown(): Promise<void> {
  console.log('[Global Teardown] Cleaning up Redis resources...');

  if (ownedContainerId) removeOwnedContainer(findDockerPath());
  const child = nativeRedisProcess;
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>(resolve => {
      const deadline = setTimeout(() => child.kill('SIGKILL'), 2_000);
      child.once('exit', () => { clearTimeout(deadline); resolve(); });
      child.kill('SIGTERM');
    });
  }
  nativeRedisProcess = null;
  if (runDir) {
    if (process.env['TITAN_TEST_REDIS_INFO'] === redisInfoPath()) delete process.env['TITAN_TEST_REDIS_INFO'];
    rmSync(runDir, { recursive: true, force: true });
    runDir = undefined;
  }
  console.log('[Global Teardown] Cleanup complete');
}
