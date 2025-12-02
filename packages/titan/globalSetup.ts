/**
 * Jest Global Setup
 * Runs once before all test suites
 *
 * Note: This runs in CommonJS context, so we inline the Docker logic
 *
 * Redis connection strategies (in order of priority):
 * 1. USE_MOCK_REDIS=true - Use in-memory MockRedis (CI environments)
 * 2. Native redis-server - If available locally
 * 3. Docker Redis - Start container with random port
 * 4. Fallback to localhost:6379 - Assume Redis is running externally
 * 5. Mock mode - If all else fails
 */

const { execFileSync, execSync, spawn } = require('child_process');
const { writeFileSync, rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const net = require('net');

let nativeRedisProcess = null;

/**
 * Find Docker executable path using cross-platform detection
 */
function findDockerPath() {
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where' : 'which';
  const dockerBinary = isWindows ? 'docker.exe' : 'docker';

  // Strategy 1: Try to find docker in PATH
  try {
    const result = execSync(`${whichCommand} ${dockerBinary}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    const dockerPath = result.split('\n')[0]?.trim();
    if (dockerPath) {
      return dockerPath;
    }
  } catch {
    // Continue to fallback paths
  }

  // Strategy 2: Platform-specific fallback paths
  let fallbackPaths = [];

  if (process.platform === 'darwin') {
    fallbackPaths = [
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    ];
  } else if (process.platform === 'win32') {
    fallbackPaths = [
      'docker.exe',
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe',
    ];
  } else {
    // Linux
    fallbackPaths = [
      '/usr/bin/docker',
      '/usr/local/bin/docker',
      '/snap/bin/docker',
      '/var/lib/snapd/snap/bin/docker',
      '/opt/docker/bin/docker',
    ];
  }

  // Try each fallback path
  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      try {
        // Verify it's executable
        execFileSync(path, ['--version'], { stdio: 'ignore' });
        return path;
      } catch {
        continue;
      }
    }
  }

  // Strategy 3: Fall back to just 'docker' and hope it's in PATH
  return dockerBinary;
}

/**
 * Find native redis-server executable
 */
function findRedisServerPath() {
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
      // Verify it works
      execFileSync(redisPath, ['--version'], { stdio: 'ignore' });
      return redisPath;
    }
  } catch {
    // Not found
  }

  // Platform-specific fallback paths
  const fallbackPaths =
    process.platform === 'darwin'
      ? ['/usr/local/bin/redis-server', '/opt/homebrew/bin/redis-server']
      : ['/usr/bin/redis-server', '/usr/local/bin/redis-server'];

  for (const path of fallbackPaths) {
    if (existsSync(path)) {
      try {
        execFileSync(path, ['--version'], { stdio: 'ignore' });
        return path;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Find an available port
 */
function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Wait for Redis to be ready
 */
async function waitForRedis(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
          // Send PING command
          socket.write('*1\r\n$4\r\nPING\r\n');
        });
        socket.on('data', (data) => {
          socket.end();
          if (data.toString().includes('PONG')) {
            resolve();
          } else {
            reject(new Error('Unexpected Redis response'));
          }
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

/**
 * Start native redis-server
 */
async function startNativeRedis(redisPath, port) {
  const dataDir = join(tmpdir(), `redis-test-global-${process.pid}`);

  // Create data directory
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  nativeRedisProcess = spawn(
    redisPath,
    ['--port', port.toString(), '--bind', '127.0.0.1', '--dir', dataDir, '--save', '', '--appendonly', 'no', '--loglevel', 'warning'],
    { stdio: 'pipe', detached: false }
  );

  // Store data dir for cleanup
  nativeRedisProcess.dataDir = dataDir;

  return new Promise((resolve, reject) => {
    nativeRedisProcess.on('error', reject);
    nativeRedisProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`redis-server exited with code ${code}`));
      }
    });

    // Wait a bit for startup
    setTimeout(async () => {
      const ready = await waitForRedis(port, 20);
      if (ready) {
        resolve();
      } else {
        nativeRedisProcess.kill();
        reject(new Error('Native redis-server failed to start'));
      }
    }, 500);
  });
}

/**
 * Start Docker Redis container
 */
async function startDockerRedis(dockerPath, port) {
  // Remove existing container if it exists
  try {
    execFileSync(dockerPath, ['rm', '-f', 'test-redis-global'], {
      stdio: 'ignore',
    });
  } catch {
    // Ignore if doesn't exist
  }

  // Start Redis container
  const containerId = execFileSync(
    dockerPath,
    [
      'run',
      '-d',
      '--name',
      'test-redis-global',
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

  // Wait for health check
  for (let i = 0; i < 30; i++) {
    try {
      const health = execFileSync(dockerPath, ['inspect', '--format={{.State.Health.Status}}', 'test-redis-global'], {
        encoding: 'utf-8',
      }).trim();

      if (health === 'healthy') {
        return containerId;
      }
    } catch {
      // Container not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Redis container failed to become healthy within 30 seconds');
}

/**
 * Write Redis info to file
 */
function writeRedisInfo(info) {
  const infoFile = join(__dirname, '.redis-test-info.json');
  writeFileSync(infoFile, JSON.stringify(info, null, 2));
  global.__REDIS_INFO__ = info;
}

module.exports = async function globalSetup() {
  console.log('[Global Setup] Initializing Redis for tests...');

  // Strategy 1: Check for USE_MOCK_REDIS environment variable
  if (process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true') {
    console.log('[Global Setup] Using MockRedis (USE_MOCK_REDIS or CI mode)');
    writeRedisInfo({
      url: 'mock://localhost',
      port: 0,
      isMock: true,
      isDocker: false,
    });
    return;
  }

  // Strategy 2: Try native redis-server
  const redisServerPath = findRedisServerPath();
  if (redisServerPath) {
    console.log(`[Global Setup] Found native redis-server at: ${redisServerPath}`);
    try {
      const port = await findAvailablePort();
      await startNativeRedis(redisServerPath, port);
      console.log(`[Global Setup] Native Redis started on port ${port}`);
      writeRedisInfo({
        url: `redis://localhost:${port}`,
        port: port,
        isDocker: false,
        isNative: true,
        pid: nativeRedisProcess.pid,
      });
      return;
    } catch (error) {
      console.warn(`[Global Setup] Failed to start native redis-server: ${error.message}`);
    }
  }

  // Strategy 3: Try Docker Redis
  try {
    const dockerPath = findDockerPath();
    console.log(`[Global Setup] Trying Docker at: ${dockerPath}`);

    // Verify Docker is working
    execFileSync(dockerPath, ['version'], { stdio: 'ignore', timeout: 5000 });

    const port = await findAvailablePort();
    const containerId = await startDockerRedis(dockerPath, port);
    console.log(`[Global Setup] Docker Redis started (container ${containerId.substring(0, 12)}) on port ${port}`);
    writeRedisInfo({
      url: `redis://localhost:${port}`,
      port: port,
      isDocker: true,
      containerId: containerId,
    });
    return;
  } catch (error) {
    console.warn(`[Global Setup] Failed to start Docker Redis: ${error.message}`);
  }

  // Strategy 4: Try to connect to existing Redis on localhost:6379
  try {
    const ready = await waitForRedis(6379, 3);
    if (ready) {
      console.log('[Global Setup] Using existing Redis at localhost:6379');
      writeRedisInfo({
        url: 'redis://localhost:6379',
        port: 6379,
        isDocker: false,
        isExternal: true,
      });
      return;
    }
  } catch {
    // Not available
  }

  // Strategy 5: Fall back to mock mode
  console.log('[Global Setup] No Redis available, falling back to MockRedis');
  console.log('[Global Setup] Tests requiring real Redis may fail or be skipped');
  writeRedisInfo({
    url: 'mock://localhost',
    port: 0,
    isMock: true,
    isDocker: false,
  });
};

// Export for cleanup
module.exports.getNativeRedisProcess = () => nativeRedisProcess;
