import { describe, it, expect } from 'vitest';
import { defineApp } from '../../src/config/define-app.js';
import type { IAppDefinition } from '../../src/config/types.js';

function minimalApp(overrides?: Partial<IAppDefinition>): IAppDefinition {
  return {
    name: 'test',
    version: '1.0.0',
    module: class TestModule {},
    transports: {},
    ...overrides,
  };
}

describe('defineApp', () => {
  it('returns definition with shutdown defaults', () => {
    const result = defineApp(minimalApp());
    expect(result.shutdown).toEqual({
      timeout: 10_000,
      priority: 0,
      drainConnections: true,
    });
  });

  it('returns definition with scaling defaults', () => {
    const result = defineApp(minimalApp());
    expect(result.scaling).toEqual({ instances: 1 });
  });

  it('preserves user shutdown overrides', () => {
    const result = defineApp(minimalApp({ shutdown: { timeout: 30_000, priority: 5 } }));
    expect(result.shutdown!.timeout).toBe(30_000);
    expect(result.shutdown!.priority).toBe(5);
    expect(result.shutdown!.drainConnections).toBe(true); // default
  });

  it('preserves user scaling overrides', () => {
    const result = defineApp(minimalApp({ scaling: { instances: 4, maxInstances: 8 } }));
    expect(result.scaling!.instances).toBe(4);
    expect(result.scaling!.maxInstances).toBe(8);
  });

  it('applies HTTP transport defaults', () => {
    const result = defineApp(
      minimalApp({
        transports: { http: { port: 3001 } },
      })
    );
    expect(result.transports.http).toEqual({
      port: 3001,
      host: '0.0.0.0',
      cors: true,
      requestTimeout: 120_000,
      keepAliveTimeout: 65_000,
      headersTimeout: 60_000,
    });
  });

  it('preserves user HTTP transport overrides', () => {
    const result = defineApp(
      minimalApp({
        transports: {
          http: { port: 8080, host: '127.0.0.1', cors: false, requestTimeout: 5_000 },
        },
      })
    );
    expect(result.transports.http!.port).toBe(8080);
    expect(result.transports.http!.host).toBe('127.0.0.1');
    expect(result.transports.http!.cors).toBe(false);
    expect(result.transports.http!.requestTimeout).toBe(5_000);
  });

  it('applies WebSocket transport defaults', () => {
    const result = defineApp(
      minimalApp({
        transports: { websocket: { port: 3006 } },
      })
    );
    expect(result.transports.websocket).toEqual({
      port: 3006,
      host: '0.0.0.0',
      path: '/ws',
    });
  });

  it('preserves user WebSocket transport overrides', () => {
    const result = defineApp(
      minimalApp({
        transports: { websocket: { port: 3006, path: '/live', host: 'localhost' } },
      })
    );
    expect(result.transports.websocket!.path).toBe('/live');
    expect(result.transports.websocket!.host).toBe('localhost');
  });

  it('handles dual transports', () => {
    const result = defineApp(
      minimalApp({
        transports: {
          http: { port: 3005 },
          websocket: { port: 3006 },
        },
      })
    );
    expect(result.transports.http).toBeDefined();
    expect(result.transports.websocket).toBeDefined();
  });

  it('preserves name, version, module', () => {
    class MyModule {}
    const result = defineApp(minimalApp({ name: 'myapp', version: '2.0.0', module: MyModule }));
    expect(result.name).toBe('myapp');
    expect(result.version).toBe('2.0.0');
    expect(result.module).toBe(MyModule);
  });

  it('preserves hooks', () => {
    const beforeCreate = async () => {};
    const result = defineApp(minimalApp({ hooks: { beforeCreate } }));
    expect(result.hooks!.beforeCreate).toBe(beforeCreate);
  });

  it('preserves auth config', () => {
    const rls = () => ({});
    const result = defineApp(
      minimalApp({
        auth: { jwt: { enabled: true }, rls },
      })
    );
    expect(result.auth!.jwt!.enabled).toBe(true);
    expect(result.auth!.rls).toBe(rls);
  });

  it('preserves env', () => {
    const result = defineApp(minimalApp({ env: { FOO: 'bar' } }));
    expect(result.env).toEqual({ FOO: 'bar' });
  });
});
