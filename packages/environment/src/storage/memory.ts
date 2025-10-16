import { Disposable, WatchCallback, WatchEvent } from '../types/common.js';
import { StorageOptions } from '../types/storage.js';
import { BaseStorage } from './base.js';

/**
 * In-memory storage backend for testing
 */
export class MemoryStorage extends BaseStorage {
  private data: Map<string, any> = new Map();
  private watchers: Map<string, Set<WatchCallback>> = new Map();

  constructor(_options: StorageOptions = {}) {
    super();
  }

  /**
   * Read data from memory
   */
  async read(path: string): Promise<any> {
    if (!this.data.has(path)) {
      throw new Error(`Path not found: ${path}`);
    }
    return this.data.get(path);
  }

  /**
   * Write data to memory
   */
  async write(path: string, data: any): Promise<void> {
    const exists = this.data.has(path);
    this.data.set(path, data);

    // Notify watchers
    await this.notifyWatchers(path, exists ? 'modified' : 'created');
  }

  /**
   * Delete data from memory
   */
  async delete(path: string): Promise<void> {
    if (!this.data.has(path)) {
      throw new Error(`Path not found: ${path}`);
    }
    this.data.delete(path);

    // Notify watchers
    await this.notifyWatchers(path, 'deleted');
  }

  /**
   * Check if path exists
   */
  async exists(path: string): Promise<boolean> {
    return this.data.has(path);
  }

  /**
   * List paths with prefix
   */
  async list(prefix: string): Promise<string[]> {
    const paths: string[] = [];
    for (const path of this.data.keys()) {
      if (path.startsWith(prefix)) {
        paths.push(path);
      }
    }
    return paths;
  }

  /**
   * Watch for changes
   */
  watch(path: string, callback: WatchCallback): Disposable {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set());
    }
    this.watchers.get(path)!.add(callback);

    return {
      dispose: () => {
        const callbacks = this.watchers.get(path);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.watchers.delete(path);
          }
        }
      }
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get all data
   */
  getAll(): Map<string, any> {
    return new Map(this.data);
  }

  /**
   * Notify watchers of changes
   */
  private async notifyWatchers(
    path: string,
    type: 'created' | 'modified' | 'deleted'
  ): Promise<void> {
    const callbacks = this.watchers.get(path);
    if (!callbacks) return;

    const event: WatchEvent = {
      type,
      path,
      timestamp: new Date()
    };

    await Promise.all(Array.from(callbacks).map((cb) => cb(event)));
  }
}
