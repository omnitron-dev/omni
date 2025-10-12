/**
 * Bun test runner for @omnitron-dev/titan
 * Simplified tests for Bun compatibility
 */

import { describe, test, expect } from 'bun:test';

// Import core functionality
import { Application, createApp } from '../../src/application';
import { ConfigModule } from '../../src/modules/config.module';
import { LoggerModule } from '../../src/modules/logger.module';

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
    const { Container } = await import('@omnitron-dev/nexus');
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

  test('should use ConfigModule', () => {
    const config = new ConfigModule();
    config.set('test.value', 42);
    expect(config.get('test.value')).toBe(42);
  });

  test('should use LoggerModule', () => {
    const logger = new LoggerModule();
    expect(logger).toBeDefined();
    // LoggerModule needs an application to start, just test that it was created
    expect(logger.name).toBe('logger');
  });
});
