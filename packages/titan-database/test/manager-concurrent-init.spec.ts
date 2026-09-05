/**
 * `DatabaseManager.init()` says "Make init idempotent - only initialize once"
 * and guards on `this.initialized`, which it assigns only after every
 * configured connection has been created and the global plugins applied. Two
 * concurrent calls both passed the guard and both built the pools; the second
 * `this.connections.set(name, info)` overwrote the first, and shutdown only
 * closes what the map holds — so the first pool's database connections were
 * never closed. Connections are a scarce server-side resource, and the comment
 * claiming idempotency is what makes this a defect rather than a caveat.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { DatabaseManager } from '../src/database.manager.js';

const createMockLogger = () => {
  const logger: any = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = vi.fn(() => logger);
  return logger;
};

describe('DatabaseManager - concurrent init()', () => {
  let manager: DatabaseManager | undefined;

  afterEach(async () => {
    await manager?.closeAll();
    manager = undefined;
    vi.clearAllMocks();
  });

  it('creates each connection once when init() is called twice concurrently', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      createMockLogger()
    );

    const created: string[] = [];
    const original = (manager as any).createConnection.bind(manager);
    vi.spyOn(manager as any, 'createConnection').mockImplementation(async (...args: any[]) => {
      created.push(args[0] as string);
      return original(...args);
    });

    await Promise.all([manager.init(), manager.init()]);

    // One pool per configured connection. Before the fix both calls built
    // their own, and the loser was dropped from the map with its sockets open.
    expect(created).toEqual(['default']);
    expect(manager.isConnected('default')).toBe(true);
  });

  it('is still a no-op when init() is called again after it finished', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      createMockLogger()
    );

    await manager.init();

    const spy = vi.spyOn(manager as any, 'createConnection');
    await manager.init();

    expect(spy).not.toHaveBeenCalled();
  });
});
