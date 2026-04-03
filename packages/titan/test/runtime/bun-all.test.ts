/**
 * Bun test runner for @omnitron-dev/titan
 * Simplified tests for Bun compatibility
 */

import { describe, test, expect } from 'bun:test';

// Import core functionality from compiled dist
import { Application, createApp } from '../../dist/application/index.js';
import { ConfigModule } from '../../dist/modules/config/index.js';
import { LoggerModule } from '../../dist/modules/logger/index.js';

// Bun-specific runtime tests
describe('@omnitron-dev/titan Bun Runtime', () => {
  test('should detect Bun runtime', () => {
    expect(typeof Bun).toBe('object');
    expect(Bun.version).toBeDefined();
  });

  test('should have Bun-specific APIs', () => {
    expect(typeof Bun.file).toBe('function');
    expect(typeof Bun.write).toBe('function');
  });

  test('should support Bun.env', () => {
    expect(Bun.env).toBeDefined();
  });
});

// Basic functionality tests
describe('Titan Application in Bun', () => {
  test('should create application', () => {
    const app = createApp({
      disableGracefulShutdown: true,
      name: 'bun-test-app',
    });
    expect(app).toBeDefined();
    expect(app instanceof Application).toBe(true);
  });

  test('should start and stop application', async () => {
    // Create a new container for this test to avoid duplicate registration
    const { Container } = await import('../../dist/nexus/index.js');
    const container = new Container();

    const app = new Application(
      {
        disableGracefulShutdown: true,
        name: 'bun-test-app',
      },
      container
    );

    await app.start();
    expect(app.state).toBe('started');

    await app.stop();
    expect(app.state).toBe('stopped');
  });

  test('should import ConfigModule', () => {
    expect(ConfigModule).toBeDefined();
    expect(typeof ConfigModule.forRoot).toBe('function');
  });

  test('should import LoggerModule', () => {
    expect(LoggerModule).toBeDefined();
    expect(typeof LoggerModule.forRoot).toBe('function');
  });
});
