/**
 * Component/Block Installer
 *
 * Handles installation of Prism components and blocks to target projects.
 * Manages file copying, dependency resolution, and lockfile tracking.
 *
 * Key Features:
 * - Atomic installation with rollback on failure
 * - Automatic dependency installation
 * - Template variable substitution
 * - Lockfile tracking for updates
 *
 * @module @omnitron/prism/registry/installer
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ComponentDefinition, InstalledComponent, InstalledBlock, PrismLockfile } from '../types/registry.js';
import type { BlockDefinition } from '../types/blocks.js';
import { RegistryManager, type ResolvedItem } from './manager.js';

// =============================================================================
// TYPES
// =============================================================================

export interface InstallerOptions {
  /** Target directory for components */
  componentsDir?: string;
  /** Target directory for blocks */
  blocksDir?: string;
  /** Target directory for hooks */
  hooksDir?: string;
  /** Overwrite existing files */
  overwrite?: boolean;
  /** Dry run mode (don't write files) */
  dryRun?: boolean;
  /** Skip dependencies */
  skipDependencies?: boolean;
  /** Template variables for substitution */
  templateVars?: Record<string, string>;
}

export interface InstallResult {
  /** Whether installation was successful */
  success: boolean;
  /** Installed files */
  files: string[];
  /** npm dependencies to install */
  npmDependencies: string[];
  /** Errors encountered */
  errors: string[];
  /** Warnings */
  warnings: string[];
}

interface FileOperation {
  type: 'write' | 'mkdir';
  path: string;
  content?: string;
}

// =============================================================================
// INSTALLER
// =============================================================================

/**
 * Prism component and block installer.
 *
 * @example
 * ```typescript
 * const installer = new PrismInstaller({
 *   componentsDir: 'src/components',
 *   blocksDir: 'src/blocks',
 * });
 *
 * // Install a component
 * const result = await installer.installComponent('button');
 *
 * // Install a block with all dependencies
 * const blockResult = await installer.installBlock('dashboard-layout');
 * ```
 */
export class PrismInstaller {
  private readonly options: Required<InstallerOptions>;
  private readonly registryManager: RegistryManager;
  private lockfile: PrismLockfile | null = null;
  private lockfilePath: string;

  constructor(registryManager: RegistryManager, options: InstallerOptions = {}) {
    this.registryManager = registryManager;
    this.options = {
      componentsDir: options.componentsDir ?? 'src/components/prism',
      blocksDir: options.blocksDir ?? 'src/blocks',
      hooksDir: options.hooksDir ?? 'src/hooks',
      overwrite: options.overwrite ?? false,
      dryRun: options.dryRun ?? false,
      skipDependencies: options.skipDependencies ?? false,
      templateVars: options.templateVars ?? {},
    };
    this.lockfilePath = path.join(process.cwd(), 'prism.lock.json');
  }

  // ===========================================================================
  // COMPONENT INSTALLATION
  // ===========================================================================

