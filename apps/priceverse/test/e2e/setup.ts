/**
 * Priceverse - E2E Test Setup
 * Provides utilities for starting/stopping the server and making requests
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { beforeAll, afterAll } from 'vitest';

export interface TestServer {
  process: ChildProcess;
  baseUrl: string;
  port: number;
}

let testServer: TestServer | null = null;

/**
 * Start the Priceverse server for E2E testing
 */
export async function startTestServer(port = 3001, timeout = 30000): Promise<TestServer> {
  if (testServer) {
    return testServer;
  }

  const baseUrl = `http://localhost:${port}`;

  // Set environment variables for test server
  // NOTE: The ConfigModule uses '__' (double underscore) as separator for nested paths
  // So 'app.port' becomes 'PRICEVERSE_APP__PORT' (with double underscore)
  const env = {
    ...process.env,
    PRICEVERSE_APP__PORT: port.toString(),
    PRICEVERSE_APP__HOST: 'localhost',
    PRICEVERSE_LOGGING__LEVEL: 'error', // Reduce noise in tests
    PRICEVERSE_HEALTH__ENABLED: 'true',
  };

  // Start the server process
  const serverProcess = spawn('tsx', ['src/main.ts'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect output for debugging
  let output = '';
  serverProcess.stdout?.on('data', (data) => {
    output += data.toString();
  });

  serverProcess.stderr?.on('data', (data) => {
    output += data.toString();
  });

  // Wait for server to be ready
  const startTime = Date.now();
  let isReady = false;

  while (!isReady && Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        isReady = true;
        break;
      }
    } catch (error) {
      // Server not ready yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!isReady) {
    serverProcess.kill();
    throw new Error(
      `Server failed to start within ${timeout}ms.\nOutput:\n${output}`
    );
  }

  testServer = {
    process: serverProcess,
    baseUrl,
    port,
  };

  return testServer;
}

/**
 * Stop the test server with timeout
 */
export async function stopTestServer(): Promise<void> {
  if (!testServer) {
    return;
  }

  const serverToStop = testServer;
  testServer = null; // Clear immediately to prevent double-stop

  return new Promise((resolve) => {
    const { process: serverProcess } = serverToStop;

    // If already exited, resolve immediately
    if (serverProcess.exitCode !== null) {
      resolve();
      return;
    }

    // Timeout to prevent hanging
    const timeout = setTimeout(() => {
      try {
        serverProcess.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
      resolve();
    }, 8000);

    serverProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    // Send SIGTERM for graceful shutdown
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      // Process may already be dead
      clearTimeout(timeout);
      resolve();
    }
  });
}

/**
 * Setup E2E test server lifecycle
 */
export function setupTestServer(port = 3001) {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer(port);
  }, 35000); // 35s timeout for server startup

  afterAll(async () => {
    await stopTestServer();
  }, 15000); // 15s timeout for shutdown

  return {
    getBaseUrl: () => server?.baseUrl || `http://localhost:${port}`,
  };
}

/**
 * Make a JSON-RPC request to Netron
 * Uses the Netron HTTP protocol format with required fields:
 * - id: unique request ID
 * - version: '2.0'
 * - timestamp: current timestamp in ms
 * - service: service name
 * - method: method name
 * - input: method parameters
 */
export async function invokeRpc<T = unknown>(
  baseUrl: string,
  service: string,
  method: string,
  input?: unknown
): Promise<T> {
  const requestId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const response = await fetch(`${baseUrl}/netron/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: requestId,
      version: '2.0',
      timestamp: Date.now(),
      service,
      method,
      input: input || {},
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `RPC request failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  const result = await response.json();

  // Check for RPC error response (success: false indicates error)
  if (!result.success && result.error) {
    const errorMsg = result.error.message || JSON.stringify(result.error);
    throw new Error(`RPC error: ${errorMsg}`);
  }

  // Netron HTTP protocol uses 'data' field for successful responses
  return result.data as T;
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}
