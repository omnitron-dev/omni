import { Disposable, WatchCallback } from './common.js';

/**
 * Storage backend interface
 */
export interface IStorageBackend {
  // CRUD operations
  read(path: string): Promise<any>;
  write(path: string, data: any): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;

  // Bulk operations
  readMany(paths: string[]): Promise<Array<any>>;
  writeMany(entries: Array<{ path: string; data: any }>): Promise<void>;

  // Querying
  list(prefix: string): Promise<string[]>;

  // Watching
  watch(path: string, callback: WatchCallback): Disposable;
}

/**
 * Storage options
 */
export interface StorageOptions {
  // Common options
  encoding?: 'utf8' | 'json' | 'yaml';
  compression?: boolean;

  // File system specific
  basePath?: string;
  createDirs?: boolean;

  // Memory specific
  maxSize?: number;
  ttl?: number;
}
