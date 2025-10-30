/**
 * Bun-specific tests for Nexus Container
 */

import { expect, test, describe } from 'bun:test';
import { Container, createToken, Scope, isBun, getRuntimeInfo, Runtime } from '../../../src/nexus/index.js';

describe('Nexus Container in Bun', () => {
  test('should detect Bun runtime', () => {
    const info = getRuntimeInfo();

    expect(info.runtime).toBe(Runtime.Bun);
    expect(info.isServer).toBe(true);
    expect(info.isBrowser).toBe(false);
    expect(info.hasESM).toBe(true);
    expect(isBun()).toBe(true);
  });

  test('should create and use container in Bun', () => {
    const container = new Container();
    const token = createToken<string>('BunTest');

    container.register(token, { useValue: 'Hello from Bun!' });

    const result = container.resolve(token);
    expect(result).toBe('Hello from Bun!');
  });

  test('should handle async operations in Bun', async () => {
    const container = new Container();
    const token = createToken<{ data: string }>('AsyncBun');

    container.register(token, { async: true, useFactory: async () => {
        // Use Bun's sleep if available, otherwise setTimeout
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: 'async-bun-data' };
      },
    });

    const result = await container.resolveAsync(token);
    expect(result.data).toBe('async-bun-data');
  });

  test("should work with Bun's native features", () => {
    const container = new Container();
    const fileToken = createToken<string>('FileContent');

    // Example of using Bun-specific API
    container.register(fileToken, {
      useFactory: () =>
        // This would use Bun.file() in real scenario
        'Bun file content',
    });

    const content = container.resolve(fileToken);
    expect(content).toBe('Bun file content');
  });

  test('should handle dependency injection in Bun', () => {
    const container = new Container();

    class Database {
      name = 'BunDB';
    }

    class Service {
      constructor(public db: Database) {}
    }

    const dbToken = createToken<Database>('Database');
    const serviceToken = createToken<Service>('Service');

    container.register(dbToken, { useClass: Database });
    container.register(serviceToken, {
      useClass: Service,
      inject: [dbToken],
    });

    const service = container.resolve(serviceToken);
    expect(service.db).toBeInstanceOf(Database);
    expect(service.db.name).toBe('BunDB');
  });

  test('should manage lifecycle in Bun', () => {
    const container = new Container();
    let instanceCount = 0;

    class SingletonService {
      id = ++instanceCount;
    }

    const token = createToken<SingletonService>('Singleton');
    container.register(token, {
      useClass: SingletonService,
      scope: Scope.Singleton,
    });

    const instance1 = container.resolve(token);
    const instance2 = container.resolve(token);

    expect(instance1).toBe(instance2);
    expect(instanceCount).toBe(1);
  });

  test('should dispose resources in Bun', async () => {
    const container = new Container();
    let disposed = false;

    class DisposableService {
      async dispose() {
        disposed = true;
      }
    }

    const token = createToken<DisposableService>('Disposable');
    container.register(token, {
      useClass: DisposableService,
      scope: Scope.Singleton,
    });

    container.resolve(token);
    await container.dispose();

    expect(disposed).toBe(true);
  });

  test('should support ESM imports in Bun', () => {
    // Bun has native ESM support
    const info = getRuntimeInfo();
    expect(info.hasESM).toBe(true);

    // Test that we can use ESM features
    const container = new Container();
    expect(container).toBeDefined();
  });
});
