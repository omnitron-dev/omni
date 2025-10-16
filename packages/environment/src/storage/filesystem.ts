import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Disposable, WatchCallback, WatchEvent } from '../types/common.js';
import { StorageOptions } from '../types/storage.js';
import { BaseStorage } from './base.js';

/**
 * File system storage backend
 */
export class FileSystemStorage extends BaseStorage {
  private basePath: string;
  private encoding: 'utf8' | 'json' | 'yaml';
  private watchers: Map<string, Set<WatchCallback>> = new Map();
  private fsWatchers: Map<string, any> = new Map();

  constructor(options: StorageOptions = {}) {
    super();
    this.basePath = options.basePath || process.cwd();
    this.encoding = options.encoding || 'json';
  }

  /**
   * Read data from file
   */
  async read(path: string): Promise<any> {
    const fullPath = this.resolvePath(path);
    const content = await fs.readFile(fullPath, 'utf-8');

    return this.deserialize(content);
  }

  /**
   * Write data to file
   */
  async write(path: string, data: any): Promise<void> {
    const fullPath = this.resolvePath(path);
    const exists = await this.exists(path);

    // Ensure directory exists
    await fs.mkdir(this.getDirname(fullPath), { recursive: true });

    // Serialize and write
    const content = this.serialize(data);
    await fs.writeFile(fullPath, content, 'utf-8');

    // Notify watchers
    await this.notifyWatchers(path, exists ? 'modified' : 'created');
  }

  /**
   * Delete file
   */
  async delete(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    await fs.unlink(fullPath);

    // Notify watchers
    await this.notifyWatchers(path, 'deleted');
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(path);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files with prefix
   */
  async list(prefix: string): Promise<string[]> {
    const fullPath = this.resolvePath(prefix);
    const dir = this.getDirname(fullPath);

    try {
      const files = await fs.readdir(dir);
      const filtered: string[] = [];

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);

        if (stat.isFile()) {
          const relativePath = path.relative(this.basePath, filePath);
          if (relativePath.startsWith(prefix)) {
            filtered.push(relativePath);
          }
        }
      }

      return filtered;
    } catch {
      return [];
    }
  }

  /**
   * Watch for file changes
   */
  watch(path: string, callback: WatchCallback): Disposable {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, new Set());
    }
    this.watchers.get(path)!.add(callback);

    // Note: File system watching is disabled for now
    // due to complexity with fs.watch API in Node.js
    // TODO: Implement proper file system watching

    return {
      dispose: () => {
        const callbacks = this.watchers.get(path);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.watchers.delete(path);
            const watcher = this.fsWatchers.get(path);
            if (watcher) {
              watcher.close();
              this.fsWatchers.delete(path);
            }
          }
        }
      }
    };
  }

  /**
   * Resolve full path
   */
  private resolvePath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(this.basePath, p);
  }

  /**
   * Get directory name
   */
  private getDirname(p: string): string {
    return path.dirname(p);
  }

  /**
   * Serialize data based on encoding
   */
  private serialize(data: any): string {
    switch (this.encoding) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'yaml':
        return yaml.dump(data);
      case 'utf8':
      default:
        return String(data);
    }
  }

  /**
   * Deserialize data based on encoding
   */
  private deserialize(content: string): any {
    switch (this.encoding) {
      case 'json':
        return JSON.parse(content);
      case 'yaml':
        return yaml.load(content);
      case 'utf8':
      default:
        return content;
    }
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
