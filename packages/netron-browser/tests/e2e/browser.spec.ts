/**
 * E2E Browser tests for Netron Browser
 * Tests the client in a real browser environment
 */

import { test, expect } from '@playwright/test';
import { createTitanServer } from '../fixtures/titan-server.js';

let serverFixture: any;

test.beforeAll(async () => {
  // Start Titan server for E2E tests
  serverFixture = await createTitanServer({
    port: 3456, // Use fixed port for E2E tests
    enableHttp: true,
    enableWebSocket: false, // Disable WS for now to avoid server issues
    logLevel: 'error',
  });
});

test.afterAll(async () => {
  if (serverFixture) {
    await serverFixture.cleanup();
  }
});

test.describe('Netron Browser E2E', () => {
  test('should load netron-browser in browser and make HTTP RPC calls', async ({ page }) => {
    // Navigate to test page
    await page.goto('http://localhost:8080/tests/fixtures/test-app.html');

    // Wait for the app to load
    await page.waitForFunction(() => typeof window !== 'undefined');

    // Test HTTP client connection
    const connectionResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      return client.getState();
    });

    expect(connectionResult).toBe('connected');

    // Test Calculator service - add method
    const addResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      return await client.invoke('calculator@1.0.0', 'add', [5, 3]);
    });

    expect(addResult).toBe(8);

    // Test Calculator service - multiply method
    const multiplyResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      return await client.invoke('calculator@1.0.0', 'multiply', [6, 7]);
    });

    expect(multiplyResult).toBe(42);

    // Test User service - getUser method
    const userResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      return await client.invoke('user@1.0.0', 'getUser', ['1']);
    });

    expect(userResult).toEqual({
      id: '1',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'admin',
    });

    // Test Echo service
    const echoResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      return await client.invoke('echo@1.0.0', 'echoString', ['Hello from browser!']);
    });

    expect(echoResult).toBe('Hello from browser!');

    // Test error handling
    const errorResult = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();
      try {
        await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
        return null;
      } catch (error: any) {
        return error.message;
      }
    });

    expect(errorResult).toContain('Division by zero');
  });

  test('should handle connection metrics', async ({ page }) => {
    await page.goto('http://localhost:8080/tests/fixtures/test-app.html');

    const metrics = await page.evaluate(async () => {
      // @ts-ignore
      const { HttpClient } = window.NetronBrowser;
      const client = new HttpClient({
        url: 'http://localhost:3456',
        timeout: 5000,
      });

      await client.connect();

      // Make some requests
      await client.invoke('calculator@1.0.0', 'add', [1, 2]);
      await client.invoke('calculator@1.0.0', 'multiply', [3, 4]);

      return client.getMetrics();
    });

    expect(metrics).toMatchObject({
      requestsSent: 2,
      responsesReceived: 2,
      errors: 0,
      transport: 'http',
      state: 'connected',
    });
  });
});
