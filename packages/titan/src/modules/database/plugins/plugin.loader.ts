/**
 * Plugin Loader Service
 *
 * Loads and validates database plugins dynamically
 */

import { promises as fs } from 'fs';
import { join, resolve, basename, extname } from 'path';
import { pathToFileURL } from 'url';
import { Injectable } from '../../../decorators/index.js';
import type {
  IPluginLoader,
  ITitanPlugin,
  PluginFactory,
} from './plugin.types.js';

/**
 * Plugin Loader
 *
 * Dynamically loads plugins from files and packages
 */
@Injectable()
export class PluginLoader implements IPluginLoader {
  private readonly loadedPlugins: Map<string, ITitanPlugin> = new Map();
  private readonly pluginFactories: Map<string, PluginFactory> = new Map();

  /**
   * Load plugin from file or package
   */
  async loadPlugin(path: string): Promise<ITitanPlugin> {
    // Check if already loaded
    if (this.loadedPlugins.has(path)) {
      return this.loadedPlugins.get(path)!;
    }

    try {
      // Determine if path is a file or package
      if (path.startsWith('@') || !path.includes('/')) {
        // Load from package
        return await this.loadFromPackage(path);
      } else {
        // Load from file
        return await this.loadFromFile(path);
      }
    } catch (error) {
      throw new Error(`Failed to load plugin from "${path}": ${error}`);
    }
  }

  /**
   * Load plugin from file
   */
  private async loadFromFile(filePath: string): Promise<ITitanPlugin> {
    const resolvedPath = resolve(filePath);

    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw new Error(`Plugin file not found: ${resolvedPath}`);
    }

