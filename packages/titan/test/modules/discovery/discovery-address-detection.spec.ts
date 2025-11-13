/**
 * Discovery Service Address Detection Test
 * Tests the automatic network address detection functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Redis from 'ioredis-mock';
import { DiscoveryService } from '../../../src/modules/discovery/discovery.service.js';
import { createMockLogger } from '../../netron/test-utils.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';

describe('Discovery Service Address Detection', () => {
  let redis: Redis;
  let logger: ILogger;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create mock Redis and logger
    redis = new Redis();
    logger = createMockLogger();
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;

    if (redis) {
      await redis.quit();
    }
  });

  describe('Environment Variable Detection', () => {
    it('should use HOST environment variable when set', () => {
      process.env.HOST = 'api.example.com';
      process.env.PORT = '8080';

      const discovery = new DiscoveryService(redis, logger);

      // Access the private address property via reflection
      const address = (discovery as any).address;
      expect(address).toBe('api.example.com:8080');
    });

    it('should use TITAN_HOST environment variable when set', () => {
      process.env.TITAN_HOST = 'titan.example.com';
      process.env.TITAN_PORT = '9000';

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toBe('titan.example.com:9000');
    });

    it('should prefer HOST over TITAN_HOST', () => {
      process.env.HOST = 'primary.example.com';
      process.env.TITAN_HOST = 'secondary.example.com';
      process.env.PORT = '8080';

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toBe('primary.example.com:8080');
    });

    it('should use PORT environment variable', () => {
      process.env.HOST = 'example.com';
      process.env.PORT = '5000';

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toContain(':5000');
    });

    it('should prefer TITAN_PORT over PORT when TITAN_HOST is used', () => {
      process.env.TITAN_HOST = 'titan.example.com';
      process.env.TITAN_PORT = '9000';
      process.env.PORT = '8080';

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toBe('titan.example.com:9000');
    });

    it('should default to port 3000 when no port is specified', () => {
      process.env.HOST = 'example.com';
      delete process.env.PORT;
      delete process.env.TITAN_PORT;

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toBe('example.com:3000');
    });
  });

  describe('Network Interface Detection', () => {
    it('should detect network address when no environment variables are set', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      delete process.env.PORT;

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toBeTruthy();
      expect(typeof address).toBe('string');
      expect(address).toMatch(/:\d+$/); // Should end with :port
    });

    it('should include a port number in detected address', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      process.env.PORT = '4000';

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toContain(':4000');
    });

    it('should use default port 3000 when detecting from interfaces', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      delete process.env.PORT;
      delete process.env.TITAN_PORT;

      const discovery = new DiscoveryService(redis, logger);

      const address = (discovery as any).address;
      expect(address).toMatch(/:3000$/);
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to localhost when detection fails', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      delete process.env.PORT;

      // Mock os.networkInterfaces to throw an error
      const os = require('os');
      const originalNetworkInterfaces = os.networkInterfaces;
      os.networkInterfaces = () => {
        throw new Error('Network interfaces unavailable');
      };

      try {
        const discovery = new DiscoveryService(redis, logger);
        const address = (discovery as any).address;

        expect(address).toBe('localhost:3000');
      } finally {
        // Restore original function
        os.networkInterfaces = originalNetworkInterfaces;
      }
    });

    it('should log warning when network detection fails', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;

      const warnSpy = jest.spyOn(logger, 'warn');

      // Mock os.networkInterfaces to throw an error
      const os = require('os');
      const originalNetworkInterfaces = os.networkInterfaces;
      os.networkInterfaces = () => {
        throw new Error('Network detection failed');
      };

      try {
        new DiscoveryService(redis, logger);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining('Network detection failed'),
          }),
          expect.any(String)
        );
      } finally {
        os.networkInterfaces = originalNetworkInterfaces;
      }
    });
  });

  describe('IPv4 Address Selection', () => {
    it('should prefer non-internal IPv4 addresses', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      process.env.PORT = '3000';

      // Mock os.networkInterfaces to return controlled data
      const os = require('os');
      const originalNetworkInterfaces = os.networkInterfaces;
      os.networkInterfaces = () => ({
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true },
        ],
        eth0: [
          { address: '192.168.1.100', family: 'IPv4', internal: false },
        ],
      });

      try {
        const discovery = new DiscoveryService(redis, logger);
        const address = (discovery as any).address;

        expect(address).toBe('192.168.1.100:3000');
      } finally {
        os.networkInterfaces = originalNetworkInterfaces;
      }
    });

    it('should exclude IPv6 addresses', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      process.env.PORT = '3000';

      const os = require('os');
      const originalNetworkInterfaces = os.networkInterfaces;
      os.networkInterfaces = () => ({
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true },
        ],
        eth0: [
          { address: '::1', family: 'IPv6', internal: true },
          { address: '192.168.1.100', family: 'IPv4', internal: false },
        ],
      });

      try {
        const discovery = new DiscoveryService(redis, logger);
        const address = (discovery as any).address;

        // Should use IPv4, not IPv6
        expect(address).toBe('192.168.1.100:3000');
        expect(address).not.toContain('::');
      } finally {
        os.networkInterfaces = originalNetworkInterfaces;
      }
    });

    it('should prefer non-loopback internal addresses over loopback', () => {
      delete process.env.HOST;
      delete process.env.TITAN_HOST;
      process.env.PORT = '3000';

      const os = require('os');
      const originalNetworkInterfaces = os.networkInterfaces;
      os.networkInterfaces = () => ({
        lo: [
          { address: '127.0.0.1', family: 'IPv4', internal: true },
        ],
        veth0: [
          { address: '172.17.0.2', family: 'IPv4', internal: true },
        ],
      });

      try {
        const discovery = new DiscoveryService(redis, logger);
        const address = (discovery as any).address;

        expect(address).toBe('172.17.0.2:3000');
      } finally {
        os.networkInterfaces = originalNetworkInterfaces;
      }
    });
  });

  describe('Address Format Validation', () => {
    it('should return address in host:port format', () => {
      process.env.HOST = 'example.com';
      process.env.PORT = '8080';

      const discovery = new DiscoveryService(redis, logger);
      const address = (discovery as any).address;

      expect(address).toMatch(/^[\w\-.]+:\d+$/);
    });

    it('should handle numeric IP addresses', () => {
      process.env.HOST = '192.168.1.100';
      process.env.PORT = '8080';

      const discovery = new DiscoveryService(redis, logger);
      const address = (discovery as any).address;

      expect(address).toBe('192.168.1.100:8080');
    });

    it('should handle domain names', () => {
      process.env.HOST = 'api.mydomain.com';
      process.env.PORT = '443';

      const discovery = new DiscoveryService(redis, logger);
      const address = (discovery as any).address;

      expect(address).toBe('api.mydomain.com:443');
    });
  });
});
