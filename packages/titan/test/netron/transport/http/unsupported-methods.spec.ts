/**
 * Tests for unsupported methods in HttpRemotePeer
 * Verifies that proper "Not Implemented" exceptions are thrown
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Netron } from '../../../../src/netron/netron.js';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { Service } from '../../../../src/decorators/core.js';
import { createMockLogger } from '../../test-utils.js';
import type { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { ErrorCode } from '../../../../src/errors/codes.js';
import { TitanError } from '../../../../src/errors/core.js';

// Test port management - worker-safe
const getWorkerSafePort = () => {
  const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
  const basePort = 9000 + (workerId - 1) * 1000;
  const offset = Math.floor(Math.random() * 900);
  return basePort + offset;
};

describe('HttpRemotePeer - Unsupported Methods', () => {
  let serverNetron: Netron;
  let clientNetron: Netron;
  let serverPort: number;
  let serverUrl: string;
  let peer: HttpRemotePeer;

  @Service('test@1.0.0')
  class TestService {
    hello(): string {
      return 'world';
    }
  }

  beforeAll(async () => {
    serverPort = getWorkerSafePort();
    serverUrl = `http://localhost:${serverPort}`;

    // Create server
    const serverLogger = createMockLogger();
    serverNetron = new Netron(serverLogger, { id: 'test-server' });
    serverNetron.registerTransport('http', () => new HttpTransport());
    serverNetron.registerTransportServer('http', {
      name: 'http',
      options: { host: 'localhost', port: serverPort },
    });
    await serverNetron.start();
    await serverNetron.peer.exposeService(new TestService());

    // Create client
    const clientLogger = createMockLogger();
    clientNetron = new Netron(clientLogger, { id: 'test-client' });
    clientNetron.registerTransport('http', () => new HttpTransport());

    // Connect to server
    peer = (await clientNetron.connect(serverUrl)) as HttpRemotePeer;
  });

  afterAll(async () => {
    if (peer) {
      await peer.close();
    }
    await clientNetron?.stop();
    await serverNetron?.stop();
  });

  describe('Property Access Methods', () => {
    it('should throw NOT_IMPLEMENTED for set() with descriptive message', async () => {
      await expect(peer.set('test@1.0.0', 'someProp', 'value')).rejects.toThrow(TitanError);

      try {
        await peer.set('test@1.0.0', 'someProp', 'value');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const titanError = error as TitanError;
        expect(titanError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(titanError.message).toContain('Property setters are not supported');
        expect(titanError.message).toContain('HTTP transport is stateless');
        expect(titanError.message).toContain('dedicated method');
      }
    });

    it('should throw NOT_IMPLEMENTED for get() with descriptive message', async () => {
      await expect(peer.get('test@1.0.0', 'someProp')).rejects.toThrow(TitanError);

      try {
        await peer.get('test@1.0.0', 'someProp');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const titanError = error as TitanError;
        expect(titanError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(titanError.message).toContain('Property getters are not supported');
        expect(titanError.message).toContain('HTTP transport is stateless');
        expect(titanError.message).toContain('dedicated method');
      }
    });
  });

  describe('Event Subscription Methods', () => {
    it('should throw NOT_IMPLEMENTED for subscribe() with descriptive message', async () => {
      const handler = async () => {};

      await expect(peer.subscribe('some.event', handler)).rejects.toThrow(TitanError);

      try {
        await peer.subscribe('some.event', handler);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const titanError = error as TitanError;
        expect(titanError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(titanError.message).toContain('Event subscriptions are not supported');
        expect(titanError.message).toContain('request-response based');
        expect(titanError.message).toContain('WebSocket transport');
      }
    });

    it('should throw NOT_IMPLEMENTED for unsubscribe() with descriptive message', async () => {
      const handler = async () => {};

      await expect(peer.unsubscribe('some.event', handler)).rejects.toThrow(TitanError);

      try {
        await peer.unsubscribe('some.event', handler);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const titanError = error as TitanError;
        expect(titanError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(titanError.message).toContain('Event unsubscription is not supported');
        expect(titanError.message).toContain('request-response based');
        expect(titanError.message).toContain('WebSocket transport');
      }
    });
  });

  describe('Service Management Methods', () => {
    it('should throw NOT_IMPLEMENTED for unexposeService() with descriptive message', async () => {
      await expect(peer.unexposeService('test@1.0.0')).rejects.toThrow(TitanError);

      try {
        await peer.unexposeService('test@1.0.0');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const titanError = error as TitanError;
        expect(titanError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(titanError.message).toContain('Service unexposing is not supported');
        expect(titanError.message).toContain('HTTP transport clients are consumers only');
        expect(titanError.message).toContain('server side');
      }
    });
  });

  describe('Supported Methods Still Work', () => {
    it('should successfully call() supported methods', async () => {
      const service = await peer.queryInterface<{ hello: () => Promise<string> }>('test@1.0.0');
      const result = await service.hello();
      expect(result).toBe('world');
    });
  });
});
