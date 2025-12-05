/**
 * Priceverse 2.0 - E2E Health Endpoint Tests
 * Tests the HTTP health check endpoint
 *
 * NOTE: The /health endpoint is provided by Titan's HTTP transport layer,
 * not the custom HealthService. It returns a basic status response with:
 * - status: 'online' | 'offline'
 * - uptime: number (milliseconds)
 * - version: '2.0.0'
 *
 * For detailed health checks (with component checks, timestamps, etc.),
 * use the HealthService RPC endpoint via /netron/invoke.
 */

import { describe, it, expect } from 'vitest';
import { setupTestServer } from './setup.js';

describe('E2E: Health Endpoint', () => {
  const testContext = setupTestServer(3001);

  describe('GET /health', () => {
    it('should return 200 OK status', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
    });

    it('should return valid health response structure', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      const health = await response.json();

      // Titan HTTP transport provides basic health endpoint
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('version');
    });

    it('should return correct health status values', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      const health = await response.json();

      // Titan HTTP transport uses 'online'/'offline' status
      expect(['online', 'offline']).toContain(health.status);
    });

    it('should return version 2.0.0', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      const health = await response.json();

      expect(health.version).toBe('2.0.0');
    });

    it('should return uptime as a positive number', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      const health = await response.json();

      expect(typeof health.uptime).toBe('number');
      expect(health.uptime).toBeGreaterThan(0);
    });

    it('should return application/json content-type', async () => {
      const baseUrl = testContext.getBaseUrl();
      const response = await fetch(baseUrl + '/health');
      const contentType = response.headers.get('content-type');

      expect(contentType).toBeTruthy();
      expect(contentType).toContain('application/json');
    });

    it('should handle concurrent health check requests', async () => {
      const baseUrl = testContext.getBaseUrl();
      const requests = Array.from({ length: 10 }, () =>
        fetch(baseUrl + '/health')
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.ok).toBe(true);
      });

      const healthChecks = await Promise.all(
        responses.map((r) => r.json())
      );

      healthChecks.forEach((health) => {
        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('version');
        expect(health.version).toBe('2.0.0');
      });
    });

    it('should respond quickly (< 500ms)', async () => {
      const baseUrl = testContext.getBaseUrl();
      const startTime = Date.now();
      const response = await fetch(baseUrl + '/health');
      const endTime = Date.now();

      expect(response.ok).toBe(true);
      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(500);
    });
  });
});
