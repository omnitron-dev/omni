/**
 * @Logger() must produce a logger that actually logs.
 *
 * The decorator installed a getter returning `createNullLogger()` and wrote a
 * `logger` metadata entry nothing read. No DI path ever assigned the property,
 * so every line logged through `@Logger()` was discarded — with the whole
 * ILogger surface answering, so nothing ever errored. The module's own usage
 * example was exactly that shape.
 *
 * These tests fail if the container wiring is removed.
 */

import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

import { Container } from '../../../src/nexus/index.js';
import { Logger } from '../../../src/modules/logger/logger.decorators.js';
import { LOGGER_SERVICE_TOKEN } from '../../../src/modules/logger/logger.tokens.js';
import type { ILogger, ILoggerModule } from '../../../src/modules/logger/logger.types.js';

function makeLoggerService() {
  const created = new Map<string, any>();
  const service = {
    create: vi.fn((name: string) => {
      const logger = {
        __name: name,
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      };
      created.set(name, logger);
      return logger as unknown as ILogger;
    }),
    child: vi.fn(),
  } as unknown as ILoggerModule & { create: ReturnType<typeof vi.fn> };
  return { service, created };
}

describe('@Logger reaches the configured LoggerModule', () => {
  it('logs through the resolved LoggerService, not into a null sink', () => {
    const { service, created } = makeLoggerService();

    class Service {
      @Logger('PaymentService')
      logger!: ILogger;

      pay() {
        this.logger.info({ amount: 10 }, 'charged');
      }
    }

    const container = new Container();
    container.register(LOGGER_SERVICE_TOKEN, { useValue: service });
    container.register(Service, { useClass: Service });

    container.resolve(Service).pay();

    expect(service.create).toHaveBeenCalledWith('PaymentService');
    const logger = created.get('PaymentService');
    expect(logger.info).toHaveBeenCalledWith({ amount: 10 }, 'charged');
  });

  it('names the logger after the class when the decorator is given no name', () => {
    const { service } = makeLoggerService();

    class InventoryService {
      @Logger()
      logger!: ILogger;
    }

    const container = new Container();
    container.register(LOGGER_SERVICE_TOKEN, { useValue: service });
    container.register(InventoryService, { useClass: InventoryService });

    void container.resolve(InventoryService).logger;

    expect(service.create).toHaveBeenCalledWith('InventoryService');
  });

  it('gives each instance its own logger', () => {
    const { service } = makeLoggerService();

    class Worker {
      @Logger('Worker')
      logger!: ILogger;
    }

    const container = new Container();
    container.register(LOGGER_SERVICE_TOKEN, { useValue: service });
    container.register(Worker, { useClass: Worker, scope: 'transient' as any });

    const a = container.resolve(Worker).logger;
    const b = container.resolve(Worker).logger;

    expect(a).not.toBe(b);
  });

  it('resolves once and caches per instance', () => {
    const { service } = makeLoggerService();

    class Service {
      @Logger('Cached')
      logger!: ILogger;
    }

    const container = new Container();
    container.register(LOGGER_SERVICE_TOKEN, { useValue: service });
    container.register(Service, { useClass: Service });

    const s = container.resolve(Service);
    void s.logger;
    void s.logger;
    void s.logger;

    expect(service.create).toHaveBeenCalledTimes(1);
  });
});

describe('@Logger without a configured LoggerModule', () => {
  it('falls back to a no-op logger instead of throwing', () => {
    class Service {
      @Logger('Orphan')
      logger!: ILogger;
    }

    const s = new Service();
    expect(() => s.logger.info({ a: 1 }, 'hi')).not.toThrow();
    for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      expect(typeof (s.logger as any)[m]).toBe('function');
    }
  });

  it('does not cache the fallback, so a container attached later still wins', () => {
    const { service } = makeLoggerService();

    class Service {
      @Logger('LateBound')
      logger!: ILogger;
    }

    // Constructor-time access happens before the container attaches its
    // back-reference; that must not poison the property forever.
    const s = new Service();
    void s.logger;

    const container = new Container();
    container.register(LOGGER_SERVICE_TOKEN, { useValue: service });
    Reflect.defineMetadata('titan:inject:container', container, s);

    void s.logger;

    expect(service.create).toHaveBeenCalledWith('LateBound');
  });

  it('still honours an explicitly assigned logger', () => {
    const custom = { info: vi.fn() } as unknown as ILogger;

    class Service {
      @Logger('Explicit')
      logger!: ILogger;
    }

    const s = new Service();
    s.logger = custom;
    expect(s.logger).toBe(custom);
  });
});
