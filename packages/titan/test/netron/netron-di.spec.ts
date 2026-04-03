/**
 * Test Netron DI integration
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '../../src/nexus/index.js';
import { Netron } from '../../src/netron/netron.js';
import { NETRON_TOKEN } from '../../src/application/index.js';
import { LOGGER_SERVICE_TOKEN } from '../../src/modules/logger/index.js';
import type { ILogger } from '../../src/modules/logger/logger.types.js';
import type { NetronOptions } from '../../src/netron/types.js';

describe('Netron DI Integration', () => {
  let container: Container;
  let logger: ILogger;

  beforeEach(() => {
    container = new Container();

    // Create mock logger
    logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockImplementation((bindings) => ({
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      })),
    } as any;

    // Register logger
    container.register(LOGGER_SERVICE_TOKEN, {
      useValue: logger,
    });
  });

  it('should create Netron instance through DI', () => {
    // Create Netron instance with options
    const options: NetronOptions = {
      id: 'test-netron',
      listenHost: 'localhost',
      listenPort: 8080,
    };

    const netron = new Netron(logger, options);

    // Register as singleton in container
    container.register(NETRON_TOKEN, {
      useValue: netron,
    });

    // Resolve Netron
    const resolvedNetron = container.resolve(NETRON_TOKEN);

    expect(resolvedNetron).toBeInstanceOf(Netron);
    expect(resolvedNetron.id).toBe('test-netron');
    expect(resolvedNetron.options?.listenHost).toBe('localhost');
    expect(resolvedNetron.options?.listenPort).toBe(8080);
    expect(logger.child).toHaveBeenCalledWith({
      module: 'netron',
      netronId: 'test-netron',
    });
  });

  it('should work without options', () => {
    // Create Netron without options
    const netron = new Netron(logger);

    // Register as singleton in container
    container.register(NETRON_TOKEN, {
      useValue: netron,
    });

    // Resolve Netron
    const resolvedNetron = container.resolve(NETRON_TOKEN);

    expect(resolvedNetron).toBeInstanceOf(Netron);
    expect(resolvedNetron.id).toBeDefined();
    expect(resolvedNetron.options).toBeDefined();
    expect(logger.child).toHaveBeenCalled();
  });

  it('should work with standalone create with logger', async () => {
    const options: NetronOptions = {
      id: 'standalone-netron',
    };

    const netron = await Netron.create(logger, options);

    expect(netron).toBeInstanceOf(Netron);
    expect(netron.id).toBe('standalone-netron');
    expect(netron.isStarted).toBe(true);
  });

  it('should work with standalone create without options', async () => {
    const netron = await Netron.create(logger);

    expect(netron).toBeInstanceOf(Netron);
    expect(netron.id).toBeDefined();
    expect(netron.isStarted).toBe(true);
  });
});
