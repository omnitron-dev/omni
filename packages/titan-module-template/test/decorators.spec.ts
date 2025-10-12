/**
 * Tests for Decorators
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  Cached,
  Validate,
  ValidateReturn,
  Schemas,
  Timed,
  Timeout,
  Throttle,
  Debounce,
} from '../src/decorators/index.js';
import { delay } from '../src/utils.js';

describe('Decorators', () => {
  describe('@Cached', () => {
    class TestService {
      cache = {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
      };

      callCount = 0;

      @Cached({ ttl: 60 })
      async getValue(key: string): Promise<string> {
        this.callCount++;
        return `value-${key}`;
      }

      @Cached({ cacheNull: true })
      async getNullable(key: string): Promise<string | null> {
        this.callCount++;
        return key === 'null' ? null : `value-${key}`;
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should cache method results', async () => {
      service.cache.get.mockResolvedValue(null); // First call - cache miss

      const result1 = await service.getValue('test');
      expect(result1).toBe('value-test');
      expect(service.callCount).toBe(1);
      expect(service.cache.set).toHaveBeenCalled();

      // Second call - should use cache
      service.cache.get.mockResolvedValue('cached-value');
      const result2 = await service.getValue('test');
      expect(result2).toBe('cached-value');
      expect(service.callCount).toBe(1); // Not incremented
    });

    it('should cache null when cacheNull is true', async () => {
      service.cache.get.mockResolvedValue(null);

      const result = await service.getNullable('null');
      expect(result).toBeNull();
      expect(service.cache.set).toHaveBeenCalled();
    });
  });

  describe('@Validate', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().positive(),
    });

    class TestService {
      logger = {
        error: jest.fn(),
      };

      @Validate(schema)
      async createUser(data: any): Promise<any> {
        return data;
      }

      @Validate(schema, { throwOnError: false })
      async createUserSafe(data: any): Promise<any> {
        return data;
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should validate method parameters', async () => {
      const validData = { name: 'John', age: 30 };
      const result = await service.createUser(validData);
      expect(result).toEqual(validData);
    });

    it('should throw on invalid parameters by default', async () => {
      const invalidData = { name: 'John', age: -5 };
      await expect(service.createUser(invalidData)).rejects.toThrow();
    });

    it('should not throw when throwOnError is false', async () => {
      const invalidData = { name: 'John', age: -5 };
      const result = await service.createUserSafe(invalidData);
      expect(result).toBeNull();
      expect(service.logger.error).toHaveBeenCalled();
    });
  });

  describe('@ValidateReturn', () => {
    const schema = z.object({
      success: z.boolean(),
      data: z.any(),
    });

    class TestService {
      @ValidateReturn(schema)
      async getValidResult(): Promise<any> {
        return { success: true, data: 'test' };
      }

      @ValidateReturn(schema)
      async getInvalidResult(): Promise<any> {
        return { invalid: 'structure' };
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should validate return value', async () => {
      const result = await service.getValidResult();
      expect(result).toEqual({ success: true, data: 'test' });
    });

    it('should throw on invalid return value', async () => {
      await expect(service.getInvalidResult()).rejects.toThrow();
    });
  });

  describe('@Timed', () => {
    class TestService {
      logger = {
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      @Timed({ warnThreshold: 50 })
      async fastMethod(): Promise<string> {
        await delay(10);
        return 'fast';
      }

      @Timed({ warnThreshold: 50 })
      async slowMethod(): Promise<string> {
        await delay(60);
        return 'slow';
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should log execution time', async () => {
      await service.fastMethod();
      expect(service.logger.debug).toHaveBeenCalled();
    });

    it('should warn when execution exceeds threshold', async () => {
      await service.slowMethod();
      expect(service.logger.warn).toHaveBeenCalled();
    });
  });

  describe('@Timeout', () => {
    class TestService {
      @Timeout(50)
      async quickMethod(): Promise<string> {
        await delay(10);
        return 'done';
      }

      @Timeout(50)
      async slowMethod(): Promise<string> {
        await delay(100);
        return 'done';
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should complete when within timeout', async () => {
      const result = await service.quickMethod();
      expect(result).toBe('done');
    });

    it('should throw when exceeding timeout', async () => {
      await expect(service.slowMethod()).rejects.toThrow('timed out');
    });
  });

  describe('@Throttle', () => {
    class TestService {
      callCount = 0;

      @Throttle(100)
      async throttledMethod(): Promise<number> {
        return ++this.callCount;
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should throttle method calls', async () => {
      const result1 = await service.throttledMethod();
      expect(result1).toBe(1);

      // Immediate second call should be throttled
      const result2 = await service.throttledMethod();
      expect(result2).toBeNull();

      // Wait for throttle period
      await delay(110);

      const result3 = await service.throttledMethod();
      expect(result3).toBe(2);
    });
  });

  describe('@Debounce', () => {
    class TestService {
      callCount = 0;

      @Debounce(50)
      async debouncedMethod(): Promise<number> {
        return ++this.callCount;
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
    });

    it('should debounce method calls', async () => {
      // Multiple rapid calls
      const promise1 = service.debouncedMethod();
      const promise2 = service.debouncedMethod();
      const promise3 = service.debouncedMethod();

      // All should resolve to the same value
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // Only one actual call should have been made
      expect(service.callCount).toBe(1);
      expect(result1).toBe(1);
      expect(result2).toBe(1);
      expect(result3).toBe(1);
    });
  });

  describe('Common Schemas', () => {
    it('should validate non-empty string', () => {
      expect(() => Schemas.NonEmptyString.parse('')).toThrow();
      expect(Schemas.NonEmptyString.parse('valid')).toBe('valid');
    });

    it('should validate positive number', () => {
      expect(() => Schemas.PositiveNumber.parse(-1)).toThrow();
      expect(() => Schemas.PositiveNumber.parse(0)).toThrow();
      expect(Schemas.PositiveNumber.parse(1)).toBe(1);
    });

    it('should validate email', () => {
      expect(() => Schemas.Email.parse('invalid')).toThrow();
      expect(Schemas.Email.parse('test@example.com')).toBe('test@example.com');
    });

    it('should validate URL', () => {
      expect(() => Schemas.Url.parse('invalid')).toThrow();
      expect(Schemas.Url.parse('https://example.com')).toBe('https://example.com');
    });

    it('should validate UUID', () => {
      expect(() => Schemas.UUID.parse('invalid')).toThrow();
      expect(Schemas.UUID.parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });
});
