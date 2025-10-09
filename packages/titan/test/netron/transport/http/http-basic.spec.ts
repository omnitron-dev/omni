/**
 * Basic tests for HTTP Transport
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';

describe('HTTP Transport Basic', () => {
  let transport: HttpTransport;
  let mockFetch: any;

  beforeEach(() => {
    transport = new HttpTransport();

    // Mock global fetch for connection tests
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Clean up mocks
    delete (global as any).fetch;
  });

  describe('Transport Capabilities', () => {
    it('should have correct capabilities', () => {
      expect(transport.capabilities.streaming).toBe(true);
      expect(transport.capabilities.bidirectional).toBe(false);
      expect(transport.capabilities.binary).toBe(false); // HTTP is a text protocol
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
      // Mock successful discovery response
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: '2.0',
          services: {},
          contracts: {}
        })
      } as Response);

      const connection = await transport.connect('http://localhost:3000');
      expect(connection).toBeDefined();
      expect(connection).toBeInstanceOf(HttpConnection);

      // Verify fetch was called for discovery
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/netron/discovery',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json'
          })
        })
      );
    });

    it('should throw error for unreachable server', async () => {
      // Mock connection refused error
      mockFetch.mockRejectedValue({
        message: 'fetch failed',
        cause: { code: 'ECONNREFUSED' }
      });

      await expect(transport.connect('http://localhost:9999'))
        .rejects.toThrow(/Failed to connect/);
    });
  });

  describe('Server Creation', () => {
    it('should create server', async () => {
      const server = await transport.createServer({ port: 3456 });
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(HttpServer);
    });
  });
});
