/**
 * NetronClient Browser Tests
 * Basic unit tests for NetronClient and HttpNetronClient
 */

import { describe, it, expect } from 'vitest';
import { NetronClient, HttpNetronClient, BrowserLogger } from '../../src/netron/index.js';

describe('NetronClient', () => {
  describe('constructor', () => {
    it('should create NetronClient instance', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
    });

    it('should create NetronClient with custom logger', () => {
      const logger = new BrowserLogger({ test: true });
      const client = new NetronClient({
        url: 'ws://localhost:3000',
        logger,
      });

      expect(client).toBeDefined();
    });

    it('should create NetronClient with reconnect options', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 5,
      });

      expect(client).toBeDefined();
    });

    it('should create NetronClient with timeout', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
        timeout: 60000,
      });

      expect(client).toBeDefined();
    });

    it('should create NetronClient with custom binaryType', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
        binaryType: 'blob',
      });

      expect(client).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('getPeer', () => {
    it('should return null when not connected', () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      expect(client.getPeer()).toBeNull();
    });
  });

  describe('queryInterface', () => {
    it('should throw error when not connected', async () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      await expect(client.queryInterface('TestService')).rejects.toThrow(
        'Not connected. Call connect() first.'
      );
    });
  });

  describe('subscribe', () => {
    it('should throw error when not connected', async () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      await expect(client.subscribe('test.event', () => {})).rejects.toThrow(
        'Not connected. Call connect() first.'
      );
    });
  });

  describe('unsubscribe', () => {
    it('should throw error when not connected', async () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      await expect(client.unsubscribe('test.event', () => {})).rejects.toThrow(
        'Not connected. Call connect() first.'
      );
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected', async () => {
      const client = new NetronClient({
        url: 'ws://localhost:3000',
      });

      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });
});

describe('HttpNetronClient', () => {
  describe('constructor', () => {
    it('should create HttpNetronClient instance', () => {
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
      });

      expect(client).toBeDefined();
    });

    it('should create HttpNetronClient with custom logger', () => {
      const logger = new BrowserLogger({ test: true });
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
        logger,
      });

      expect(client).toBeDefined();
    });

    it('should create HttpNetronClient with timeout', () => {
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
        timeout: 60000,
      });

      expect(client).toBeDefined();
    });

    it('should create HttpNetronClient with custom headers', () => {
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
        headers: {
          'Authorization': 'Bearer token',
          'X-Custom': 'value',
        },
      });

      expect(client).toBeDefined();
    });
  });

  describe('queryInterface', () => {
    it('should return proxy object', async () => {
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
      });

      const service = await client.queryInterface('TestService');
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });
  });

  describe('getMetrics', () => {
    it('should return metrics object', () => {
      const client = new HttpNetronClient({
        baseUrl: 'http://localhost:3000',
      });

      const metrics = client.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.baseUrl).toBe('http://localhost:3000');
    });
  });
});

describe('BrowserLogger', () => {
  it('should create logger instance', () => {
    const logger = new BrowserLogger({ test: true });
    expect(logger).toBeDefined();
  });

  it('should have debug method', () => {
    const logger = new BrowserLogger();
    expect(typeof logger.debug).toBe('function');
    logger.debug('test message');
    logger.debug({ data: 'test' }, 'test message');
  });

  it('should have info method', () => {
    const logger = new BrowserLogger();
    expect(typeof logger.info).toBe('function');
    logger.info('test message');
    logger.info({ data: 'test' }, 'test message');
  });

  it('should have warn method', () => {
    const logger = new BrowserLogger();
    expect(typeof logger.warn).toBe('function');
    logger.warn('test message');
    logger.warn({ data: 'test' }, 'test message');
  });

  it('should have error method', () => {
    const logger = new BrowserLogger();
    expect(typeof logger.error).toBe('function');
    logger.error('test message');
    logger.error({ data: 'test' }, 'test message');
  });

  it('should create child logger', () => {
    const logger = new BrowserLogger({ parent: true });
    const child = logger.child({ child: true });

    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
    child.info('child message');
  });
});
