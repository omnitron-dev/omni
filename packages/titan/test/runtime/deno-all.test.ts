/**
 * Deno test runner for @omnitron-dev/titan
 * Simplified tests for Deno compatibility
 */

import { describe, it, expect, run } from 'https://deno.land/x/tincan@1.0.2/mod.ts';

// Import core functionality
import { Application, createApp } from '../../src/application.ts';
import { ConfigModule } from '../../src/modules/config.module.ts';
import { LoggerModule } from '../../src/modules/logger.module.ts';
import { Container } from '../../../nexus/src/index.ts';

// Deno-specific runtime tests
describe('@omnitron-dev/titan Deno Runtime', () => {
  it('should detect Deno runtime', () => {
    expect(typeof Deno).toBe('object');
    expect(Deno.version).toBeDefined();
  });

  it('should have Deno-specific APIs', () => {
    expect(typeof Deno.readFile).toBe('function');
    expect(typeof Deno.writeFile).toBe('function');
  });

  it('should support Deno.env', () => {
    expect(Deno.env).toBeDefined();
  });
});

// Basic functionality tests
describe('Titan Application in Deno', () => {
  it('should create application', () => {
    const app = createApp({
      disableGracefulShutdown: true,
      name: 'deno-test-app'
    });
    expect(app).toBeDefined();
    expect(app instanceof Application).toBe(true);
  });

  it('should start and stop application', async () => {
    // Create a new container for this test to avoid duplicate registration
    const container = new Container();

    const app = new Application({
      disableGracefulShutdown: true,
      name: 'deno-test-app'
    }, container);

    await app.start();
    expect(app.state).toBe('started');

    await app.stop();
    expect(app.state).toBe('stopped');
  });

  it('should use ConfigModule', () => {
    const config = new ConfigModule();
    config.set('test.value', 42);
    expect(config.get('test.value')).toBe(42);
  });

  it('should use LoggerModule', () => {
    const logger = new LoggerModule();
    expect(logger).toBeDefined();
    // LoggerModule needs an application to start, just test that it was created
    expect(logger.name).toBe('logger');
  });
});

// Run the tests
run();