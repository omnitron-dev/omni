/**
 * Unit tests for NetronClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetronClient, createClient } from '../../src/client/index.js';
import type { NetronClientOptions } from '../../src/types/index.js';

describe('NetronClient', () => {
  let client: NetronClient;

  const defaultOptions: NetronClientOptions = {
    url: 'http://localhost:3000',
    transport: 'http',
    timeout: 30000,
  };

  beforeEach(() => {
    client = createClient(defaultOptions);
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('constructor', () => {
    it('should create an HTTP client by default', () => {
      expect(client).toBeInstanceOf(NetronClient);
      expect(client.getTransportType()).toBe('http');
    });

    it('should create a WebSocket client when specified', () => {
      const wsClient = createClient({
        url: 'http://localhost:3000',
        transport: 'websocket',
      });
      expect(wsClient.getTransportType()).toBe('websocket');
    });

    it('should throw error for invalid URL', () => {
      expect(() => {
        createClient({
          url: 'invalid-url',
        });
      }).toThrow('Invalid URL');
    });

    it('should normalize URL by removing trailing slash', () => {
      const client = createClient({
        url: 'http://localhost:3000/',
      });
      expect(client.getUrl()).toBe('http://localhost:3000');
    });
  });

  describe('connection', () => {
    it('should connect successfully', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await client.connect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should report correct connection state', async () => {
      expect(client.getState()).toBe('disconnected');
      await client.connect();
      expect(client.getState()).toBe('connected');
    });
  });

  describe('service proxy', () => {
    it('should create a service proxy', () => {
      interface TestService {
        echo(message: string): Promise<string>;
      }

      const service = client.service<TestService>('test');
      expect(typeof service.echo).toBe('function');
    });
  });

  describe('metrics', () => {
    it('should return connection metrics', () => {
      const metrics = client.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.transport).toBe('http');
      expect(metrics.url).toBe('http://localhost:3000');
      expect(metrics.requestsSent).toBe(0);
    });
  });
});