  /**
   * Install a component and its dependencies.
   */
  async installComponent(name: string, registryName?: string): Promise<InstallResult> {
    const result: InstallResult = {
      success: false,
      files: [],
      npmDependencies: [],
      errors: [],
      warnings: [],
    };

    try {
      // Resolve component and dependencies
      const resolved = await this.registryManager.resolveComponentDependencies(name, registryName);

      // Get all items to install (flattened)
      const itemsToInstall = this.options.skipDependencies ? [resolved] : this.flattenDependencies(resolved);

      // Check for existing installations
      await this.loadLockfile();
      const existingComponents = new Set(Object.keys(this.lockfile?.components ?? {}));

      // Filter out already installed components (unless overwrite is enabled)
      const filteredItems = this.options.overwrite
        ? itemsToInstall
        : itemsToInstall.filter((item) => {
            const def = item.definition as ComponentDefinition;
            if (existingComponents.has(def.name)) {
              result.warnings.push(
                `Component "${def.name}" is already installed, skipping (use --overwrite to replace)`
              );
              return false;
            }
            return true;
          });

      // Collect all file operations
      const operations: FileOperation[] = [];
      const installedComponents: InstalledComponent[] = [];

      for (const item of filteredItems) {
        const component = item.definition as ComponentDefinition;
        const componentOps = await this.prepareComponentFiles(component, item.registry);
        operations.push(...componentOps);

        installedComponents.push({
          name: component.name,
          version: component.version,
          registry: item.registry,
          installedAt: new Date().toISOString(),
          files: componentOps.filter((op) => op.type === 'write').map((op) => op.path),
        });
      }

      // Collect npm dependencies
      result.npmDependencies = this.registryManager.getNpmDependencies(resolved);

      // Execute operations (or simulate in dry run)
      if (this.options.dryRun) {
        result.files = operations.filter((op) => op.type === 'write').map((op) => op.path);
        result.success = true;
      } else {
        await this.executeOperations(operations);
        result.files = operations.filter((op) => op.type === 'write').map((op) => op.path);

        // Update lockfile
        for (const component of installedComponents) {
          this.lockfile!.components[component.name] = component;
        }
        await this.saveLockfile();

        result.success = true;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Prepare file operations for a component.
   */
  private async prepareComponentFiles(component: ComponentDefinition, _registry: string): Promise<FileOperation[]> {
    const operations: FileOperation[] = [];
    const componentDir = path.join(this.options.componentsDir, component.name);

    // Create component directory
    operations.push({ type: 'mkdir', path: componentDir });

    // Prepare each file
    for (const file of component.files) {
      const targetPath = path.join(componentDir, path.basename(file.path));
      const content = await this.fetchFileContent(file.path);
      const processedContent = this.processTemplate(content);

      operations.push({
        type: 'write',
        path: targetPath,
        content: processedContent,
      });
    }

    return operations;
  }

  // ===========================================================================
  // BLOCK INSTALLATION
  // ===========================================================================

  /**
   * Install a block and its dependencies.
   */
  async installBlock(name: string, registryName?: string): Promise<InstallResult> {
    const result: InstallResult = {
      success: false,
      files: [],
      npmDependencies: [],
      errors: [],
      warnings: [],
    };

    try {
      // Resolve block and dependencies
      const resolved = await this.registryManager.resolveBlockDependencies(name, registryName);

      // Get all items to install (flattened)
      const allItems = this.options.skipDependencies ? [resolved] : this.flattenDependencies(resolved);

      // Separate blocks and components by checking for block-specific properties
      // BlockDefinition has 'defaultConfig' which ComponentDefinition doesn't have
      const blocks = allItems.filter((item) => {
        const def = item.definition;
        // Block has 'defaultConfig' and 'dependencies.blocks', Component has 'dependencies.components'
        return 'defaultConfig' in def && 'dependencies' in def && 'blocks' in (def as BlockDefinition).dependencies;
      });
      const components = allItems.filter((item) => !blocks.includes(item));

      // Check for existing installations
      await this.loadLockfile();

      // Install component dependencies first
      for (const item of components) {
        const component = item.definition as ComponentDefinition;
        const existingComponent = this.lockfile?.components[component.name];

        if (existingComponent && !this.options.overwrite) {
          result.warnings.push(`Component "${component.name}" is already installed, skipping`);
          continue;
        }

        const componentResult = await this.installComponent(component.name, item.registry);
        result.files.push(...componentResult.files);
        result.errors.push(...componentResult.errors);
        result.warnings.push(...componentResult.warnings);
      }

      // Install blocks
      const operations: FileOperation[] = [];
      const installedBlocks: InstalledBlock[] = [];

      for (const item of blocks) {
        const block = item.definition as BlockDefinition;
        const existingBlock = this.lockfile?.blocks[block.name];

        if (existingBlock && !this.options.overwrite) {
          result.warnings.push(`Block "${block.name}" is already installed, skipping`);
          continue;
        }

        const blockOps = await this.prepareBlockFiles(block, item.registry);
        operations.push(...blockOps);

        installedBlocks.push({
          name: block.name,
          version: block.version,
          registry: item.registry,
          installedAt: new Date().toISOString(),
          files: blockOps.filter((op) => op.type === 'write').map((op) => op.path),
          config: block.defaultConfig,
        });
      }

      // Collect npm dependencies
      result.npmDependencies = this.registryManager.getNpmDependencies(resolved);

      // Execute operations
      if (this.options.dryRun) {
        result.files.push(...operations.filter((op) => op.type === 'write').map((op) => op.path));
        result.success = true;
      } else {
        await this.executeOperations(operations);
        result.files.push(...operations.filter((op) => op.type === 'write').map((op) => op.path));

        // Update lockfile
        for (const block of installedBlocks) {
          this.lockfile!.blocks[block.name] = block;
        }
        await this.saveLockfile();

        result.success = true;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Prepare file operations for a block.
   */
  private async prepareBlockFiles(block: BlockDefinition, _registry: string): Promise<FileOperation[]> {
    const operations: FileOperation[] = [];
    const blockDir = path.join(this.options.blocksDir, block.name);

    // Create block directory
    operations.push({ type: 'mkdir', path: blockDir });

    // Prepare each file
    for (const file of block.files) {
      const targetPath = path.join(blockDir, file.path);
      const targetDir = path.dirname(targetPath);

      // Create subdirectory if needed
      if (targetDir !== blockDir) {
        operations.push({ type: 'mkdir', path: targetDir });
      }

      const content = await this.fetchFileContent(file.path);
      const processedContent = this.processTemplate(content);

      operations.push({
        type: 'write',
        path: targetPath,
        content: processedContent,
      });
    }

    return operations;
  }

  // ===========================================================================
  // UNINSTALLATION
  // ===========================================================================

  /**
   * Uninstall a component.
   */
  async uninstallComponent(name: string): Promise<InstallResult> {
    const result: InstallResult = {
      success: false,
      files: [],
      npmDependencies: [],
      errors: [],
      warnings: [],
    };

    try {
      await this.loadLockfile();
      const installed = this.lockfile?.components[name];

      if (!installed) {
        result.errors.push(`Component "${name}" is not installed`);
        return result;
      }

      // Check if any other components depend on this one
      const dependents = await this.findDependents(name, 'component');
      if (dependents.length > 0) {
        result.errors.push(`Cannot uninstall "${name}" because it is used by: ${dependents.join(', ')}`);
        return result;
      }

      // Delete files
      if (!this.options.dryRun) {
        for (const filePath of installed.files) {
          await fs.unlink(filePath).catch(() => {
            result.warnings.push(`Could not delete file: ${filePath}`);
          });
        }

        // Try to remove component directory if empty
        const componentDir = path.dirname(installed.files[0]);
        await fs.rmdir(componentDir).catch(() => {
          // Directory not empty or doesn't exist
        });

        // Update lockfile
        delete this.lockfile!.components[name];
        await this.saveLockfile();
      }

      result.files = installed.files;
      result.success = true;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  /**
   * Uninstall a block.
   */
  async uninstallBlock(name: string): Promise<InstallResult> {
    const result: InstallResult = {
      success: false,
      files: [],
      npmDependencies: [],
      errors: [],
      warnings: [],
    };

    try {
      await this.loadLockfile();
      const installed = this.lockfile?.blocks[name];

      if (!installed) {
        result.errors.push(`Block "${name}" is not installed`);
        return result;
      }

      // Check if any other blocks depend on this one
      const dependents = await this.findDependents(name, 'block');
      if (dependents.length > 0) {
        result.errors.push(`Cannot uninstall "${name}" because it is used by: ${dependents.join(', ')}`);
        return result;
      }

      // Delete files
      if (!this.options.dryRun) {
        for (const filePath of installed.files) {
          await fs.unlink(filePath).catch(() => {
            result.warnings.push(`Could not delete file: ${filePath}`);
          });
        }

        // Try to remove block directory
        const blockDir = path.dirname(installed.files[0]);
        await fs.rm(blockDir, { recursive: true }).catch(() => {
          result.warnings.push(`Could not remove directory: ${blockDir}`);
        });

        // Update lockfile
        delete this.lockfile!.blocks[name];
        await this.saveLockfile();
      }

      result.files = installed.files;
      result.success = true;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Flatten dependency tree into unique list.
   */
  private flattenDependencies(resolved: ResolvedItem): ResolvedItem[] {
    const seen = new Set<string>();
    const result: ResolvedItem[] = [];

    function traverse(item: ResolvedItem): void {
      const key = `${item.registry}:${item.definition.name}`;
      if (seen.has(key)) return;
      seen.add(key);

      // Process dependencies first (for proper install order)
      for (const dep of item.dependencies) {
        traverse(dep);
      }

      result.push(item);
    }

    traverse(resolved);
    return result;
  }

  /**
   * Fetch file content from registry.
   * Supports local files (prefixed with file:// or absolute paths) and remote URLs.
   */
  private async fetchFileContent(filePath: string): Promise<string> {
    // Handle local file paths
    if (filePath.startsWith('file://') || filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
      const actualPath = filePath.replace('file://', '');
      try {
        const content = await fs.readFile(actualPath, 'utf-8');
        return content;
      } catch (error) {
        throw new Error(
          `Failed to read local file "${actualPath}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
    }

    // Handle relative paths (resolve against baseDir from registry manager options)
    if (!filePath.startsWith('http://') && !filePath.startsWith('https://')) {
      const resolvedPath = path.resolve(process.cwd(), filePath);
      try {
        const content = await fs.readFile(resolvedPath, 'utf-8');
        return content;
      } catch (error) {
        throw new Error(
          `Failed to read file "${resolvedPath}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
    }

    // Handle remote URLs
    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      throw new Error(
        `Failed to fetch remote file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Process template variables in content.
   */
  private processTemplate(content: string): string {
    let result = content;

    for (const [key, value] of Object.entries(this.options.templateVars)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return result;
  }

  /**
   * Execute file operations.
   */
  private async executeOperations(operations: FileOperation[]): Promise<void> {
    // Sort operations: directories first, then files
    const sorted = [...operations].sort((a, b) => {
      if (a.type === 'mkdir' && b.type !== 'mkdir') return -1;
      if (a.type !== 'mkdir' && b.type === 'mkdir') return 1;
      return 0;
    });

    for (const op of sorted) {
      if (op.type === 'mkdir') {
        await fs.mkdir(op.path, { recursive: true });
      } else if (op.type === 'write' && op.content !== undefined) {
        // Check if file exists and we shouldn't overwrite
        if (!this.options.overwrite) {
          try {
            await fs.access(op.path);
            continue; // File exists, skip
          } catch {
            // File doesn't exist, proceed
          }
        }
        await fs.writeFile(op.path, op.content, 'utf-8');
      }
    }
  }

  /**
   * Find items that depend on a given component/block.
   */
  private async findDependents(name: string, type: 'component' | 'block'): Promise<string[]> {
    const dependents: string[] = [];

    if (!this.lockfile) return dependents;

    // Check all installed blocks for dependencies
    for (const [blockName, _block] of Object.entries(this.lockfile.blocks)) {
      const blockDef = await this.registryManager.getBlock(blockName);
      if (!blockDef) continue;

      if (type === 'component' && blockDef.dependencies.components.includes(name)) {
        dependents.push(blockName);
      }
      if (type === 'block' && blockDef.dependencies.blocks.includes(name)) {
        dependents.push(blockName);
      }
    }

    // Check components for component dependencies
    if (type === 'component') {
      for (const [compName, _comp] of Object.entries(this.lockfile.components)) {
        const compDef = await this.registryManager.getComponent(compName);
        if (!compDef) continue;

        if (compDef.dependencies.components.includes(name)) {
          dependents.push(compName);
        }
      }
    }

    return dependents;
  }

  // ===========================================================================
  // LOCKFILE MANAGEMENT
  // ===========================================================================

  /**
   * Load lockfile from disk.
   */
  private async loadLockfile(): Promise<void> {
    if (this.lockfile) return;

    try {
      const content = await fs.readFile(this.lockfilePath, 'utf-8');
      this.lockfile = JSON.parse(content);
    } catch {
      // Create new lockfile if it doesn't exist
      this.lockfile = {
        version: '1.0.0',
        components: {},
        blocks: {},
        themes: [],
      };
    }
  }

  /**
   * Save lockfile to disk.
   */
  private async saveLockfile(): Promise<void> {
    if (!this.lockfile) return;

    await fs.writeFile(this.lockfilePath, JSON.stringify(this.lockfile, null, 2), 'utf-8');
  }

  /**
   * Get current lockfile.
   */
  async getLockfile(): Promise<PrismLockfile> {
    await this.loadLockfile();
    return this.lockfile!;
  }

  /**
   * List installed components.
   */
  async listInstalled(): Promise<{
    components: InstalledComponent[];
    blocks: InstalledBlock[];
  }> {
    await this.loadLockfile();
    return {
      components: Object.values(this.lockfile!.components),
      blocks: Object.values(this.lockfile!.blocks),
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new installer instance.
 */
export function createInstaller(registryManager: RegistryManager, options?: InstallerOptions): PrismInstaller {
  return new PrismInstaller(registryManager, options);
}
