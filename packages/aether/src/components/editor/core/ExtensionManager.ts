/**
 * ExtensionManager - Manage extensions and build editor configuration
 *
 * Handles:
 * - Extension dependency resolution via topological sort
 * - Schema building from extensions
 * - Plugin collection and merging
 * - Keymap, input rules aggregation
 */

import type { Schema } from 'prosemirror-model';
import type { Plugin, Command } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { inputRules, type InputRule } from 'prosemirror-inputrules';
import type { IExtension } from './types.js';
import { SchemaBuilder } from './SchemaBuilder.js';

/**
 * ExtensionManager class
 *
 * Manages the lifecycle and configuration of extensions
 */
export class ExtensionManager {
  private extensions: Map<string, IExtension> = new Map();
  private schema: Schema;
  private plugins: Plugin[];

  constructor(extensionList: IExtension[] = []) {
    // Resolve dependencies and sort extensions
    const sorted = this.topologicalSort(extensionList);

    // Register extensions in dependency order
    for (const ext of sorted) {
      this.extensions.set(ext.name, ext);
    }

    // Build schema
    this.schema = this.buildSchema();

    // Collect plugins
    this.plugins = this.buildPlugins();
  }

  /**
   * Topologically sort extensions based on dependencies
   * This ensures extensions are loaded in the correct order
   */
  private topologicalSort(extensions: IExtension[]): IExtension[] {
    const sorted: IExtension[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    // Create map for quick lookup
    const extensionMap = new Map<string, IExtension>();
    for (const ext of extensions) {
      extensionMap.set(ext.name, ext);
    }

    const visit = (ext: IExtension): void => {
      const name = ext.name;

      // Detect circular dependencies
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected in extension: ${name}`);
      }

      // Already processed
      if (visited.has(name)) {
        return;
      }

      visiting.add(name);

      // Visit dependencies first
      if (ext.dependencies) {
        for (const depName of ext.dependencies) {
          const dep = extensionMap.get(depName);
          if (!dep) {
            throw new Error(`Extension "${name}" depends on "${depName}" which is not provided`);
          }
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(ext);
    };

    // Visit all extensions
    for (const ext of extensions) {
      if (!visited.has(ext.name)) {
        visit(ext);
      }
    }

    return sorted;
  }

  /**
   * Build ProseMirror schema from all extensions
   */
  private buildSchema(): Schema {
    const builder = new SchemaBuilder();
    builder.addExtensions(Array.from(this.extensions.values()));
    return builder.build();
  }

  /**
   * Build plugin list from all extensions
   * Includes core plugins (history, keymap, inputRules) and extension plugins
   */
  private buildPlugins(): Plugin[] {
    const plugins: Plugin[] = [];

    // Core plugins

    // 1. History plugin (undo/redo)
    plugins.push(history());

    // 2. Keymap plugin (keyboard shortcuts)
    const keymapRules = this.getKeymap();
    if (Object.keys(keymapRules).length > 0) {
      plugins.push(keymap(keymapRules));
    }

    // 3. Input rules plugin (markdown shortcuts)
    const rules = this.getInputRules();
    if (rules.length > 0) {
      plugins.push(inputRules({ rules }));
    }

    // Extension plugins
    for (const ext of this.extensions.values()) {
      const extPlugins = ext.getPlugins?.() || [];
      plugins.push(...extPlugins);
    }

    return plugins;
  }

  /**
   * Aggregate keymaps from all extensions
   */
  private getKeymap(): Record<string, Command> {
    const keymapBindings: Record<string, Command> = {
      // Default undo/redo bindings
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
    };

    for (const ext of this.extensions.values()) {
      const extKeymap = ext.getKeyboardShortcuts?.() || {};
      Object.assign(keymapBindings, extKeymap);
    }

    return keymapBindings;
  }

  /**
   * Aggregate input rules from all extensions
   */
  private getInputRules(): InputRule[] {
    const rules: InputRule[] = [];

    for (const ext of this.extensions.values()) {
      const extRules = ext.getInputRules?.() || [];
      rules.push(...extRules);
    }

    return rules;
  }

  /**
   * Get extension by name
   */
  getExtension<T extends IExtension>(name: string): T | undefined {
    return this.extensions.get(name) as T | undefined;
  }

  /**
   * Get all extensions
   */
  getExtensions(): IExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get the built schema
   */
  getSchema(): Schema {
    return this.schema;
  }

  /**
   * Get all plugins
   */
  getPlugins(): Plugin[] {
    return this.plugins;
  }

  /**
   * Destroy all extensions
   */
  destroy(): void {
    for (const ext of this.extensions.values()) {
      if ('destroy' in ext && typeof ext.destroy === 'function') {
        ext.destroy();
      }
    }
    this.extensions.clear();
  }
}
