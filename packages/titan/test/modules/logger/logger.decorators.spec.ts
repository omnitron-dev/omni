/**
 * Tests for Logger Decorators
 *
 * Tests for @Logger property decorator (logger.decorators.ts) and
 * @Log / @Monitor method decorators (decorators/utility.ts).
 *
 * Current behavior:
 * - @Logger injects a null logger fallback unless explicitly set
 * - @Log/@Monitor look up instance logger via getInstanceLogger() (logger/_logger/log)
 *   and silently no-op when none is found
 */

import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Logger, Log, Monitor } from '../../../src/modules/logger/logger.decorators.js';
import { createNullLogger } from '../../../src/modules/logger/logger.types.js';

interface MockLogger {
  trace: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

function makeMockLogger(): MockLogger {
  const m: MockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  m.child.mockReturnValue(m);
  return m;
}

describe('@Logger property decorator', () => {
  it('returns a null logger by default with full ILogger surface', () => {
    class Service {
      @Logger('Service')
      logger!: any;
    }
    const s = new Service();
    expect(s.logger).toBeDefined();
    for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      expect(typeof s.logger[m]).toBe('function');
    }
    // Null logger should be a no-op
    expect(() => s.logger.info({ foo: 'bar' }, 'hello')).not.toThrow();
  });

  it('caches the logger instance per object', () => {
    class Service {
      @Logger()
      logger!: any;
    }
    const s = new Service();
    expect(s.logger).toBe(s.logger);
  });

  it('produces independent loggers per instance', () => {
    class Service {
      @Logger()
      logger!: any;
    }
    const a = new Service();
    const b = new Service();
    expect(a.logger).not.toBe(b.logger);
  });

  it('allows overriding the logger via assignment', () => {
    class Service {
      @Logger()
      logger!: any;
    }
    const s = new Service();
    const custom = makeMockLogger();
    s.logger = custom;
    expect(s.logger).toBe(custom);
  });

  it('records reflect metadata for DI introspection', () => {
    class Service {
      @Logger('SvcLogger')
      logger!: any;
    }
    const md = Reflect.getMetadata('logger', Service.prototype, 'logger');
    expect(md).toBe(true);
  });
});

describe('createNullLogger', () => {
  it('returns a logger whose methods are no-ops', () => {
    const log = createNullLogger();
    expect(() => {
      log.trace({}, 'trace');
      log.debug({}, 'debug');
      log.info({}, 'info');
      log.warn({}, 'warn');
      log.error({}, 'error');
      log.fatal({}, 'fatal');
    }).not.toThrow();
  });
});

describe('@Log method decorator', () => {
  it('no-ops when no instance logger is present', async () => {
    class Service {
      @Log()
      async greet(name: string) {
        return `hi ${name}`;
      }
    }
    const s = new Service();
    await expect(s.greet('a')).resolves.toBe('hi a');
  });

  it('logs entry and exit when instance logger is present', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Log({ level: 'debug' })
      async work(x: number) {
        return x + 1;
      }
    }

    const s = new Service();
    const result = await s.work(41);

    expect(result).toBe(42);
    expect(logger.debug).toHaveBeenCalledTimes(2);
    const [enterArgs] = logger.debug.mock.calls[0]!;
    const [exitArgs] = logger.debug.mock.calls[1]!;
    expect((enterArgs as any).method).toBe('Service.work');
    expect((exitArgs as any).method).toBe('Service.work');
  });

  it('captures args and result when requested', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Log({ includeArgs: true, includeResult: true })
      async sum(a: number, b: number) {
        return a + b;
      }
    }

    await new Service().sum(2, 3);
    const exitCall = logger.info.mock.calls[1]![0] as Record<string, unknown>;
    expect(exitCall.args).toEqual([2, 3]);
    expect(exitCall.result).toBe(5);
  });

  it('logs errors at error level and rethrows', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Log()
      async boom() {
        throw new Error('nope');
      }
    }

    await expect(new Service().boom()).rejects.toThrow('nope');
    expect(logger.error).toHaveBeenCalledOnce();
    const [data, msg] = logger.error.mock.calls[0]!;
    expect((data as any).method).toBe('Service.boom');
    expect((data as any).err).toBeInstanceOf(Error);
    expect(msg).toContain('Error in Service.boom');
  });

  it('attaches a custom message when provided', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Log({ message: 'custom note' })
      async ping() {
        return 'pong';
      }
    }

    await new Service().ping();
    const enter = logger.info.mock.calls[0]![0] as Record<string, unknown>;
    expect(enter.customMessage).toBe('custom note');
  });
});

describe('@Monitor method decorator', () => {
  it('no-ops when no instance logger is present', async () => {
    class Service {
      @Monitor()
      async ping() {
        return 'pong';
      }
    }
    await expect(new Service().ping()).resolves.toBe('pong');
  });

  it('records duration and success metadata via debug', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Monitor({ name: 'svc.add' })
      async add(a: number, b: number) {
        return a + b;
      }
    }

    await new Service().add(1, 2);
    expect(logger.debug).toHaveBeenCalledOnce();
    const data = logger.debug.mock.calls[0]![0] as Record<string, unknown>;
    expect(data.method).toBe('svc.add');
    expect(typeof data.durationMs).toBe('number');
    expect(data.success).toBe(true);
  });

  it('records error metadata and rethrows on failure', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Monitor()
      async crash() {
        throw new Error('boom');
      }
    }

    await expect(new Service().crash()).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalledOnce();
    const data = logger.error.mock.calls[0]![0] as Record<string, unknown>;
    expect(data.success).toBe(false);
    expect(data.err).toBeInstanceOf(Error);
    expect(typeof data.durationMs).toBe('number');
  });

  it('skips logging when sampleRate is 0', async () => {
    const logger = makeMockLogger();

    class Service {
      logger = logger;

      @Monitor({ sampleRate: 0 })
      async work() {
        return 1;
      }
    }

    await new Service().work();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
