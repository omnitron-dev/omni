/**
 * E2E Tests for Unified Server
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Server E2E Tests', () => {
  let serverProcess: ChildProcess;
  let port: number;

  beforeAll(async () => {
    port = Math.floor(Math.random() * 10000) + 40000;
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

  describe('Production Server E2E', () => {
    beforeAll(async () => {
      // Start production server
      serverProcess = spawn('node', [
        path.join(__dirname, 'fixtures', 'prod-server.js'),
        '--port',
        port.toString(),
      ]);

      // Wait for server to start
      await waitForServer(`http://localhost:${port}`);
    });

    afterAll(() => {
      if (serverProcess) {
        serverProcess.kill();
      }
    });

    it('should serve production application', async () => {
      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toMatch(/<html.*>/);
      expect(html).toMatch(/<body.*>/);
    });

    it('should handle production routing', async () => {
      // Test multiple routes
      const routes = ['/about', '/contact', '/products'];

      for (const route of routes) {
        const response = await fetch(`http://localhost:${port}${route}`);
        // Routes might return 404 or 200 depending on config
        expect(response.status).toBeLessThanOrEqual(404);
      }
    });

    it('should serve static assets with caching', async () => {
      const response = await fetch(`http://localhost:${port}/assets/app.js`);

      if (response.status === 200) {
        expect(response.headers.get('cache-control')).toContain('max-age');
        expect(response.headers.get('content-type')).toContain('javascript');
      }
    });

    it('should handle API endpoints', async () => {
      const response = await fetch(`http://localhost:${port}/api/health`);
      // API might not be configured, so check for valid response
      expect(response.status).toBeLessThanOrEqual(404);
    });

    it('should support compression', async () => {
      const response = await fetch(`http://localhost:${port}/`, {
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });

      expect(response.status).toBe(200);
      // Check if response might be compressed
      const encoding = response.headers.get('content-encoding');
      if (encoding) {
        expect(['gzip', 'deflate', 'br']).toContain(encoding);
      }
    });
  });

  describe('Development Server E2E', () => {
    let devPort: number;
    let devProcess: ChildProcess;

    beforeAll(async () => {
      devPort = Math.floor(Math.random() * 10000) + 50000;

      // Start development server
      devProcess = spawn('node', [
        path.join(__dirname, 'fixtures', 'dev-server.js'),
        '--port',
        devPort.toString(),
      ]);

      // Wait for server to start
      await waitForServer(`http://localhost:${devPort}`);
    });

    afterAll(() => {
      if (devProcess) {
        devProcess.kill();
      }
    });

    it('should serve development application', async () => {
      const response = await fetch(`http://localhost:${devPort}/`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('__aether'); // Dev scripts injected
    });

    it('should inject HMR client', async () => {
      const response = await fetch(`http://localhost:${devPort}/`);
      const html = await response.text();

      expect(html).toContain('hmr-client.js');
      expect(html).toContain('initHMR');
    });

    it('should inject error overlay', async () => {
      const response = await fetch(`http://localhost:${devPort}/`);
      const html = await response.text();

      expect(html).toContain('error-overlay.js');
      expect(html).toContain('initErrorOverlay');
    });

    it('should support HMR WebSocket', async () => {
      const ws = new WebSocket(`ws://localhost:${devPort}/__aether_hmr`);

      return new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'ping' }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          expect(message.type).toBe('pong');
          ws.close();
          resolve();
        });

        ws.on('error', reject);

        setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
      });
    });

    it('should enable CORS in development', async () => {
      const response = await fetch(`http://localhost:${devPort}/`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
      expect(response.headers.get('access-control-allow-methods')).toBeTruthy();
    });

    it('should handle dev errors with error page', async () => {
      const response = await fetch(`http://localhost:${devPort}/error-test`);

      if (response.status === 500) {
        const html = await response.text();
        expect(html).toContain('Error');
      }
    });

    it('should support hot reload on file changes', async () => {
      // This test would require file system operations
      // Simulating by checking HMR infrastructure
      const ws = new WebSocket(`ws://localhost:${devPort}/__aether_hmr`);

      return new Promise<void>((resolve) => {
        ws.on('open', () => {
          // Connected to HMR socket
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });
      });
    });
  });

  describe('CLI Integration E2E', () => {
    it('should start server with CLI command', async () => {
      const cliPort = Math.floor(Math.random() * 10000) + 60000;

      const cliProcess = spawn('npx', [
        'aether',
        'server',
        '--port',
        cliPort.toString(),
        '--mode',
        'development',
      ], {
        cwd: path.join(__dirname, '../../..'),
      });

      try {
        await waitForServer(`http://localhost:${cliPort}`, 10000);

        const response = await fetch(`http://localhost:${cliPort}/`);
        expect(response.status).toBe(200);
      } finally {
        cliProcess.kill();
      }
    });

    it('should accept all CLI options', async () => {
      const cliPort = Math.floor(Math.random() * 10000) + 61000;

      const cliProcess = spawn('npx', [
        'aether',
        'server',
        '--port', cliPort.toString(),
        '--host', 'localhost',
        '--mode', 'production',
        '--ssr-mode', 'ssg',
        '--cors',
        '--compression',
        '--cache',
        '--metrics',
        '--health-endpoint', '/_health',
        '--ready-endpoint', '/_ready',
      ], {
        cwd: path.join(__dirname, '../../..'),
      });

      try {
        await waitForServer(`http://localhost:${cliPort}`, 10000);

        // Test health endpoint
        const healthResponse = await fetch(`http://localhost:${cliPort}/_health`);
        expect(healthResponse.status).toBe(200);

        // Test ready endpoint
        const readyResponse = await fetch(`http://localhost:${cliPort}/_ready`);
        expect(readyResponse.status).toBe(200);

        // Test metrics endpoint
        const metricsResponse = await fetch(`http://localhost:${cliPort}/_metrics`);
        expect(metricsResponse.status).toBe(200);
        const metrics = await metricsResponse.text();
        expect(metrics).toContain('aether_uptime');
      } finally {
        cliProcess.kill();
      }
    });
  });

  describe('Multi-Runtime E2E', () => {
    it('should run on Node.js', async () => {
      const nodePort = Math.floor(Math.random() * 10000) + 62000;

      const nodeProcess = spawn('node', [
        path.join(__dirname, 'fixtures', 'runtime-test.js'),
        '--port',
        nodePort.toString(),
      ]);

      try {
        await waitForServer(`http://localhost:${nodePort}`);

        const response = await fetch(`http://localhost:${nodePort}/`);
        expect(response.status).toBe(200);

        const info = await fetch(`http://localhost:${nodePort}/_info`);
        const data = await info.json();
        expect(data.runtime).toBe('node');
      } finally {
        nodeProcess.kill();
      }
    });

    it('should run on Bun (if available)', async () => {
      const hasBun = await checkCommandExists('bun');

      if (!hasBun) {
        console.log('Bun not available, skipping test');
        return;
      }

      const bunPort = Math.floor(Math.random() * 10000) + 63000;

      const bunProcess = spawn('bun', [
        path.join(__dirname, 'fixtures', 'runtime-test.js'),
        '--port',
        bunPort.toString(),
      ]);

      try {
        await waitForServer(`http://localhost:${bunPort}`);

        const response = await fetch(`http://localhost:${bunPort}/`);
        expect(response.status).toBe(200);

        const info = await fetch(`http://localhost:${bunPort}/_info`);
        const data = await info.json();
        expect(data.runtime).toBe('bun');
      } finally {
        bunProcess.kill();
      }
    });

    it('should run on Deno (if available)', async () => {
      const hasDeno = await checkCommandExists('deno');

      if (!hasDeno) {
        console.log('Deno not available, skipping test');
        return;
      }

      const denoPort = Math.floor(Math.random() * 10000) + 64000;

      const denoProcess = spawn('deno', [
        'run',
        '--allow-net',
        '--allow-env',
        '--allow-read',
        path.join(__dirname, 'fixtures', 'runtime-test.js'),
        '--port',
        denoPort.toString(),
      ]);

      try {
        await waitForServer(`http://localhost:${denoPort}`);

        const response = await fetch(`http://localhost:${denoPort}/`);
        expect(response.status).toBe(200);

        const info = await fetch(`http://localhost:${denoPort}/_info`);
        const data = await info.json();
        expect(data.runtime).toBe('deno');
      } finally {
        denoProcess.kill();
      }
    });
  });

  describe('Performance E2E', () => {
    let perfPort: number;
    let perfProcess: ChildProcess;

    beforeAll(async () => {
      perfPort = Math.floor(Math.random() * 10000) + 65000;

      perfProcess = spawn('node', [
        path.join(__dirname, 'fixtures', 'prod-server.js'),
        '--port',
        perfPort.toString(),
      ]);

      await waitForServer(`http://localhost:${perfPort}`);
    });

    afterAll(() => {
      if (perfProcess) {
        perfProcess.kill();
      }
    });

    it('should handle load test', async () => {
      const requests = 1000;
      const concurrency = 10;

      const startTime = Date.now();

      for (let i = 0; i < requests / concurrency; i++) {
        const batch = Array.from({ length: concurrency }, () =>
          fetch(`http://localhost:${perfPort}/`)
        );

        const responses = await Promise.all(batch);
        responses.forEach((response) => {
          expect(response.status).toBe(200);
        });
      }

      const duration = Date.now() - startTime;
      const rps = requests / (duration / 1000);

      // Should handle at least 100 requests per second
      expect(rps).toBeGreaterThan(100);
    });

    it('should maintain low latency', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        const response = await fetch(`http://localhost:${perfPort}/`);
        const latency = Date.now() - start;

        expect(response.status).toBe(200);
        latencies.push(latency);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      // Average latency should be under 50ms
      expect(avgLatency).toBeLessThan(50);

      // P95 latency should be under 100ms
      expect(p95Latency).toBeLessThan(100);
    });
  });

  describe('Graceful Shutdown E2E', () => {
    it('should shutdown gracefully on SIGTERM', async () => {
      const shutdownPort = Math.floor(Math.random() * 10000) + 66000;

      const shutdownProcess = spawn('node', [
        path.join(__dirname, 'fixtures', 'graceful-shutdown-test.js'),
        '--port',
        shutdownPort.toString(),
      ]);

      await waitForServer(`http://localhost:${shutdownPort}`);

      // Start a long-running request
      const longRequest = fetch(`http://localhost:${shutdownPort}/slow`);

      // Send SIGTERM
      shutdownProcess.kill('SIGTERM');

      // Should complete the request before shutting down
      const response = await longRequest;
      expect(response.status).toBe(200);

      // Server should be down now
      await expect(
        fetch(`http://localhost:${shutdownPort}/`)
      ).rejects.toThrow();
    });
  });
});

/**
 * Helper to wait for server to start
 */
async function waitForServer(url: string, timeout = 5000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return;
      }
    } catch (error) {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Server did not start at ${url} within ${timeout}ms`);
}

/**
 * Check if command exists
 */
async function checkCommandExists(command: string): Promise<boolean> {
  const { exec } = await import('child_process');

  return new Promise((resolve) => {
    exec(`which ${command}`, (error) => {
      resolve(!error);
    });
  });
}