    // Import the module
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);

    // Find the plugin export
    const plugin = this.extractPlugin(module, basename(filePath, extname(filePath)));

    // Cache the plugin
    this.loadedPlugins.set(filePath, plugin);

    return plugin;
  }

  /**
   * Load plugin from npm package
   */
  private async loadFromPackage(packageName: string): Promise<ITitanPlugin> {
    try {
      // Import the package
      const module = await import(packageName);

      // Find the plugin export
      const plugin = this.extractPlugin(module, packageName);

      // Cache the plugin
      this.loadedPlugins.set(packageName, plugin);

      return plugin;
    } catch (error) {
      throw new Error(`Failed to load plugin package "${packageName}": ${error}`);
    }
  }

  /**
   * Extract plugin from module exports
   */
  private extractPlugin(module: any, name: string): ITitanPlugin {
    // Check for default export
    if (module.default) {
      if (this.isPluginFactory(module.default)) {
        return this.createPluginFromFactory(module.default, name);
      }
      if (this.isPlugin(module.default)) {
        return this.ensureTitanPlugin(module.default, name);
      }
    }

    // Check for named exports
    if (module.plugin) {
      if (this.isPluginFactory(module.plugin)) {
        return this.createPluginFromFactory(module.plugin, name);
      }
      if (this.isPlugin(module.plugin)) {
        return this.ensureTitanPlugin(module.plugin, name);
      }
    }

    // Check for createPlugin export
    if (module.createPlugin && typeof module.createPlugin === 'function') {
      return this.createPluginFromFactory(module.createPlugin, name);
    }

    // Check if module itself is a plugin
    if (this.isPlugin(module)) {
      return this.ensureTitanPlugin(module, name);
    }

    throw new Error(`No valid plugin export found in module`);
  }

  /**
   * Check if object is a plugin factory
   */
  private isPluginFactory(obj: any): obj is PluginFactory {
    return typeof obj === 'function';
  }

  /**
   * Check if object is a plugin
   */
  private isPlugin(obj: any): boolean {
    return (
      obj &&
      typeof obj === 'object' &&
      (obj.extendRepository ||
        obj.extendDatabase ||
        obj.extendTransaction ||
        obj.name)
    );
  }

  /**
   * Create plugin from factory
   */
  private createPluginFromFactory(factory: PluginFactory, name: string): ITitanPlugin {
    // Call factory with empty options
    const plugin = factory({});

    // Ensure it's a Titan plugin
    return this.ensureTitanPlugin(plugin, name);
  }

  /**
   * Ensure plugin is a Titan plugin
   */
  private ensureTitanPlugin(plugin: any, name: string): ITitanPlugin {
    // If already a Titan plugin, return as is
    if (plugin.name && plugin.version) {
      return plugin as ITitanPlugin;
    }

    // Convert to Titan plugin
    return {
      ...plugin,
      name: plugin.name || name,
      version: plugin.version || '1.0.0',
    } as ITitanPlugin;
  }

  /**
   * Load plugins from directory
   */
  async loadPluginsFromDirectory(directory: string): Promise<ITitanPlugin[]> {
    const resolvedDir = resolve(directory);
    const plugins: ITitanPlugin[] = [];

    // Check if directory exists
    try {
      await fs.access(resolvedDir);
    } catch {
      throw new Error(`Plugin directory not found: ${resolvedDir}`);
    }

    // Read directory contents
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(resolvedDir, entry.name);

      if (entry.isFile()) {
        // Check if it's a potential plugin file
        if (this.isPluginFile(entry.name)) {
          try {
            const plugin = await this.loadFromFile(fullPath);
            plugins.push(plugin);
          } catch (error) {
            console.warn(`Failed to load plugin from "${fullPath}":`, error);
          }
        }
      } else if (entry.isDirectory()) {
        // Check if directory contains a plugin
        const packageJsonPath = join(fullPath, 'package.json');
        try {
          await fs.access(packageJsonPath);
          // Try to load as a local package
          const plugin = await this.loadFromFile(join(fullPath, 'index.js'));
          plugins.push(plugin);
        } catch {
          // Not a package directory, skip
        }
      }
    }

    return plugins;
  }

  /**
   * Check if file is a potential plugin file
   */
  private isPluginFile(filename: string): boolean {
    const ext = extname(filename);
    const base = basename(filename, ext);

    // Check extension
    if (!['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
      return false;
    }

    // Check naming patterns
    return (
      base.endsWith('.plugin') ||
      base.endsWith('-plugin') ||
      base.endsWith('Plugin') ||
      base.includes('plugin')
    );
  }

  /**
   * Validate plugin
   */
  validatePlugin(plugin: any): boolean {
    if (!plugin || typeof plugin !== 'object') {
      return false;
    }

    // Must have at least one extension method
    const hasExtension =
      typeof plugin.extendRepository === 'function' ||
      typeof plugin.extendDatabase === 'function' ||
      typeof plugin.extendTransaction === 'function';

    if (!hasExtension) {
      return false;
    }

    // Should have a name
    if (!plugin.name || typeof plugin.name !== 'string') {
      return false;
    }

    return true;
  }

  /**
   * Register plugin factory
   */
  registerFactory(name: string, factory: PluginFactory): void {
    this.pluginFactories.set(name, factory);
  }

  /**
   * Create plugin from registered factory
   */
  createFromFactory(name: string, options?: any): ITitanPlugin {
    const factory = this.pluginFactories.get(name);
    if (!factory) {
      throw new Error(`Plugin factory "${name}" not found`);
    }

    return this.ensureTitanPlugin(factory(options), name);
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins(): Map<string, ITitanPlugin> {
    return new Map(this.loadedPlugins);
  }

  /**
   * Clear plugin cache
   */
  clearCache(): void {
    this.loadedPlugins.clear();
  }

  /**
   * Unload a plugin
   */
  unloadPlugin(path: string): void {
    this.loadedPlugins.delete(path);
  }

  /**
   * Auto-discover plugins in common locations
   */
  async autoDiscover(searchPaths?: string[]): Promise<ITitanPlugin[]> {
    const defaultPaths = [
      join(process.cwd(), 'plugins'),
      join(process.cwd(), 'src', 'plugins'),
      join(process.cwd(), 'database', 'plugins'),
    ];

    const paths = searchPaths || defaultPaths;
    const allPlugins: ITitanPlugin[] = [];

    for (const searchPath of paths) {
      try {
        const plugins = await this.loadPluginsFromDirectory(searchPath);
        allPlugins.push(...plugins);
      } catch {
        // Directory doesn't exist, skip
      }
    }

    return allPlugins;
  }

  /**
   * Load plugin configuration from JSON
   */
  async loadConfiguration(configPath: string): Promise<Array<{ name: string; plugin: string; options?: any }>> {
    const resolvedPath = resolve(configPath);

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const config = JSON.parse(content);

      if (!Array.isArray(config.plugins)) {
        throw new Error('Invalid plugin configuration: plugins must be an array');
      }

      return config.plugins;
    } catch (error) {
      throw new Error(`Failed to load plugin configuration from "${configPath}": ${error}`);
    }
  }

  /**
   * Load and register plugins from configuration
   */
  async loadFromConfiguration(
    configPath: string,
    registerFn: (name: string, plugin: ITitanPlugin, options?: any) => void
  ): Promise<void> {
    const configs = await this.loadConfiguration(configPath);

    for (const config of configs) {
      try {
        const plugin = await this.loadPlugin(config.plugin);
        registerFn(config.name || plugin.name, plugin, config.options);
      } catch (error) {
        console.error(`Failed to load plugin "${config.name}":`, error);
      }
    }
  }
}