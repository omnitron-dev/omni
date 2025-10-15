/**
 * Core Module - Storage Service
 *
 * LocalStorage and SessionStorage abstraction with type-safety
 */

import { Injectable } from '@omnitron-dev/aether/di';

/**
 * Storage interface for LocalStorage and SessionStorage
 */
export interface IStorageService {
  get<T = any>(key: string): T | null;
  set<T = any>(key: string, value: T): void;
  remove(key: string): void;
  clear(): void;
  has(key: string): boolean;
  keys(): string[];
}

/**
 * Storage Service
 *
 * Provides a type-safe wrapper around LocalStorage with:
 * - Automatic JSON serialization/deserialization
 * - Error handling
 * - Type safety
 * - Namespace support
 *
 * @example
 * ```typescript
 * const storage = inject(StorageService);
 *
 * // Store data
 * storage.set('user', { name: 'John', age: 30 });
 *
 * // Retrieve data with type safety
 * const user = storage.get<{ name: string; age: number }>('user');
 *
 * // Check existence
 * if (storage.has('user')) {
 *   console.log('User data exists');
 * }
 *
 * // Remove data
 * storage.remove('user');
 * ```
 */
@Injectable({ scope: 'singleton', providedIn: 'root' })
export class StorageService implements IStorageService {
  private storage: Storage;

  constructor(storageType: 'local' | 'session' = 'local') {
    this.storage = storageType === 'local' ? localStorage : sessionStorage;
  }

  /**
   * Get a value from storage
   *
   * @param key - Storage key
   * @returns Parsed value or null if not found or error
   */
  get<T = any>(key: string): T | null {
    try {
      const item = this.storage.getItem(key);
      if (item === null) {
        return null;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`[StorageService] Error getting key "${key}":`, error);
      return null;
    }
  }

  /**
   * Set a value in storage
   *
   * @param key - Storage key
   * @param value - Value to store (will be JSON stringified)
   */
  set<T = any>(key: string, value: T): void {
    try {
      const serialized = JSON.stringify(value);
      this.storage.setItem(key, serialized);
    } catch (error) {
      console.error(`[StorageService] Error setting key "${key}":`, error);
    }
  }

  /**
   * Remove a value from storage
   *
   * @param key - Storage key
   */
  remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch (error) {
      console.error(`[StorageService] Error removing key "${key}":`, error);
    }
  }

  /**
   * Clear all values from storage
   */
  clear(): void {
    try {
      this.storage.clear();
    } catch (error) {
      console.error('[StorageService] Error clearing storage:', error);
    }
  }

  /**
   * Check if a key exists in storage
   *
   * @param key - Storage key
   * @returns True if key exists
   */
  has(key: string): boolean {
    return this.storage.getItem(key) !== null;
  }

  /**
   * Get all keys from storage
   *
   * @returns Array of storage keys
   */
  keys(): string[] {
    try {
      return Object.keys(this.storage);
    } catch (error) {
      console.error('[StorageService] Error getting keys:', error);
      return [];
    }
  }

  /**
   * Get storage size in bytes (approximate)
   *
   * @returns Approximate storage size in bytes
   */
  getSize(): number {
    try {
      let size = 0;
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key) {
          const value = this.storage.getItem(key);
          if (value) {
            size += key.length + value.length;
          }
        }
      }
      return size;
    } catch (error) {
      console.error('[StorageService] Error calculating size:', error);
      return 0;
    }
  }
}
