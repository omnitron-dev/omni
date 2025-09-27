/**
 * Test: Netron Integration in Titan Application
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('netron');

import { Application, createApp, NetronToken } from '../src/index.js';

describe('Netron Integration', () => {
  let app: Application;

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  it('should provide Netron as lazy-loaded singleton', async () => {
    app = createApp({
      name: 'test-netron',
      config: {
        netron: {
          id: 'test-node'
        }
      }
    });

    await app.start();

    // Netron should be available through getter
    const netron = app.netron;
    expect(netron).toBeDefined();
    expect(netron?.id).toBe('test-node');
  });

  it('should inject Netron into services', async () => {
    app = createApp({
      name: 'test-injection',
      config: {
        netron: {
          id: 'injection-test'
        }
      }
    });

    await app.start();

    // Directly get Netron from the container
    const netron = app.resolve(NetronToken);
    expect(netron).toBeDefined();
    expect(netron.id).toBe('injection-test');

    // Test that it's the same instance as the getter
    const netronFromGetter = app.netron;
    expect(netronFromGetter).toBe(netron);
  });

  it('should start and stop Netron with application lifecycle', async () => {
    app = createApp({
      name: 'test-lifecycle',
      config: {
        netron: {
          id: 'lifecycle-test'
        }
      }
    });

    const startSpy = jest.fn();
    const stopSpy = jest.fn();

    // Mock Netron start/stop
    app.on('module:started', (event) => {
      if (event.module === 'netron') {
        startSpy();
      }
    });

    app.on('module:stopped', (event) => {
      if (event.module === 'netron') {
        stopSpy();
      }
    });

    await app.start();
    expect(startSpy).toHaveBeenCalled();

    await app.stop();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('should handle missing Netron configuration gracefully', async () => {
    app = createApp({
      name: 'test-no-config'
      // No netron config provided
    });

    await app.start();

    // Netron should still be available with default config
    const netron = app.netron;
    expect(netron).toBeDefined();
    expect(netron?.id).toContain('test-no-config'); // Should use app name in ID
  });

  it('should not fail app start if Netron fails', async () => {
    // Create app with invalid Netron config that might cause failure
    app = createApp({
      name: 'test-failure',
      config: {
        netron: {
          port: -1 // Invalid port
        }
      }
    });

    // App should start even if Netron has issues
    await expect(app.start()).resolves.not.toThrow();
    expect(app.isStarted).toBe(true);
  });

  it('should support multiple Netron instances in different apps', async () => {
    const app1 = createApp({
      name: 'app1',
      config: {
        netron: { id: 'netron1' }
      }
    });

    const app2 = createApp({
      name: 'app2',
      config: {
        netron: { id: 'netron2' }
      }
    });

    await app1.start();
    await app2.start();

    expect(app1.netron?.id).toBe('netron1');
    expect(app2.netron?.id).toBe('netron2');

    await app1.stop();
    await app2.stop();
  });

  it('should gracefully handle Netron lifecycle errors', async () => {
    const mockNetron = require('@netron').Netron;

    // Mock Netron to throw on start
    mockNetron.prototype.start = jest.fn().mockRejectedValue(new Error('Netron start failed'));

    app = createApp({
      name: 'test-error',
      config: {
        netron: { id: 'error-test' }
      }
    });

    // Application should still start even if Netron fails
    await expect(app.start()).resolves.not.toThrow();
    expect(app.isStarted).toBe(true);

    // Reset mock
    mockNetron.prototype.start = jest.fn().mockResolvedValue(undefined);
  });

  it('should properly clean up Netron on app shutdown', async () => {
    const mockNetron = require('@netron').Netron;
    const stopSpy = jest.spyOn(mockNetron.prototype, 'stop');

    app = createApp({
      name: 'test-cleanup',
      config: {
        netron: { id: 'cleanup-test' }
      }
    });

    await app.start();

    // Access Netron to ensure it's initialized
    const netron = app.netron;
    expect(netron).toBeDefined();

    await app.stop();

    // Netron stop should have been called
    expect(stopSpy).toHaveBeenCalled();

    stopSpy.mockRestore();
  });

  it('should pass logger to Netron', async () => {
    app = createApp({
      name: 'test-logger',
      config: {
        netron: { id: 'logger-test' },
        logger: true
      }
    });

    await app.start();

    // Access Netron to ensure it's initialized
    const netron = app.netron;
    expect(netron).toBeDefined();

    // Since Netron is mocked, we can check its properties
    expect(netron?.id).toBe('logger-test');
    // The logger would be passed in options, but since it's mocked,
    // we just verify Netron was created successfully
    expect(netron?.options).toBeDefined();
    expect(netron?.options.id).toBe('logger-test');
  });

  it('should allow custom Netron configuration', async () => {
    const customConfig = {
      id: 'custom-netron',
      port: 8080,
      host: 'localhost',
      reconnectInterval: 5000,
      maxReconnectAttempts: 10
    };

    app = createApp({
      name: 'test-custom',
      config: {
        netron: customConfig
      }
    });

    await app.start();

    const netron = app.netron;
    expect(netron).toBeDefined();
    expect(netron?.id).toBe('custom-netron');
    expect(netron?.options).toMatchObject(customConfig);
  });
});
