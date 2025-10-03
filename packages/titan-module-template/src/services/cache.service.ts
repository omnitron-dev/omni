/**
 * Cache Service
 *
 * Simple in-memory cache service for the template module.
 * In production, this could be replaced with Redis or another caching solution.
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import {
  TEMPLATE_MODULE_OPTIONS,
  TEMPLATE_LOGGER,
  CACHE_PREFIX
} from '../constants.js';
import type { TemplateModuleOptions } from '../types.js';
import { LoggerService } from './logger.service.js';
import { createCacheKey, isExpired } from '../utils.js';

interface CacheEntry<T = any> {
  value: T;
  timestamp: number;
  ttl?: number;
}

@Injectable()
export class CacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private initialized = false;

  constructor(
    @Inject(TEMPLATE_MODULE_OPTIONS) private readonly options: TemplateModuleOptions,
    @Inject(TEMPLATE_LOGGER) private readonly logger: LoggerService
  ) {
    this.logger.debug('CacheService constructor');
  }

  /**
   * Initialize the cache service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.debug('Initializing CacheService');

    // Start cleanup interval
    if (this.options.enableCache) {
      this.startCleanupInterval();
    }

    this.initialized = true;
    this.logger.debug('CacheService initialized');
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.options.enableCache) {
      return null;
    }

    const fullKey = this.createKey(key);
    const entry = this.cache.get(fullKey);

    if (!entry) {
      this.logger.debug('Cache miss', { key: fullKey });
      return null;
    }

    // Check if expired
    if (entry.ttl && isExpired(entry.timestamp, entry.ttl)) {
      this.cache.delete(fullKey);
      this.logger.debug('Cache entry expired', { key: fullKey });
      return null;
    }

    this.logger.debug('Cache hit', { key: fullKey });
    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (!this.options.enableCache) {
      return;
    }

    const fullKey = this.createKey(key);
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.options.cacheTTL
    };

    this.cache.set(fullKey, entry);
    this.logger.debug('Cache set', { key: fullKey, ttl: entry.ttl });
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.options.enableCache) {
      return false;
    }

    const fullKey = this.createKey(key);
    const result = this.cache.delete(fullKey);

    if (result) {
      this.logger.debug('Cache delete', { key: fullKey });
    }

    return result;
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    if (!this.options.enableCache) {
      return false;
    }

    const fullKey = this.createKey(key);
    const entry = this.cache.get(fullKey);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.ttl && isExpired(entry.timestamp, entry.ttl)) {
      this.cache.delete(fullKey);
      return false;
    }

    return true;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.debug('Cache cleared', { entriesRemoved: size });
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): Record<string, any> {
    const entries = Array.from(this.cache.entries());
    const now = Date.now();

    const expired = entries.filter(([_, entry]) =>
      entry.ttl && isExpired(entry.timestamp, entry.ttl)
    ).length;

    const avgAge = entries.reduce((sum, [_, entry]) =>
      sum + (now - entry.timestamp), 0
    ) / (entries.length || 1);

    return {
      size: this.cache.size,
      expired,
      avgAge: Math.round(avgAge / 1000), // In seconds
      enabled: this.options.enableCache
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test: set and get a value
      const testKey = '__health_check__';
      const testValue = { test: true, timestamp: Date.now() };

      await this.set(testKey, testValue, 60);
      const retrieved = await this.get(testKey);
      await this.delete(testKey);

      return retrieved !== null;
    } catch (error) {
      this.logger.error('Cache health check failed', error as Error);
      return false;
    }
  }

  /**
   * Create a full cache key
   */
  private createKey(key: string): string {
    return createCacheKey(CACHE_PREFIX, this.options.prefix || 'default', key);
  }

  /**
   * Start cleanup interval for expired entries
   */
  private startCleanupInterval(): void {
    const interval = setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Run every minute

    // Ensure interval doesn't prevent process exit
    interval.unref();
  }

  /**
   * Remove expired entries
   */
  private cleanupExpired(): void {
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl && isExpired(entry.timestamp, entry.ttl)) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug('Cleaned up expired cache entries', { removed });
    }
  }
}