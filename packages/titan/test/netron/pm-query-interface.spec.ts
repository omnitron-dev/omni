/**
 * Integration test: PM worker-runtime service exposure and query_interface
 *
 * Reproduces the exact issue where worker-runtime exposes a service with
 * minimal metadata (only { name, version }) causing Definition.meta.methods
 * to be undefined on the client side after deserialization.
 *
 * Bug: interface.ts proxy handler accesses target.$def.meta.methods[prop]
 * but meta only has { name, version } — no methods/properties fields.
 * This causes "Cannot read properties of undefined (reading 'then')"
 * because the proxy intercepts 'then' access before the internal property check.
 */

import { describe, it, expect, afterEach } from 'vitest';
import 'reflect-metadata';
import { Netron } from '../../src/netron/netron.js';
import { METADATA_KEYS } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';

const SERVICE_ANNOTATION = METADATA_KEYS.SERVICE_ANNOTATION;

function getPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

describe('PM query_interface integration', () => {
  let server: Netron;
  let client: Netron;
  const basePort = getPort();
  const logger = createMockLogger();

  afterEach(async () => {
    try {
      await client?.stop();
    } catch {}
    try {
      await server?.stop();
    } catch {}
  });

  describe('BUG REPRODUCTION: minimal metadata causes meta.methods to be undefined', () => {
    it('should crash with "Cannot read properties of undefined" when service has only { name, version } metadata', async () => {
      const port = basePort;

      // Setup server exactly like worker-runtime.ts does
      server = new Netron(logger, { id: 'server' });
      server.registerTransportServer('websocket', {
        name: 'websocket',
        options: { host: '127.0.0.1', port },
      });

      // Create a ServiceWrapperClass with minimal metadata — exactly like worker-runtime.ts line 366-378
      class ServiceWrapperClass {}
      const serviceWrapper: any = {};
      serviceWrapper.__getProcessHealth = async () => ({
        status: 'healthy',
        checks: [],
        timestamp: Date.now(),
      });
      serviceWrapper.__shutdown = async () => {};

      Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
      const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
      Object.assign(wrapperInstance, serviceWrapper);

      // BUG: worker-runtime only sets { name, version } — missing methods & properties
      Reflect.defineMetadata(SERVICE_ANNOTATION, { name: 'BootstrapApp', version: '1.0.0' }, ServiceWrapperClass);

      await server.start();
      await server.peer.exposeService(wrapperInstance);

      // Verify the service was exposed with the incomplete metadata
      const stub = server.services.get('BootstrapApp@1.0.0');
      expect(stub).toBeDefined();
      // The definition's meta has no methods field — this is the root cause
      expect(stub!.definition.meta.methods).toBeUndefined();

      // Connect client
      client = new Netron(logger, { id: 'client' });
      await client.start();
      const remotePeer = await client.connect(`ws://127.0.0.1:${port}`);

      // Query the interface — this sends a query_interface task over the wire
      // The Interface proxy intercepts property access including 'then' (for Promise detection).
      // It tries target.$def.meta.methods['then'] but meta.methods is undefined → TypeError
      await expect(remotePeer.queryInterface('BootstrapApp@1.0.0')).rejects.toThrow(
        'Cannot read properties of undefined'
      );
    });
  });

  describe('FIX VERIFICATION: proper metadata with methods and properties', () => {
    it('should work when service is exposed with complete metadata including methods', async () => {
      const port = basePort + 1;

      server = new Netron(logger, { id: 'server-fixed' });
      server.registerTransportServer('websocket', {
        name: 'websocket',
        options: { host: '127.0.0.1', port },
      });

      // Create wrapper class with methods on prototype (like the real worker-runtime does)
      class ServiceWrapperClass {}
      const serviceWrapper: any = {};
      serviceWrapper.__getProcessHealth = async () => ({
        status: 'healthy',
        checks: [],
        timestamp: Date.now(),
      });
      serviceWrapper.__shutdown = async () => {};
      serviceWrapper.__getProcessMetrics = async () => ({
        uptime: 12345,
        memory: { heapUsed: 100 },
      });

      Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
      const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
      Object.assign(wrapperInstance, serviceWrapper);

      // FIX: Build methods map from all functions on the serviceWrapper
      const methods: Record<string, any> = {};
      for (const key of Object.keys(serviceWrapper)) {
        if (typeof serviceWrapper[key] === 'function') {
          methods[key] = { type: 'void', arguments: [] };
        }
      }

      Reflect.defineMetadata(
        SERVICE_ANNOTATION,
        {
          name: 'BootstrapApp',
          version: '1.0.0',
          methods,
          properties: {},
        },
        ServiceWrapperClass
      );

      await server.start();
      await server.peer.exposeService(wrapperInstance);

      // Verify the service was exposed with complete metadata
      const stub = server.services.get('BootstrapApp@1.0.0');
      expect(stub).toBeDefined();
      expect(stub!.definition.meta.methods).toBeDefined();
      expect(stub!.definition.meta.methods.__getProcessHealth).toBeDefined();
      expect(stub!.definition.meta.properties).toBeDefined();

      // Connect client
      client = new Netron(logger, { id: 'client-fixed' });
      await client.start();
      const remotePeer = await client.connect(`ws://127.0.0.1:${port}`);

      // Query the interface — should succeed now
      const iface = await remotePeer.queryInterface('BootstrapApp@1.0.0');

      expect(iface).toBeDefined();
      expect(iface!.$def).toBeDefined();
      expect(iface!.$def.meta).toBeDefined();
      expect(iface!.$def.meta.methods).toBeDefined();
      expect(iface!.$def.meta.methods.__getProcessHealth).toBeDefined();
      expect(iface!.$def.meta.properties).toBeDefined();

      // Call a method through the proxy — it goes through Netron RPC over WebSocket
      const health = await (iface as any).__getProcessHealth();
      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.checks).toEqual([]);
      expect(typeof health.timestamp).toBe('number');
    });

    it('should support calling multiple methods on the same interface', async () => {
      const port = basePort + 2;

      server = new Netron(logger, { id: 'server-multi' });
      server.registerTransportServer('websocket', {
        name: 'websocket',
        options: { host: '127.0.0.1', port },
      });

      class ServiceWrapperClass {}
      const serviceWrapper: any = {};
      serviceWrapper.__getProcessHealth = async () => ({
        status: 'healthy',
        checks: [],
        timestamp: Date.now(),
      });
      serviceWrapper.__getProcessMetrics = async () => ({
        uptime: process.uptime(),
        memory: { heapUsed: process.memoryUsage().heapUsed },
      });
      serviceWrapper.__shutdown = async () => {};

      Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
      const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
      Object.assign(wrapperInstance, serviceWrapper);

      const methods: Record<string, any> = {};
      for (const key of Object.keys(serviceWrapper)) {
        if (typeof serviceWrapper[key] === 'function') {
          methods[key] = { type: 'void', arguments: [] };
        }
      }

      Reflect.defineMetadata(
        SERVICE_ANNOTATION,
        { name: 'BootstrapApp', version: '1.0.0', methods, properties: {} },
        ServiceWrapperClass
      );

      await server.start();
      await server.peer.exposeService(wrapperInstance);

      client = new Netron(logger, { id: 'client-multi' });
      await client.start();
      const remotePeer = await client.connect(`ws://127.0.0.1:${port}`);

      const iface = await remotePeer.queryInterface('BootstrapApp@1.0.0');
      expect(iface).toBeDefined();

      // Call health
      const health = await (iface as any).__getProcessHealth();
      expect(health.status).toBe('healthy');

      // Call metrics
      const metrics = await (iface as any).__getProcessMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.uptime).toBe('number');
      expect(typeof metrics.memory.heapUsed).toBe('number');
    });
  });

  describe('Definition serialization over the wire', () => {
    it('should preserve meta.methods and meta.properties after MessagePack serialization/deserialization', async () => {
      const port = basePort + 3;

      server = new Netron(logger, { id: 'server-serial' });
      server.registerTransportServer('websocket', {
        name: 'websocket',
        options: { host: '127.0.0.1', port },
      });

      class ServiceWrapperClass {}
      const serviceWrapper: any = {};
      serviceWrapper.echo = async (msg: string) => msg;
      serviceWrapper.add = async (a: number, b: number) => a + b;

      Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
      const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
      Object.assign(wrapperInstance, serviceWrapper);

      Reflect.defineMetadata(
        SERVICE_ANNOTATION,
        {
          name: 'TestService',
          version: '1.0.0',
          methods: {
            echo: { type: 'string', arguments: [{ index: 0, type: 'string' }] },
            add: {
              type: 'number',
              arguments: [
                { index: 0, type: 'number' },
                { index: 1, type: 'number' },
              ],
            },
          },
          properties: {},
        },
        ServiceWrapperClass
      );

      await server.start();
      await server.peer.exposeService(wrapperInstance);

      client = new Netron(logger, { id: 'client-serial' });
      await client.start();
      const remotePeer = await client.connect(`ws://127.0.0.1:${port}`);

      const iface = await remotePeer.queryInterface('TestService@1.0.0');
      expect(iface).toBeDefined();

      // Verify metadata survived wire serialization
      const def = iface!.$def;
      expect(def.meta).toBeDefined();
      expect(def.meta.name).toBe('TestService');
      expect(def.meta.version).toBe('1.0.0');
      expect(def.meta.methods).toBeDefined();
      expect(def.meta.methods.echo).toBeDefined();
      expect(def.meta.methods.add).toBeDefined();
      expect(def.meta.properties).toBeDefined();

      // Verify actual RPC calls work
      const echoResult = await (iface as any).echo('hello world');
      expect(echoResult).toBe('hello world');

      const addResult = await (iface as any).add(3, 7);
      expect(addResult).toBe(10);
    });
  });
});
