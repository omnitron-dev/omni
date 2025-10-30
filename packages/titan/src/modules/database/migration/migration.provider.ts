/**
 * Migration Provider
 *
 * Loads and manages migration files and classes
 */

import { readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { IMigration, MigrationMetadata, IMigrationProvider, MigrationConfig } from './migration.types.js';
import { getMigrationMetadata, isMigration } from '../database.decorators.js';
import type { Logger } from '../database.internal-types.js';
import { createDefaultLogger } from '../utils/logger.factory.js';

export class MigrationProvider implements IMigrationProvider {
  private migrations: Map<string, IMigration> = new Map();
  private metadata: Map<string, MigrationMetadata> = new Map();
  private loaded: boolean = false;
  private logger: Logger;

  constructor(private config: MigrationConfig) {
    this.logger = createDefaultLogger('MigrationProvider');
  }

  /**
   * Get all available migrations
   */
  async getMigrations(): Promise<Map<string, IMigration>> {
    await this.loadMigrations();
    return this.migrations;
  }

  /**
   * Get migration by version
   */
  async getMigration(version: string): Promise<IMigration | null> {
    await this.loadMigrations();
    return this.migrations.get(version) || null;
  }

  /**
   * Get migration metadata
   */
  async getMetadata(version: string): Promise<MigrationMetadata | null> {
    await this.loadMigrations();
    return this.metadata.get(version) || null;
  }

  /**
   * Get all migration metadata
   */
  async getAllMetadata(): Promise<MigrationMetadata[]> {
    await this.loadMigrations();
    return Array.from(this.metadata.values()).sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Load migrations from filesystem and registered classes
   */
  private async loadMigrations(): Promise<void> {
    if (this.loaded) {
      return;
    }

    // Load from filesystem if directory is configured
    if (this.config.directory) {
      await this.loadFromFilesystem();
    }

    // Load from registered migration classes
    await this.loadFromRegistry();

    // Load from custom providers
    if (this.config.providers) {
      for (const provider of this.config.providers) {
        const migrations = await provider.getMigrations();
        for (const [version, migration] of migrations) {
          const metadata = await provider.getMetadata(version);
          if (metadata) {
            this.migrations.set(version, migration);
            this.metadata.set(version, metadata);
          }
        }
      }
    }

    this.loaded = true;
  }

  /**
   * Load migrations from filesystem
   */
  private async loadFromFilesystem(): Promise<void> {
    try {
      // Skip if no directory configured
      if (!this.config.directory) {
        return;
      }

      const directory = resolve(this.config.directory);

      // Check if directory exists before attempting to read
      const fs = await import('fs');
      if (!fs.existsSync(directory)) {
        // It's valid to have no migrations directory - just log a debug message
        if (this.config.debug) {
          this.logger.debug(`Migrations directory does not exist: ${directory}`);
        }
        return;
      }

      const files = readdirSync(directory);

      // Filter migration files based on pattern
      const pattern = this.config.pattern || '*.migration.ts';
      const regex = this.patternToRegex(pattern);
      const migrationFiles = files.filter((file) => regex.test(file));

      for (const file of migrationFiles) {
        const filePath = join(directory, file);

        try {
          // Extract version from filename
          const version = this.extractVersionFromFilename(file);
          if (!version) {
            this.logger.warn(`Could not extract version from migration file: ${file}`);
            continue;
          }

          // Try to import the migration module
          const module = await this.importMigration(filePath);

          if (!module) {
            this.logger.warn(`Could not import migration from: ${file}`);
            continue;
          }

          // Find migration class in module exports
          const migrationClass = this.findMigrationClass(module);

          if (!migrationClass) {
            this.logger.warn(`No migration class found in: ${file}`);
            continue;
          }

          // Create instance
          const instance = new migrationClass();

          // Get metadata from decorator or create default
          const decoratorMetadata = getMigrationMetadata(migrationClass);
          const metadata: MigrationMetadata = decoratorMetadata
            ? {
                version: decoratorMetadata.version,
                name: file,
                description: decoratorMetadata.description || `Migration from ${file}`,
              }
            : {
                version,
                name: file,
                description: `Migration from ${file}`,
              };

          this.migrations.set(version, instance);
          this.metadata.set(version, metadata);
        } catch (error) {
          this.logger.error(`Error loading migration from ${file}:`, error);
        }
      }
    } catch (error) {
      this.logger.error(`Error loading migrations from filesystem:`, error);
    }
  }

  /**
   * Load migrations from global registry
   */
  private async loadFromRegistry(): Promise<void> {
    // Get migrations from global metadata registry
    const registeredMigrations = Reflect.getMetadata('database:migrations', global) || [];

    for (const { target, metadata } of registeredMigrations) {
      try {
        // Create instance
        const instance = new target();

        // Ensure it implements IMigration
        if (!this.isValidMigration(instance)) {
          this.logger.warn(`Registered class ${target.name} does not implement IMigration`);
          continue;
        }

        this.migrations.set(metadata.version, instance);
        this.metadata.set(metadata.version, metadata);
      } catch (error) {
        this.logger.error(`Error loading registered migration ${target.name}:`, error);
      }
    }
  }

  /**
   * Import migration from file path
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async importMigration(filePath: string): Promise<any> {
    try {
      // In ESM environment
      const fileUrl = `file://${filePath}`;
      return await import(fileUrl);
    } catch (error) {
      this.logger.error(`Error importing migration from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Find migration class in module exports
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private findMigrationClass(module: any): any {
    // Check default export
    if (module['default'] && isMigration(module['default'])) {
      return module['default'];
    }

    // Check named exports
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (typeof exported === 'function' && isMigration(exported)) {
        return exported;
      }
    }

    // Check for class that implements up/down methods
    for (const key of Object.keys(module)) {
      const exported = module[key];
      if (typeof exported === 'function') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const instance = new (exported as any)();
          if (this.isValidMigration(instance)) {
            return exported;
          }
        } catch {
          // Not a valid constructor
        }
      }
    }

    return null;
  }

  /**
   * Check if object is a valid migration
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isValidMigration(obj: any): obj is IMigration {
    return obj && typeof obj['up'] === 'function' && typeof obj['down'] === 'function';
  }

  /**
   * Convert glob pattern to regex
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Extract version from filename
   */
  private extractVersionFromFilename(filename: string): string | null {
    // Try common patterns
    // 001_create_users.migration.ts -> 001
    // 20250103_120000_create_users.migration.ts -> 20250103_120000
    // V001__create_users.sql -> 001

    const patterns = [
      /^(\d+)_/, // 001_name
      /^(\d{8}_\d{6})_/, // 20250103_120000_name
      /^V(\d+)__/, // V001__name (Flyway style)
      /^(\d{14})-/, // 20250103120000-name
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    // If no pattern matches, use the whole filename without extension
    const withoutExt = filename.replace(/\.[^.]+$/, '');
    return withoutExt || null;
  }

  /**
   * Clear loaded migrations (for testing)
   */
  clear(): void {
    this.migrations.clear();
    this.metadata.clear();
    this.loaded = false;
  }
}
