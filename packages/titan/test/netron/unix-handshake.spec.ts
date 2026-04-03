/**
 * Integration test: Unix socket transport handshake
 *
 * Verifies that Unix socket connections complete their handshake without:
 * - Connection timeouts (connect event missed due to synchronous construction)
 * - "Received non-binary message" warnings (peer.init() before handshake completes)
 * - Hanging promises from BinaryTransportAdapter.send signature mismatch
 */

import { describe, it, expect, afterEach } from 'vitest';
import 'reflect-metadata';
import { Netron } from '../../src/netron/netron.js';
import { METADATA_KEYS } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const SERVICE_ANNOTATION = METADATA_KEYS.SERVICE_ANNOTATION;

describe('Unix socket transport handshake', () => {
  let server: Netron;
  let client: Netron;
  let socketPath: string;

  afterEach(async () => {
    try {
      await client?.stop();
    } catch {}
    try {
      await server?.stop();
    } catch {}
    try {
      await fs.unlink(socketPath);
    } catch {}
  });

  async function createSocketPath(): Promise<string> {
    const tmpDir = path.join(os.tmpdir(), 'titan-test');
    await fs.mkdir(tmpDir, { recursive: true });
    return path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  }

  function createServiceWrapper(): { instance: any; ServiceClass: any } {
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

    return { instance: wrapperInstance, ServiceClass: ServiceWrapperClass };
  }

  it('should complete handshake on Unix socket without timeout', async () => {
    socketPath = await createSocketPath();
    const logger = createMockLogger();

    // Setup server on Unix socket
    server = new Netron(logger, { id: 'unix-server' });
    server.registerTransportServer('unix', {
      name: 'unix',
      options: { path: socketPath, force: true },
    });

    const { instance } = createServiceWrapper();
    await server.start();
    await server.peer.exposeService(instance);

    // Connect client via Unix socket
    client = new Netron(logger, { id: 'unix-client' });
    await client.start();

    const startTime = Date.now();
    const remotePeer = await client.connect(`unix://${socketPath}`, false);
    const connectDuration = Date.now() - startTime;

    // Connection should complete well under 5s (the CONNECT_TIMEOUT)
    // Typically under 100ms for local Unix sockets
    expect(connectDuration).toBeLessThan(2000);

    // Verify the peer is properly connected
    expect(remotePeer).toBeDefined();
    expect(remotePeer.id).toBe('unix-server');

    // Query the service and call a method
    const iface = await remotePeer.queryInterface('BootstrapApp@1.0.0');
    expect(iface).toBeDefined();
    expect(iface!.$def.meta.methods).toBeDefined();
    expect(iface!.$def.meta.methods.__getProcessHealth).toBeDefined();

    const health = await (iface as any).__getProcessHealth();
    expect(health.status).toBe('healthy');

    // Verify NO "non-binary message" warnings were logged
    const warnCalls = (logger.warn as any).mock?.calls || [];
    const nonBinaryWarnings = warnCalls.filter(
      (call: any[]) => typeof call[1] === 'string' && call[1].includes('non-binary')
    );
    expect(nonBinaryWarnings).toHaveLength(0);
  }, 15000);

  it('should handle multiple concurrent Unix socket connections', async () => {
    socketPath = await createSocketPath();
    const logger = createMockLogger();

    server = new Netron(logger, { id: 'unix-multi-server' });
    server.registerTransportServer('unix', {
      name: 'unix',
      options: { path: socketPath, force: true },
    });

    const { instance } = createServiceWrapper();
    await server.start();
    await server.peer.exposeService(instance);

    // Connect two clients concurrently
    const client1 = new Netron(logger, { id: 'unix-client-1' });
    const client2 = new Netron(logger, { id: 'unix-client-2' });
    await Promise.all([client1.start(), client2.start()]);

    const [peer1, peer2] = await Promise.all([
      client1.connect(`unix://${socketPath}`, false),
      client2.connect(`unix://${socketPath}`, false),
    ]);

    expect(peer1).toBeDefined();
    expect(peer2).toBeDefined();

    // Both clients should be able to query and call methods
    const [iface1, iface2] = await Promise.all([
      peer1.queryInterface('BootstrapApp@1.0.0'),
      peer2.queryInterface('BootstrapApp@1.0.0'),
    ]);

    const [health1, health2] = await Promise.all([
      (iface1 as any).__getProcessHealth(),
      (iface2 as any).__getProcessHealth(),
    ]);

    expect(health1.status).toBe('healthy');
    expect(health2.status).toBe('healthy');

    await Promise.all([client1.stop(), client2.stop()]);
    client = null as any; // prevent afterEach from double-stopping
  }, 15000);

  it('should handle rapid connect-query-disconnect cycles', async () => {
    socketPath = await createSocketPath();
    const logger = createMockLogger();

    server = new Netron(logger, { id: 'unix-cycle-server' });
    server.registerTransportServer('unix', {
      name: 'unix',
      options: { path: socketPath, force: true },
    });

    const { instance } = createServiceWrapper();
    await server.start();
    await server.peer.exposeService(instance);

    // Run 3 rapid connect-query-disconnect cycles
    for (let i = 0; i < 3; i++) {
      const tempClient = new Netron(logger, { id: `unix-cycle-client-${i}` });
      await tempClient.start();

      const peer = await tempClient.connect(`unix://${socketPath}`, false);
      const iface = await peer.queryInterface('BootstrapApp@1.0.0');
      const health = await (iface as any).__getProcessHealth();
      expect(health.status).toBe('healthy');

      await tempClient.stop();
    }

    client = null as any;
  }, 30000);
});
