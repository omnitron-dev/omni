import { Disposable, WatchCallback } from '../types/common.js';
import { IStorageBackend } from '../types/storage.js';

/**
 * Abstract base class for storage backends
 */
export abstract class BaseStorage implements IStorageBackend {
  abstract read(path: string): Promise<any>;
  abstract write(path: string, data: any): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
  abstract list(prefix: string): Promise<string[]>;
  abstract watch(path: string, callback: WatchCallback): Disposable;

  /**
   * Read multiple paths
   */
  async readMany(paths: string[]): Promise<Array<any>> {
    return Promise.all(paths.map((path) => this.read(path)));
  }

  /**
   * Write multiple entries
   */
  async writeMany(entries: Array<{ path: string; data: any }>): Promise<void> {
    await Promise.all(entries.map((entry) => this.write(entry.path, entry.data)));
  }
}
