/**
 * Configuration Watcher Service
 *
 * Handles watching configuration files for changes
 */

import { watch, FSWatcher } from 'node:fs';
import path from 'node:path';
import { Injectable } from '../../decorators/index.js';

import type { ConfigSource, IConfigWatcher, IConfigChangeEvent } from './types.js';

@Injectable()
export class ConfigWatcherService implements IConfigWatcher {
  private watchers: FSWatcher[] = [];
  private watchedFiles: Set<string> = new Set();

  /**
   * Watch configuration sources for changes
   */
  watch(sources: ConfigSource[], onChange: (event: IConfigChangeEvent) => void): void {
    // Only watch file sources
    const fileSources = sources.filter((s) => s.type === 'file');

    for (const source of fileSources) {
      const filePath = path.resolve((source as any).path);

      // Skip if already watching
      if (this.watchedFiles.has(filePath)) {
        continue;
      }

      try {
        const watcher = watch(filePath, (eventType, filename) => {
          if (eventType === 'change') {
            onChange({
              path: filePath,
              oldValue: null, // Would need to cache old values to provide this
              newValue: null, // Would need to reload to provide this
              source: source.name || 'file',
              timestamp: new Date(),
            });
          }
        });

        this.watchers.push(watcher);
        this.watchedFiles.add(filePath);
      } catch (error) {
        // `optional` reads differently here than in the loader, on purpose.
        //
        // For the LOADER it means the source may be ABSENT — a file that
        // exists and cannot be understood is an error even when optional,
        // because the alternative is booting on defaults in silence.
        //
        // Here the file has already been loaded correctly and only the CHANGE
        // NOTIFICATION could not be established (an inotify/FSEvents limit,
        // typically). The cost is that edits to this file stop applying until
        // a restart — a lost convenience, not a wrong value — and making it
        // fatal would let a system-wide watch-descriptor limit take down a
        // process whose configuration is entirely correct.
        if (!source.optional) {
          throw error;
        }
      }
    }
  }

  /**
   * Stop watching all files
   */
  unwatch(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.watchedFiles.clear();
  }
}
