/**
 * Jest Global Teardown
 * Runs once after all test suites
 *
 * Note: This runs in CommonJS context
 *
 * Handles cleanup for:
 * - Docker Redis containers
 * - Native redis-server processes
 * - Temp data directories
 */

const { execFileSync, execSync } = require('child_process');
const { unlinkSync, readFileSync, existsSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

/**
 * Find Docker executable path using cross-platform detection
 * Same logic as globalSetup.ts to ensure consistency
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
 * Stop native redis-server process
 */
function stopNativeRedis(pid) {
  if (!pid) return;

  try {
    // Try graceful shutdown first
    process.kill(pid, 'SIGTERM');

    // Wait a bit then force kill if needed
    setTimeout(() => {
      try {
        process.kill(pid, 0); // Check if still alive
        process.kill(pid, 'SIGKILL'); // Force kill
      } catch {
        // Process already gone
      }
    }, 2000);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      // ESRCH = process doesn't exist, which is fine
      console.warn(`[Global Teardown] Error stopping native redis (PID ${pid}):`, error.message);
    }
  }
}

/**
 * Clean up native Redis data directory
 */
function cleanupNativeRedisData() {
  // Clean up any temp directories that match the pattern
  try {
    const baseDir = tmpdir();
    const prefix = 'redis-test-global-';
    const fs = require('fs');
    const entries = fs.readdirSync(baseDir);

    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        const fullPath = join(baseDir, entry);
        try {
          rmSync(fullPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Clean up SQLite in-memory database temp files
 * These files are created when using file: URI with mode=memory or :memory:
 * but the filesystem creates literal files with these names
 */
function cleanupSqliteTempFiles() {
  const fs = require('fs');
  const cwd = process.cwd();

  try {
    const entries = fs.readdirSync(cwd);

    // Patterns for SQLite temp files that shouldn't be created
    const patterns = [
      /^file:/,  // Any file starting with 'file:'
    ];

    for (const entry of entries) {
      // Check if it matches any pattern
      const shouldDelete = patterns.some(pattern => pattern.test(entry));

      if (shouldDelete) {
        const fullPath = join(cwd, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            fs.unlinkSync(fullPath);
            console.log(`[Global Teardown] Removed SQLite temp file: ${entry}`);
          } else if (stat.isDirectory()) {
            rmSync(fullPath, { recursive: true, force: true });
            console.log(`[Global Teardown] Removed SQLite temp dir: ${entry}`);
          }
        } catch (err) {
          console.warn(`[Global Teardown] Failed to remove ${entry}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Global Teardown] Error cleaning SQLite temp files:', err.message);
  }
}

module.exports = async function globalTeardown() {
  console.log('[Global Teardown] Cleaning up Redis resources...');

  try {
    // Read Redis info to determine cleanup strategy
    let redisInfo;
    try {
      const infoFile = join(__dirname, '.redis-test-info.json');
      redisInfo = JSON.parse(readFileSync(infoFile, 'utf-8'));
    } catch {
      redisInfo = global.__REDIS_INFO__;
    }

    // Handle mock mode - nothing to clean up
    if (redisInfo && redisInfo.isMock) {
      console.log('[Global Teardown] MockRedis mode - no cleanup needed');
    }
    // Handle native redis-server
    else if (redisInfo && redisInfo.isNative && redisInfo.pid) {
      console.log(`[Global Teardown] Stopping native redis-server (PID ${redisInfo.pid})...`);
      stopNativeRedis(redisInfo.pid);
      cleanupNativeRedisData();
      console.log('[Global Teardown] Native Redis stopped');
    }
    // Handle Docker container
    else if (redisInfo && redisInfo.isDocker) {
      const dockerPath = findDockerPath();
      console.log(`[Global Teardown] Using Docker at: ${dockerPath}`);

      try {
        console.log('[Global Teardown] Stopping Redis container...');
        execFileSync(dockerPath, ['stop', 'test-redis-global'], { stdio: 'ignore', timeout: 30000 });
        execFileSync(dockerPath, ['rm', '-f', 'test-redis-global'], { stdio: 'ignore', timeout: 10000 });
        console.log('[Global Teardown] Redis container stopped');
      } catch (error) {
        console.warn('[Global Teardown] Error stopping container:', error.message);
        // Try force removal as fallback
        try {
          execFileSync(dockerPath, ['rm', '-f', 'test-redis-global'], { stdio: 'ignore', timeout: 10000 });
        } catch {
          // Ignore - container may already be removed
        }
      }
    }
    // Handle external Redis - nothing to clean up
    else if (redisInfo && redisInfo.isExternal) {
      console.log('[Global Teardown] External Redis - no cleanup needed');
    }

    // Clean up info file
    try {
      const infoFile = join(__dirname, '.redis-test-info.json');
      unlinkSync(infoFile);
    } catch {
      // Ignore if file doesn't exist
    }

    // Clean up SQLite temp files created during tests
    cleanupSqliteTempFiles();

    console.log('[Global Teardown] Cleanup complete');
  } catch (error) {
    console.error('[Global Teardown] Error during cleanup:', error);
  }
};
