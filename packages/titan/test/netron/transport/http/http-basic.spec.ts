/**
 * Basic tests for HTTP Transport
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HttpTransport } from '../../../../src/netron/transport/http/index.js';
import { HttpServer } from '../../../../src/netron/transport/http/http-server.js';
import { HttpClientConnection } from '../../../../src/netron/transport/http/http-client.js';

describe('HTTP Transport Basic', () => {
  let transport: HttpTransport;

  beforeEach(() => {
    transport = new HttpTransport();
  });

  describe('Transport Capabilities', () => {
    it('should have correct capabilities', () => {
      expect(transport.capabilities.streaming).toBe(true);
      expect(transport.capabilities.bidirectional).toBe(false);
      expect(transport.capabilities.binary).toBe(true);
      expect(transport.capabilities.server).toBe(true);
    });

    it('should have correct name', () => {
      expect(transport.name).toBe('http');
    });
  });

  describe('Address Validation', () => {
    it('should validate HTTP addresses', () => {
      expect(transport.isValidAddress('http://localhost:3000')).toBe(true);
      expect(transport.isValidAddress('https://example.com')).toBe(true);
      expect(transport.isValidAddress('ws://localhost:3000')).toBe(false);
      expect(transport.isValidAddress('tcp://localhost:3000')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });
  });

  describe('Connection Creation', () => {
    it('should create client connection', async () => {
      const connection = await transport.connect('http://localhost:3000');
      expect(connection).toBeDefined();
      expect(connection).toBeInstanceOf(HttpClientConnection);
    });
  });

  describe('Server Creation', () => {
    it('should create server', async () => {
      const server = await transport.createServer({ port: 3456 });
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(HttpServer);

      // Clean up - don't actually start the server for this test
    });
  });
});